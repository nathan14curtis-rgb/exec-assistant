import { describe, expect, it } from 'vitest';
import {
  decideWebhook,
  normalizeNumber,
  timingSafeEqual,
  type SendblueWebhookBody,
} from '../src/webhook';

const env = {
  SENDBLUE_WEBHOOK_SECRET: 'top-secret',
  ALLOWED_FROM_NUMBER: '+15551234567',
};

const never = async () => false;

function body(overrides: Partial<SendblueWebhookBody> = {}): SendblueWebhookBody {
  return {
    message_handle: 'msg-1',
    content: 'an idea about pricing',
    from_number: '+15551234567',
    is_outbound: false,
    date_sent: '2026-09-18T12:00:00Z',
    ...overrides,
  };
}

describe('timingSafeEqual', () => {
  it('compares equal and unequal strings', () => {
    expect(timingSafeEqual('abc', 'abc')).toBe(true);
    expect(timingSafeEqual('abc', 'abd')).toBe(false);
    expect(timingSafeEqual('abc', 'abcd')).toBe(false);
  });
});

describe('normalizeNumber', () => {
  it('ignores formatting differences', () => {
    expect(normalizeNumber('+1 (555) 123-4567')).toBe('15551234567');
    expect(normalizeNumber(null)).toBe('');
  });
});

describe('decideWebhook', () => {
  it('rejects a missing or wrong signing secret', async () => {
    expect(await decideWebhook(body(), null, env, never)).toMatchObject({ status: 401 });
    expect(await decideWebhook(body(), 'nope', env, never)).toMatchObject({ status: 401 });
  });

  it('enqueues a valid inbound text', async () => {
    const out = await decideWebhook(body(), 'top-secret', env, never);
    expect(out).toEqual({
      action: 'enqueue',
      job: {
        channel: 'sendblue',
        sourceId: 'msg-1',
        text: 'an idea about pricing',
        mediaUrl: null,
        receivedAt: '2026-09-18T12:00:00Z',
        notify: true,
      },
    });
  });

  it('enqueues a voice note with no text body', async () => {
    const out = await decideWebhook(
      body({ content: '', media_url: 'https://cdn.example/a.caf' }),
      'top-secret',
      env,
      never,
    );
    expect(out).toMatchObject({ action: 'enqueue' });
    expect((out as any).job.mediaUrl).toBe('https://cdn.example/a.caf');
  });

  it('ignores other numbers, outbound events and empty messages', async () => {
    for (const patch of [
      { from_number: '+15559999999' },
      { is_outbound: true },
      { content: '', media_url: undefined },
    ]) {
      const out = await decideWebhook(body(patch), 'top-secret', env, never);
      expect(out.action).toBe('ignore');
    }
  });

  it('ignores a duplicate delivery', async () => {
    const store = new Set<string>();
    const seen = async (key: string) => {
      if (store.has(key)) return true;
      store.add(key);
      return false;
    };
    expect((await decideWebhook(body(), 'top-secret', env, seen)).action).toBe('enqueue');
    const second = await decideWebhook(body(), 'top-secret', env, seen);
    expect(second).toMatchObject({ action: 'ignore', reason: 'duplicate' });
  });
});
