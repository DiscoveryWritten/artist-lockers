// Zip in and out with nothing but the platform.
//
// entries(blob) reads only the central directory, then inflates a file when
// asked, so a data package of several gigabytes costs what its messages cost.
// zip(files) stores without compressing; markdown is small and so is the code.

const EOCD = 0x06054b50, EOCD64 = 0x06064b50, LOCATOR64 = 0x07064b50, CENTRAL = 0x02014b50, LOCAL = 0x04034b50;
const FULL = 0xffffffff;

const view = async (blob, from, to) => new DataView(await blob.slice(from, to).arrayBuffer());
const u64 = (v, at) => Number(v.getBigUint64(at, true));

export async function entries(blob) {
  const from = Math.max(0, blob.size - 65557);
  const tail = await view(blob, from, blob.size);
  let end = -1;
  for (let i = tail.byteLength - 22; i >= 0; i--) if (tail.getUint32(i, true) === EOCD) { end = i; break; }
  if (end < 0) throw new Error("not a zip file");

  let count = tail.getUint16(end + 10, true);
  let size = tail.getUint32(end + 12, true);
  let offset = tail.getUint32(end + 16, true);
  if (offset === FULL && end >= 20 && tail.getUint32(end - 20, true) === LOCATOR64) {
    const z = await view(blob, u64(tail, end - 12), u64(tail, end - 12) + 56);
    if (z.getUint32(0, true) !== EOCD64) throw new Error("broken zip64 directory");
    count = u64(z, 32); size = u64(z, 40); offset = u64(z, 48);
  }

  const cd = await view(blob, offset, offset + size);
  const names = new TextDecoder();
  const files = new Map();
  for (let p = 0, n = 0; n < count && cd.getUint32(p, true) === CENTRAL; n++) {
    const nameLen = cd.getUint16(p + 28, true), extraLen = cd.getUint16(p + 30, true), noteLen = cd.getUint16(p + 32, true);
    const entry = { method: cd.getUint16(p + 10, true), csize: cd.getUint32(p + 20, true), local: cd.getUint32(p + 42, true) };
    const usize = cd.getUint32(p + 24, true);
    for (let x = p + 46 + nameLen; x < p + 46 + nameLen + extraLen; x += 4 + cd.getUint16(x + 2, true)) {
      if (cd.getUint16(x, true) !== 1) continue;
      let at = x + 4;
      if (usize === FULL) at += 8;
      if (entry.csize === FULL) { entry.csize = u64(cd, at); at += 8; }
      if (entry.local === FULL) entry.local = u64(cd, at);
    }
    files.set(names.decode(new Uint8Array(cd.buffer, cd.byteOffset + p + 46, nameLen)), entry);
    p += 46 + nameLen + extraLen + noteLen;
  }

  return {
    paths: [...files.keys()].filter(p => !p.endsWith("/")),
    async read(path) {
      const e = files.get(path);
      const head = await view(blob, e.local, e.local + 30);
      if (head.getUint32(0, true) !== LOCAL) throw new Error(`broken entry ${path}`);
      const start = e.local + 30 + head.getUint16(26, true) + head.getUint16(28, true);
      const raw = blob.slice(start, start + e.csize).stream();
      return new Response(e.method === 8 ? raw.pipeThrough(new DecompressionStream("deflate-raw")) : raw).text();
    },
  };
}

const CRC = new Uint32Array(256).map((_, n) => {
  for (let k = 0; k < 8; k++) n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1;
  return n >>> 0;
});
const crc32 = bytes => {
  let c = ~0;
  for (const b of bytes) c = CRC[(c ^ b) & 0xff] ^ (c >>> 8);
  return ~c >>> 0;
};

export function zip(files, when = new Date()) {
  const text = new TextEncoder();
  const time = (when.getHours() << 11) | (when.getMinutes() << 5) | (when.getSeconds() >> 1);
  const date = ((when.getFullYear() - 1980) << 9) | ((when.getMonth() + 1) << 5) | when.getDate();
  const body = [], central = [];
  let offset = 0;
  for (const f of files) {
    const name = text.encode(f.path);
    const data = f.bytes || text.encode(f.text);
    const crc = crc32(data);
    const head = (size, sig) => {
      const v = new DataView(new ArrayBuffer(size));
      v.setUint32(0, sig, true);
      return v;
    };
    const local = head(30, LOCAL);
    local.setUint16(4, 20, true); local.setUint16(6, 0x800, true);
    local.setUint16(10, time, true); local.setUint16(12, date, true);
    local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true);
    local.setUint16(26, name.length, true);
    body.push(local, name, data);

    const c = head(46, CENTRAL);
    c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint16(8, 0x800, true);
    c.setUint16(12, time, true); c.setUint16(14, date, true);
    c.setUint32(16, crc, true); c.setUint32(20, data.length, true); c.setUint32(24, data.length, true);
    c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
    central.push(c, name);
    offset += 30 + name.length + data.length;
  }
  const size = central.reduce((n, part) => n + part.byteLength, 0);
  const end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, EOCD, true);
  end.setUint16(8, files.length, true); end.setUint16(10, files.length, true);
  end.setUint32(12, size, true); end.setUint32(16, offset, true);
  return new Blob([...body, ...central, end], { type: "application/zip" });
}
