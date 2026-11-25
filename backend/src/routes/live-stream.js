import { Router } from "express";
import { config } from "../config.js";

const DEFAULT_REPLAY_BUFFER_SIZE = 100;
const DEFAULT_MAX_CONNECTIONS = 100;
const DEFAULT_MAX_PER_IP = 10;
const MAX_BUFFERED_BYTES = 64 * 1024; // 64KB per consumer buffer threshold

/**
 * Parses the id a client says it last received, from the `Last-Event-ID`
 * header (sent automatically by `EventSource`) or, for clients that rebuild
 * the connection themselves, a `lastEventId` query parameter.
 */
export function parseLastEventId(req) {
  const raw =
    req.get?.("last-event-id") ?? req.headers?.["last-event-id"] ?? req.query?.lastEventId;
  if (typeof raw !== "string" || !/^\d+$/.test(raw)) return null;
  const id = Number(raw);
  return Number.isSafeInteger(id) ? id : null;
}

/**
 * Server-sent events for live schedule updates.
 *
 * Every event carries a monotonically increasing `id:`. Events go to every
 * connected client from one shared poller, and the most recent
 * `replayBufferSize` events are kept so a client that reconnects with
 * `Last-Event-ID` receives exactly the events it missed, without duplicates.
 * The buffer is bounded; if the client is further behind than the buffer
 * reaches, it gets the whole buffer and a `: replay-gap` comment. Ids restart
 * at 1 when the server restarts, so an id from a previous run (ahead of the
 * newest id) is treated as a fresh connection.
 */
export function createLiveStreamRouter(
  clients,
  log,
  pollIntervalMs = 5000,
  {
    replayBufferSize = DEFAULT_REPLAY_BUFFER_SIZE,
    heartbeatMs = 15000,
    maxConnections = config.maxSseConnections || DEFAULT_MAX_CONNECTIONS,
    maxPerIp = config.maxSsePerIp || DEFAULT_MAX_PER_IP,
    maxBufferedBytes = MAX_BUFFERED_BYTES,
  } = {},
) {
  const router = Router();

  const buffer = [];
  const connections = new Set();
  const ipCounts = new Map();
  let nextId = 1;
  let pollTimer = null;
  let publishing = null;

  const frame = (event) =>
    `id: ${event.id}\nevent: schedule-update\ndata: ${JSON.stringify(event.data)}\n\n`;

  const collectStats = async () => {
    const stats = { timestamp: new Date().toISOString(), status: "ok" };
    if (clients && clients.vault) {
      try {
        const vaultCount = await clients.vault.client.readContract(
          clients.vault.contractId,
          "vault_count",
          [],
        );
        stats.vaultCount = vaultCount !== undefined ? Number(vaultCount) : 0;
      } catch {
        // ignore rpc error in stream pulse
      }
    }
    return stats;
  };

  const publish = () => {
    if (publishing) return publishing;
    publishing = (async () => {
      try {
        const event = { id: nextId++, data: await collectStats() };
        buffer.push(event);
        if (buffer.length > replayBufferSize) buffer.shift();
        const payload = frame(event);
        for (const res of [...connections]) {
          if (res.writableEnded) {
            connections.delete(res);
            continue;
          }
          const canWrite = res.write(payload);
          if (!canWrite && (res.socket?.bufferSize || 0) > maxBufferedBytes) {
            try {
              res.write(": slow-consumer-disconnect\n\n");
              res.end();
            } catch {}
            connections.delete(res);
          }
        }
      } catch (err) {
        if (log) log.warn({ err: err.message }, "SSE stream update failed");
      } finally {
        publishing = null;
      }
    })();
    return publishing;
  };

  const startPolling = () => {
    if (!pollTimer) pollTimer = setInterval(publish, pollIntervalMs);
  };
  const stopPollingIfIdle = () => {
    if (connections.size === 0 && pollTimer) {
      clearInterval(pollTimer);
      pollTimer = null;
    }
  };

  router.get("/", async (req, res) => {
    const ip = req.ip || req.connection?.remoteAddress || "unknown";
    const currentIpCount = ipCounts.get(ip) || 0;

    if (connections.size >= maxConnections) {
      return res.status(429).json({
        error: "Too many concurrent stream connections",
        code: "SSE_GLOBAL_LIMIT_EXCEEDED",
      });
    }

    if (currentIpCount >= maxPerIp) {
      return res.status(429).json({
        error: "Too many concurrent stream connections for this client",
        code: "SSE_CLIENT_LIMIT_EXCEEDED",
      });
    }

    ipCounts.set(ip, currentIpCount + 1);

    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    res.flushHeaders?.();

    res.write(": connected\n\n");

    let cleanedUp = false;
    const cleanup = () => {
      if (cleanedUp) return;
      cleanedUp = true;
      clearInterval(heartbeat);
      connections.delete(res);
      const count = ipCounts.get(ip) || 1;
      if (count <= 1) ipCounts.delete(ip);
      else ipCounts.set(ip, count - 1);
      stopPollingIfIdle();
      try {
        res.end();
      } catch {}
    };

    const heartbeat = setInterval(() => {
      if (!res.writableEnded) {
        const ok = res.write(": heartbeat\n\n");
        if (!ok && (res.socket?.bufferSize || 0) > maxBufferedBytes) {
          cleanup();
        }
      }
    }, heartbeatMs);

    req.on("close", cleanup);
    req.on("error", cleanup);
    res.on("error", cleanup);

    let lastId = parseLastEventId(req);
    if (lastId !== null && lastId >= nextId) lastId = null; // id from before a restart

    // Replay synchronously, before joining the broadcast, so an event
    // published while replaying cannot be delivered twice.
    let needsFreshEvent = true;
    if (lastId !== null) {
      needsFreshEvent = false;
      const missed = buffer.filter((event) => event.id > lastId);
      const oldest = buffer[0];
      if (oldest && lastId < oldest.id - 1) res.write(": replay-gap\n\n");
      for (const event of missed) res.write(frame(event));
    }
    connections.add(res);
    startPolling();

    if (needsFreshEvent) await publish();
  });

  return router;
}
