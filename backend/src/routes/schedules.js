import { Router } from 'express';
import { validateStellarAddress, addressRouteLimiter } from '../middleware.js';

export function createSchedulesRouter(client, contractId) {
  const router = Router();

  router.get('/:address', addressRouteLimiter, validateStellarAddress, async (req, res, next) => {
    try {
      const address = req.params.address;
      const vaultIds = await client.readContract(
        contractId,
        'get_vaults_by_owner',
        [client.scvAddress(address)],
      );
      if (!vaultIds) return res.json([]);

      const vaults = await Promise.all(
        vaultIds.map(id => client.readContract(contractId, 'get_vault', [client.scvU64(id)])),
      );
      res.json(vaults.map((v, i) => ({ id: vaultIds[i], ...v })));
    } catch (err) {
      next(err);
    }
  });

  return router;
}
