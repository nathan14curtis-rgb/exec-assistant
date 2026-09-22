import { describe, expect, it } from 'vitest';
import { detectContainer, sniffAudio } from '../src/transcribe/sniff';
import { planPayload } from '../src/transcribe/index';

function bytes(...parts: (string | number[])[]): Uint8Array {
  const out: number[] = [];
  for (const p of parts) {
    if (typeof p === 'string') for (const ch of p) out.push(ch.charCodeAt(0));
    else out.push(...p);
  }
  // pad past the 12-byte minimum so short fixtures are still identified
  while (out.length < 16) out.push(0);
  return new Uint8Array(out);
}

describe('detectContainer', () => {
  it('identifies the containers a voice note can arrive in', () => {
    expect(detectContainer(bytes('caff', [0, 1, 0, 0]))).toBe('caf');
    expect(detectContainer(bytes('OggS'))).toBe('ogg');
    expect(detectContainer(bytes('fLaC'))).toBe('flac');
    expect(detectContainer(bytes('RIFF', [0, 0, 0, 0], 'WAVE'))).toBe('wav');
    expect(detectContainer(bytes([0, 0, 0, 0x20], 'ftypM4A '))).toBe('m4a');
    expect(detectContainer(bytes([0x1a, 0x45, 0xdf, 0xa3]))).toBe('webm');
    expect(detectContainer(bytes('#!AMR'))).toBe('amr');
    expect(detectContainer(bytes('ID3', [3, 0, 0]))).toBe('mp3');
    expect(detectContainer(bytes([0xff, 0xfb, 0x90, 0x00]))).toBe('mp3');
  });

  it('says unknown rather than guessing', () => {
    expect(detectContainer(bytes('<!DOCTYPE html>'))).toBe('unknown');
    expect(detectContainer(new Uint8Array([1, 2, 3]))).toBe('unknown');
    // an MPEG sync word with a reserved layer field is not a frame
    expect(detectContainer(bytes([0xff, 0xe8, 0, 0]))).toBe('unknown');
  });
});

describe('sniffAudio', () => {
  it('trusts the bytes over the transport header', () => {
    // Sendblue hands back octet-stream for a real CAF; the bytes win
    const s = sniffAudio(bytes('caff', [0, 1, 0, 0]), 'application/octet-stream');
    expect(s).toEqual({ container: 'caf', mime: 'audio/x-caf', ext: 'caf' });
  });

  it('falls back to a plausible audio header when the bytes say nothing', () => {
    expect(sniffAudio(bytes('????'), 'audio/mpeg')).toMatchObject({ container: 'mp3', ext: 'mp3' });
    expect(sniffAudio(bytes('????'), 'audio/x-weird; codecs=1')).toMatchObject({ mime: 'audio/x-weird' });
  });

  it('never passes a non-audio content-type through to a decoder', () => {
    for (const header of ['application/octet-stream', 'text/html', '', null, undefined]) {
      expect(sniffAudio(bytes('????'), header).mime).toBe('application/octet-stream');
    }
  });
});

describe('planPayload', () => {
  const caf = bytes('caff', [0, 1, 0, 0]);

  it('remuxes CAF for a provider that cannot read it, and says so', () => {
    const plan = planPayload(caf, 'application/octet-stream', false);
    expect(plan.remux).toBe(true);
    expect(plan.sendMime).toBe('audio/ogg');
  });

  it('leaves CAF alone for a provider that accepts it', () => {
    const plan = planPayload(caf, null, true);
    expect(plan.remux).toBe(false);
    expect(plan.sendMime).toBe('audio/x-caf');
  });

  it('never remuxes something that is not CAF', () => {
    for (const b of [bytes('OggS'), bytes([0, 0, 0, 0x20], 'ftypM4A '), bytes('ID3', [3, 0, 0])]) {
      expect(planPayload(b, null, false).remux).toBe(false);
    }
  });

  it('sends a real audio type even when the header was junk', () => {
    expect(planPayload(bytes('OggS'), 'application/octet-stream', false).sendMime).toBe('audio/ogg');
  });
});

// --- the real path: a CAF voice note becomes something a provider accepts ---

import { cafToOggOpus } from '../src/transcribe/caf';
import { buildCaf } from './caf.test';

describe('CAF voice note end to end', () => {
  const packets = [new Uint8Array([0x78, 1, 2, 3]), new Uint8Array([0x78, 4, 5, 6, 7])];
  const caf = buildCaf(packets);

  it('sniffs as CAF even when the CDN said octet-stream', () => {
    expect(sniffAudio(caf, 'application/octet-stream').container).toBe('caf');
  });

  it('is planned for remux, and the remuxed bytes sniff as Ogg', () => {
    const plan = planPayload(caf, 'application/octet-stream', false);
    expect(plan.remux).toBe(true);

    const ogg = cafToOggOpus(caf);
    expect(sniffAudio(ogg, null)).toEqual({ container: 'ogg', mime: 'audio/ogg', ext: 'ogg' });
    // what we would actually send matches what the bytes became
    expect(plan.sendMime).toBe(sniffAudio(ogg, null).mime);
  });
});

// --- Deepgram request behaviour --------------------------------------------

import { transcribeDeepgram, extractTranscript } from '../src/transcribe/deepgram';
import type { Env } from '../src/types';

function fakeEnv(keyterms?: string): Env {
  return { DEEPGRAM_API_KEY: 'k', TRANSCRIBE_KEYTERMS: keyterms } as unknown as Env;
}
const ok = (text: string) =>
  new Response(JSON.stringify({ results: { channels: [{ alternatives: [{ transcript: text }] }] } }));

describe('transcribeDeepgram', () => {
  const audio = new Uint8Array([1, 2, 3]);
  const original = globalThis.fetch;
  const restore = () => { globalThis.fetch = original; };

  it('sends the content-type it was given, and returns the transcript', async () => {
    const seen: { url: string; type: string | null }[] = [];
    globalThis.fetch = (async (u: string, init: RequestInit) => {
      seen.push({ url: String(u), type: (init.headers as Record<string, string>)['content-type'] });
      return ok('hello there');
    }) as unknown as typeof fetch;

    expect(await transcribeDeepgram(fakeEnv(), audio, 'audio/ogg')).toBe('hello there');
    expect(seen[0].type).toBe('audio/ogg');
    expect(seen[0].url).toContain('model=nova-3');
    expect(seen[0].url).toContain('keyterm=Lockii');
    restore();
  });

  it('retries without keyterms on a 400, rather than losing the note', async () => {
    const urls: string[] = [];
    globalThis.fetch = (async (u: string) => {
      urls.push(String(u));
      return urls.length === 1 ? new Response('bad keyterm', { status: 400 }) : ok('saved it');
    }) as unknown as typeof fetch;

    expect(await transcribeDeepgram(fakeEnv(), audio, 'audio/ogg')).toBe('saved it');
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('keyterm=');
    expect(urls[1]).not.toContain('keyterm=');
    restore();
  });

  it('reports what it sent when both attempts fail', async () => {
    globalThis.fetch = (async () => new Response('unsupported media', { status: 400 })) as unknown as typeof fetch;
    await expect(transcribeDeepgram(fakeEnv(), audio, 'application/octet-stream')).rejects.toThrow(
      /unsupported media.*3 bytes as application\/octet-stream/s,
    );
    restore();
  });

  it('does not retry a non-400 failure', async () => {
    let calls = 0;
    globalThis.fetch = (async () => { calls++; return new Response('nope', { status: 401 }); }) as unknown as typeof fetch;
    await expect(transcribeDeepgram(fakeEnv(), audio, 'audio/ogg')).rejects.toThrow(/401/);
    expect(calls).toBe(1);
    restore();
  });

  it('rejects a response with no transcript', () => {
    expect(() => extractTranscript({ results: { channels: [] } })).toThrow(/no transcript/);
  });
});
