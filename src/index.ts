import type { CaptureJob, Env } from './types';
import { handleWebhook } from './webhook';
import { handleCapture } from './capture';
import { handleApi } from './api';
import { handleQueue } from './consumer';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, ts: new Date().toISOString() }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    // Sendblue adapter.
    if (url.pathname === '/webhook') {
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
      return handleWebhook(request, env);
    }

    // Generic adapter: any authenticated client.
    if (url.pathname === '/capture') {
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
      return handleCapture(request, env);
    }

    if (url.pathname === '/api' || url.pathname.startsWith('/api/')) {
      return handleApi(request, env, url);
    }

    return new Response('not found', { status: 404 });
  },

  async queue(batch: MessageBatch<CaptureJob>, env: Env): Promise<void> {
    await handleQueue(batch, env);
  },
} satisfies ExportedHandler<Env, CaptureJob>;
