import { Router } from 'express';
import { validateStellarAddress, addressRouteLimiter } from '../middleware.js';

export function createStreamsRouter(client, contractId) {
  const router = Router();

  router.get('/:address', addressRouteLimiter, validateStellarAddress, async (req, res, next) => {
    try {
      const address = req.params.address;
      const [asOwner, asRecipient] = await Promise.all([
        client.readContract(contractId, 'get_streams_by_owner', [client.scvAddress(address)]),
        client.readContract(contractId, 'get_streams_by_recipient', [client.scvAddress(address)]),
      ]);

      const ids = new Set([...(asOwner || []), ...(asRecipient || [])]);
      const streams = await Promise.all(
        [...ids].map(id => client.readContract(contractId, 'get_stream', [client.scvU64(id)])),
      );
      res.json(streams.map((s, i) => ({ id: [...ids][i], ...s })));
    } catch (err) {
      next(err);
    }
  });

  return router;
}

export function createDCARouter(client, contractId) {
  const router = Router();

  router.get('/:address', addressRouteLimiter, validateStellarAddress, async (req, res, next) => {
    try {
      const address = req.params.address;
      const dcaIds = await client.readContract(contractId, 'get_dcas_by_owner', [client.scvAddress(address)]);
      if (!dcaIds) return res.json([]);

      const dcas = await Promise.all(
        dcaIds.map(id => client.readContract(contractId, 'get_dca', [client.scvU64(id)])),
      );
      res.json(dcas.map((d, i) => ({ id: dcaIds[i], ...d })));
    } catch (err) {
      next(err);
    }
  });

  router.get('/:address/:id/history', addressRouteLimiter, validateStellarAddress, async (req, res, next) => {
    try {
      const address = req.params.address;
      const id = Number(req.params.id);
      if (!Number.isInteger(id) || id < 1) {
        return res.status(400).json({ error: 'Invalid DCA id. Must be a positive integer.' });
      }

      const dcaIds = await client.readContract(contractId, 'get_dcas_by_owner', [client.scvAddress(address)]);
      if (!dcaIds || !dcaIds.some(ownerId => Number(ownerId) === id)) {
        return res.status(404).json({ error: 'DCA policy not found.' });
      }

      const start = parsePositiveInt(req.query.start, 1);
      const limit = Math.min(parsePositiveInt(req.query.limit, 50), 50);

      const records = await client.readContract(contractId, 'get_execution_history', [
        client.scvU64(id),
        client.scvU32(start),
        client.scvU32(limit),
      ]);

      res.json({
        dcaId: id,
        start,
        limit,
        executions: records || [],
      });
    } catch (err) {
      next(err);
    }
  });

  return router;
}

function parsePositiveInt(value, fallback) {
  const parsed = parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1) return fallback;
  return parsed;
}
