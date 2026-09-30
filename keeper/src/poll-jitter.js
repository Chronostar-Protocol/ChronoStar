/**
 * Adds up to +/-20% random jitter to a poll interval (issue #103).
 *
 * A fixed `setInterval` across every keeper instance/watcher means they all
 * poll the RPC endpoint in lockstep, creating synchronized request bursts.
 * Jitter spreads that load out. Never returns less than 1s so a
 * misconfigured near-zero interval can't spin the loop.
 */
export function withJitter(pollIntervalMs) {
  const jitterFactor = 0.8 + Math.random() * 0.4; // 0.8x - 1.2x
  return Math.max(1000, Math.round(pollIntervalMs * jitterFactor));
}
