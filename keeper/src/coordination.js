export async function runCoordinated(client, resource, id, action) {
  if (!client.claimExecution) return action();
  const claimed = await client.claimExecution(resource, id);
  if (!claimed) return false;
  try { await action(); return true; }
  finally { await client.releaseExecution(resource, id).catch(() => {}); }
}
