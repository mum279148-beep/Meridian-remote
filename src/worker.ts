import { handleCloudflareApiRequest, type CloudflareEnv } from './server/cloudflareApi.ts';

interface AssetsFetcher {
  fetch(request: Request): Promise<Response>;
}

interface WorkerEnv extends CloudflareEnv {
  ASSETS: AssetsFetcher;
}

export default {
  async fetch(request: Request, env: WorkerEnv): Promise<Response> {
    const url = new URL(request.url);
    if (url.pathname.startsWith('/api/')) {
      return handleCloudflareApiRequest(request, env, 'cloudflare_workers');
    }
    return env.ASSETS.fetch(request);
  },
};
