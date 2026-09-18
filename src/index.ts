import type { Env, IdeaJob } from './types';
import { handleWebhook } from './webhook';
import { handleQueue } from './consumer';

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === '/health') {
      return new Response(JSON.stringify({ ok: true, ts: new Date().toISOString() }), {
        headers: { 'content-type': 'application/json' },
      });
    }

    if (url.pathname === '/webhook') {
      if (request.method !== 'POST') return new Response('method not allowed', { status: 405 });
      return handleWebhook(request, env);
    }

    return new Response('not found', { status: 404 });
  },

  async queue(batch: MessageBatch<IdeaJob>, env: Env): Promise<void> {
    await handleQueue(batch, env);
  },
} satisfies ExportedHandler<Env, IdeaJob>;
