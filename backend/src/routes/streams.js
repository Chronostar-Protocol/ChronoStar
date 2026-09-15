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

  return router;
}
