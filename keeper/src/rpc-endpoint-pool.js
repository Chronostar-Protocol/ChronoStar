export class RpcEndpointPool {
  constructor(urls, createServer) {
    if (!urls.length) throw new Error('at least one RPC endpoint is required');
    this.endpoints = urls.map((url) => ({ url, server: createServer(url), successes: 0, failures: 0, healthy: true }));
    this.preferredIndex = 0;
  }

  async call(method, ...args) {
    let lastError;
    for (let offset = 0; offset < this.endpoints.length; offset++) {
      const index = (this.preferredIndex + offset) % this.endpoints.length;
      const endpoint = this.endpoints[index];
      try {
        const result = await endpoint.server[method](...args);
        endpoint.successes++;
        endpoint.healthy = true;
        this.preferredIndex = 0;
        return result;
      } catch (error) {
        endpoint.failures++;
        endpoint.healthy = false;
        lastError = error;
      }
    }
    throw lastError;
  }

  metrics() {
    return this.endpoints.map(({ url, successes, failures, healthy }) => ({ url, successes, failures, healthy }));
  }
}
