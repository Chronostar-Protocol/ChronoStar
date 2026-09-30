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

      const ids = Array.from(new Set([...(asOwner || []), ...(asRecipient || [])]));
      if (ids.length === 0) {
        return res.json([]);
      }

      const scvIds = client.nativeToScv(ids, { type: 'vec', inner: 'u64' });
      
      const [streams, claimables] = await Promise.all([
        Promise.all(ids.map(id => client.readContract(contractId, 'get_stream', [client.scvU64(id)]))),
        client.readContract(contractId, 'get_claimables', [scvIds]),
      ]);

      res.json(streams.map((s, i) => ({ 
        id: ids[i], 
        ...s,
        claimable_amount: claimables[i] !== undefined ? claimables[i].toString() : '0'
      })));
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
