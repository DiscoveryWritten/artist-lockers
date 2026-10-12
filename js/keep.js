// Keep the owner's own Discord attachments before their links expire.
//
// Discord signs an attachment link for a day. keep() fetches what the refs
// point at while the links still work and hands back bytes and the local map
// render() takes. Pure apart from the fetch it is given: no DOM, no fs.

import { media, images } from "./knit.js";

const LANES = 3;

const expired = (url, now) => {
  const ex = new URL(url).searchParams.get("ex");
  return !!ex && parseInt(ex, 16) * 1000 < now;
};
const named = (id, url) =>
  `media/${id}-${decodeURIComponent(new URL(url).pathname.split("/").pop()).replace(/[/\\]/g, "-")}`;

export async function keep(refs, harvest, { have = new Set(), fetch = globalThis.fetch, progress = () => {}, now = Date.now() } = {}) {
  const byId = new Map(harvest.messages.map(m => [m.id, m]));
  const wanted = new Map();
  const want = (id, url) => wanted.has(url) || wanted.set(url, id);
  for (const r of refs.records) {
    for (const id of r.sources || [])
      for (const hit of byId.has(id) ? media(byId.get(id)) : [])
        if (hit.platform === "discord") want(id, hit.url);
    if (byId.has(r.cover)) for (const url of images(byId.get(r.cover))) want(r.cover, url);
  }

  const files = [], local = {}, failed = [], queue = [];
  for (const [url, id] of wanted) {
    const path = named(id, url);
    if (have.has(path)) local[url] = path;
    else if (expired(url, now)) failed.push({ url, id, reason: "expired: harvest again to keep it" });
    else queue.push({ url, id, path });
  }

  const total = queue.length;
  let done = 0;
  async function lane() {
    for (let job; (job = queue.shift());) {
      const { url, id, path } = job;
      try {
        const res = await fetch(url);
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        files.push({ path, bytes: new Uint8Array(await res.arrayBuffer()) });
        local[url] = path;
      } catch (e) {
        failed.push({ url, id, reason: e instanceof TypeError ? "blocked or expired (CORS)" : e.message });
      }
      progress({ done: ++done, total, url });
    }
  }
  await Promise.all(Array.from({ length: LANES }, lane));
  return { files, local, failed };
}
