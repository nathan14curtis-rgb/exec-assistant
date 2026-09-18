import { describe, expect, it } from 'vitest';
import { cafToOggOpus, isCaf, parseCaf } from '../src/transcribe/caf';

/** Build a minimal CAF file holding `packets` of raw Opus bytes. */
function buildCaf(packets: Uint8Array[], formatId = 'opus'): Uint8Array {
  const enc = new TextEncoder();
  const parts: Uint8Array[] = [];

  const header = new Uint8Array(8);
  header.set(enc.encode('caff'), 0);
  new DataView(header.buffer).setUint16(4, 1); // version
  parts.push(header);

  const chunk = (type: string, body: Uint8Array) => {
    const out = new Uint8Array(12 + body.length);
    out.set(enc.encode(type), 0);
    new DataView(out.buffer).setBigInt64(4, BigInt(body.length));
    out.set(body, 12);
    parts.push(out);
  };

  const desc = new Uint8Array(32);
  const dv = new DataView(desc.buffer);
  dv.setFloat64(0, 48000);
  desc.set(enc.encode(formatId), 8);
  dv.setUint32(16, 0); // bytesPerPacket (variable)
  dv.setUint32(20, 960); // framesPerPacket
  dv.setUint32(24, 1); // channels
  dv.setUint32(28, 16); // bitsPerChannel
  chunk('desc', desc);

  // pakt: header + one varint size per packet.
  const sizes: number[] = [];
  for (const p of packets) {
    let n = p.length;
    const bytes: number[] = [n & 0x7f];
    n >>= 7;
    while (n > 0) {
      bytes.unshift((n & 0x7f) | 0x80);
      n >>= 7;
    }
    sizes.push(...bytes);
  }
  const pakt = new Uint8Array(32 + sizes.length);
  const pv = new DataView(pakt.buffer);
  pv.setBigInt64(0, BigInt(packets.length));
  pv.setBigInt64(8, BigInt(packets.length * 960));
  pv.setInt32(16, 312); // priming frames
  pv.setInt32(20, 0);
  pakt.set(sizes, 32);
  chunk('pakt', pakt);

  const audio = packets.reduce((n, p) => n + p.length, 0);
  const data = new Uint8Array(4 + audio);
  let offset = 4; // leading mEditCount
  for (const p of packets) {
    data.set(p, offset);
    offset += p.length;
  }
  chunk('data', data);

  const total = parts.reduce((n, p) => n + p.length, 0);
  const file = new Uint8Array(total);
  let at = 0;
  for (const p of parts) {
    file.set(p, at);
    at += p.length;
  }
  return file;
}

const PACKETS = [
  new Uint8Array([0x78, 0x01, 0x02, 0x03]),
  new Uint8Array(200).fill(0x5a),
  new Uint8Array([0x78, 0xaa]),
];

// Ogg's non-reflected CRC-32, reimplemented here so the test checks the
// implementation rather than reusing it.
function oggCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc = ((crc ^ (b << 24)) >>> 0);
    for (let i = 0; i < 8; i++) {
      crc = crc & 0x80000000 ? ((crc << 1) ^ 0x04c11db7) >>> 0 : (crc << 1) >>> 0;
    }
  }
  return crc >>> 0;
}

describe('CAF parsing', () => {
  it('detects the caff magic', () => {
    expect(isCaf(buildCaf(PACKETS))).toBe(true);
    expect(isCaf(new Uint8Array([0x4f, 0x67, 0x67, 0x53, 0, 0, 0, 0]))).toBe(false);
  });

  it('reads desc, packet sizes and priming frames', () => {
    const parsed = parseCaf(buildCaf(PACKETS));
    expect(parsed.desc.formatId).toBe('opus');
    expect(parsed.desc.framesPerPacket).toBe(960);
    expect(parsed.packetSizes).toEqual([4, 200, 2]);
    expect(parsed.primingFrames).toBe(312);
  });
});

describe('cafToOggOpus', () => {
  const ogg = cafToOggOpus(buildCaf(PACKETS));
  const text = new TextDecoder('latin1').decode(ogg);

  it('emits an Ogg stream with the two mandatory Opus headers', () => {
    expect(text.startsWith('OggS')).toBe(true);
    expect(text).toContain('OpusHead');
    expect(text).toContain('OpusTags');
  });

  it('carries the original Opus payload bytes unchanged', () => {
    // The 200-byte packet spans two lacing values, so it proves the segmenting.
    expect(text).toContain('Z'.repeat(200));
    expect(ogg.length).toBeGreaterThan(PACKETS.reduce((n, p) => n + p.length, 0));
  });

  it('writes valid page CRCs, sequential page numbers and BOS/EOS flags', () => {
    const view = new DataView(ogg.buffer, ogg.byteOffset, ogg.byteLength);
    let pos = 0;
    let seq = 0;
    const flags: number[] = [];

    while (pos < ogg.length) {
      expect(text.slice(pos, pos + 4)).toBe('OggS');
      flags.push(ogg[pos + 5]);
      expect(view.getUint32(pos + 18, true)).toBe(seq++);

      const segments = ogg[pos + 26];
      let payload = 0;
      for (let i = 0; i < segments; i++) payload += ogg[pos + 27 + i];
      const pageLen = 27 + segments + payload;

      const page = ogg.slice(pos, pos + pageLen);
      const stated = view.getUint32(pos + 22, true);
      new DataView(page.buffer).setUint32(22, 0, true);
      expect(oggCrc(page)).toBe(stated);

      pos += pageLen;
    }

    expect(flags[0]).toBe(0x02); // beginning of stream
    expect(flags[flags.length - 1]).toBe(0x04); // end of stream
  });

  it('refuses a non-Opus CAF instead of producing a broken stream', () => {
    expect(() => cafToOggOpus(buildCaf(PACKETS, 'lpcm'))).toThrow(/expected opus/);
  });
});
