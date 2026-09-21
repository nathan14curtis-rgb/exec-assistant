/**
 * Pure-TypeScript CAF -> Ogg Opus remux (Phase 0 fallback).
 *
 * Apple iMessage voice notes arrive as .caf containing raw Opus packets.
 * Workers cannot run ffmpeg, but no re-encode is needed: the Opus packets are
 * already exactly what an Ogg stream carries, so we only repackage them into
 * Ogg pages with the two mandatory Opus headers in front.
 *
 * Only used when the configured provider rejects CAF outright.
 */

const MAGIC_CAF = 0x63616666; // 'caff'

/** mNumberPackets + mNumberValidFrames (SInt64) + mPriming/mRemainderFrames (SInt32). */
const PACKET_TABLE_HEADER_SIZE = 24;

export function isCaf(bytes: Uint8Array): boolean {
  if (bytes.length < 8) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  return view.getUint32(0) === MAGIC_CAF;
}

interface CafDesc {
  sampleRate: number;
  formatId: string;
  bytesPerPacket: number;
  framesPerPacket: number;
  channels: number;
}

interface CafParsed {
  desc: CafDesc;
  primingFrames: number;
  /** Byte length of each Opus packet, in order. */
  packetSizes: number[];
  data: Uint8Array;
}

function fourCC(view: DataView, offset: number): string {
  return String.fromCharCode(
    view.getUint8(offset),
    view.getUint8(offset + 1),
    view.getUint8(offset + 2),
    view.getUint8(offset + 3),
  );
}

/** CAF packet tables use 7-bits-per-byte big-endian varints. */
function readVarint(bytes: Uint8Array, pos: number): { value: number; next: number } {
  let value = 0;
  let i = pos;
  for (; i < bytes.length; i++) {
    const b = bytes[i];
    value = value * 128 + (b & 0x7f);
    if ((b & 0x80) === 0) return { value, next: i + 1 };
  }
  throw new Error('CAF: truncated varint in packet table');
}

export function parseCaf(bytes: Uint8Array): CafParsed {
  if (!isCaf(bytes)) throw new Error('CAF: bad magic');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

  let desc: CafDesc | null = null;
  let pakt: Uint8Array | null = null;
  let packetSizes: number[] | null = null;
  let primingFrames = 0;
  let data: Uint8Array | null = null;

  let pos = 8; // skip 'caff' + version/flags
  while (pos + 12 <= bytes.length) {
    const type = fourCC(view, pos);
    const size = Number(view.getBigInt64(pos + 4));
    const body = pos + 12;
    // A size of -1 means "to end of file" (only legal for the final chunk).
    const end = size < 0 ? bytes.length : Math.min(body + size, bytes.length);

    if (type === 'desc') {
      desc = {
        sampleRate: view.getFloat64(body),
        formatId: fourCC(view, body + 8),
        bytesPerPacket: view.getUint32(body + 16),
        framesPerPacket: view.getUint32(body + 20),
        channels: view.getUint32(body + 24),
      };
    } else if (type === 'pakt') {
      // Parsed after the loop: it needs framesPerPacket from the desc chunk.
      pakt = bytes.subarray(body, end);
    } else if (type === 'data') {
      // The data chunk begins with a 4-byte mEditCount.
      data = bytes.subarray(body + 4, end);
    }

    if (size < 0) break;
    pos = body + size;
  }

  if (!desc) throw new Error('CAF: missing desc chunk');
  if (!data) throw new Error('CAF: missing data chunk');

  if (pakt) {
    const pv = new DataView(pakt.buffer, pakt.byteOffset, pakt.byteLength);
    const numPackets = Number(pv.getBigInt64(0));
    primingFrames = pv.getInt32(16);
    // When frames-per-packet is variable the table interleaves a duration
    // after every size; we only need the sizes.
    const hasDurations = desc.framesPerPacket === 0;
    const sizes: number[] = [];
    // CAFPacketTableHeader is 24 bytes: two SInt64 counts plus two SInt32
    // frame counts. The variable-length descriptions start right after it.
    let p = PACKET_TABLE_HEADER_SIZE;
    for (let i = 0; i < numPackets; i++) {
      const r = readVarint(pakt, p);
      sizes.push(r.value);
      p = r.next;
      if (hasDurations) p = readVarint(pakt, p).next;
    }
    packetSizes = sizes;
  }
  if (!packetSizes) {
    if (desc.bytesPerPacket > 0) {
      // Constant bitrate: derive the table instead of requiring pakt.
      const n = Math.floor(data.length / desc.bytesPerPacket);
      packetSizes = new Array(n).fill(desc.bytesPerPacket);
    } else {
      throw new Error('CAF: missing pakt chunk for variable-size packets');
    }
  }

  return { desc, primingFrames, packetSizes, data };
}

// Ogg uses a non-reflected CRC-32 with polynomial 0x04c11db7 and no final xor.
const CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) {
      r = r & 0x80000000 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0;
    }
    table[i] = r >>> 0;
  }
  return table;
})();

function oggCrc(bytes: Uint8Array): number {
  let crc = 0;
  for (const b of bytes) {
    crc = ((crc << 8) ^ CRC_TABLE[((crc >>> 24) ^ b) & 0xff]) >>> 0;
  }
  return crc >>> 0;
}

class OggWriter {
  private pages: Uint8Array[] = [];
  private seq = 0;

  constructor(private readonly serial: number) {}

  /** Write one page holding whole packets (each <= 255*255 bytes, true for Opus). */
  writePage(packets: Uint8Array[], granule: number | bigint, headerType: number): void {
    const lacing: number[] = [];
    for (const p of packets) {
      let remaining = p.length;
      while (remaining >= 255) {
        lacing.push(255);
        remaining -= 255;
      }
      lacing.push(remaining);
    }
    if (lacing.length > 255) throw new Error('Ogg: too many segments for one page');

    const payloadLen = packets.reduce((n, p) => n + p.length, 0);
    const page = new Uint8Array(27 + lacing.length + payloadLen);
    const view = new DataView(page.buffer);

    page.set([0x4f, 0x67, 0x67, 0x53], 0); // 'OggS'
    page[4] = 0; // stream structure version
    page[5] = headerType;
    view.setBigUint64(6, BigInt(granule), true);
    view.setUint32(14, this.serial, true);
    view.setUint32(18, this.seq++, true);
    view.setUint32(22, 0, true); // CRC placeholder
    page[26] = lacing.length;
    page.set(lacing, 27);

    let offset = 27 + lacing.length;
    for (const p of packets) {
      page.set(p, offset);
      offset += p.length;
    }

    view.setUint32(22, oggCrc(page), true);
    this.pages.push(page);
  }

  finish(): Uint8Array {
    const total = this.pages.reduce((n, p) => n + p.length, 0);
    const out = new Uint8Array(total);
    let offset = 0;
    for (const p of this.pages) {
      out.set(p, offset);
      offset += p.length;
    }
    return out;
  }
}

function opusHead(channels: number, preSkip: number, sampleRate: number): Uint8Array {
  const buf = new Uint8Array(19);
  const view = new DataView(buf.buffer);
  buf.set([0x4f, 0x70, 0x75, 0x73, 0x48, 0x65, 0x61, 0x64], 0); // 'OpusHead'
  buf[8] = 1; // version
  buf[9] = channels;
  view.setUint16(10, preSkip, true);
  view.setUint32(12, sampleRate, true);
  view.setInt16(16, 0, true); // output gain
  buf[18] = 0; // channel mapping family 0 (mono/stereo)
  return buf;
}

function opusTags(): Uint8Array {
  const vendor = new TextEncoder().encode('idea-capture-caf-remux');
  const buf = new Uint8Array(8 + 4 + vendor.length + 4);
  const view = new DataView(buf.buffer);
  buf.set([0x4f, 0x70, 0x75, 0x73, 0x54, 0x61, 0x67, 0x73], 0); // 'OpusTags'
  view.setUint32(8, vendor.length, true);
  buf.set(vendor, 12);
  view.setUint32(12 + vendor.length, 0, true); // zero user comments
  return buf;
}

/**
 * Repackage the Opus packets inside a CAF file as an Ogg Opus stream.
 * Throws if the CAF does not actually contain Opus.
 */
export function cafToOggOpus(bytes: Uint8Array): Uint8Array {
  const { desc, primingFrames, packetSizes, data } = parseCaf(bytes);
  if (desc.formatId !== 'opus') {
    throw new Error(`CAF: expected opus payload, got '${desc.formatId}'`);
  }

  // Opus granule positions are always counted at 48 kHz.
  const rateScale = 48000 / (desc.sampleRate || 48000);
  const framesPerPacket = Math.round((desc.framesPerPacket || 960) * rateScale);
  const preSkip = Math.max(0, Math.round(primingFrames * rateScale));

  const serial = (Math.random() * 0xffffffff) >>> 0;
  const ogg = new OggWriter(serial);
  ogg.writePage([opusHead(desc.channels || 1, preSkip, 48000)], 0, 0x02); // BOS
  ogg.writePage([opusTags()], 0, 0x00);

  // Slice the data chunk back into packets using the CAF packet table.
  const packets: Uint8Array[] = [];
  let offset = 0;
  for (const size of packetSizes) {
    if (offset + size > data.length) break;
    packets.push(data.subarray(offset, offset + size));
    offset += size;
  }
  if (packets.length === 0) throw new Error('CAF: no audio packets found');

  // Keep pages comfortably under the 255-segment limit.
  const PACKETS_PER_PAGE = 50;
  let granule = preSkip;
  for (let i = 0; i < packets.length; i += PACKETS_PER_PAGE) {
    const chunk = packets.slice(i, i + PACKETS_PER_PAGE);
    granule += chunk.length * framesPerPacket;
    const isLast = i + PACKETS_PER_PAGE >= packets.length;
    ogg.writePage(chunk, granule, isLast ? 0x04 : 0x00); // EOS on the last page
  }

  return ogg.finish();
}
