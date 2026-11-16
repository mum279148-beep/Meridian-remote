import { handleCloudflareApiRequest, type CloudflareEnv } from '../../src/server/cloudflareApi.ts';

interface PagesContext {
  request: Request;
  env: CloudflareEnv;
}

export async function onRequest(context: PagesContext): Promise<Response> {
  return handleCloudflareApiRequest(context.request, context.env, 'cloudflare_pages');
}
