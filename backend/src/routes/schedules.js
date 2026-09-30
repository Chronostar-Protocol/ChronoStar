import { Router } from 'express';
import { validateStellarAddress, addressRouteLimiter } from '../middleware.js';

export function createSchedulesRouter(client, contractId) {
  const router = Router();

  /**
   * Returns all vaults where the address is either the owner or the recipient.
   */
  router.get('/:address', addressRouteLimiter, validateStellarAddress, async (req, res, next) => {
    try {
      const address = req.params.address;
      const [ownerVaultIds, recipientVaultIds] = await Promise.all([
        client.readContract(contractId, 'get_vaults_by_owner', [client.scvAddress(address)]),
        client.readContract(contractId, 'get_vaults_by_recipient', [client.scvAddress(address)])
      ]);

      const ownerIds = ownerVaultIds || [];
      const recipientIds = recipientVaultIds || [];
      const vaultIdsSet = new Set([...ownerIds, ...recipientIds]);
      const vaultIds = Array.from(vaultIdsSet);

      if (vaultIds.length === 0) return res.json([]);

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
