#!/usr/bin/env node
// Knit an owner's own locker into refs and markdown.
//
//   bin/knit.mjs [--config locker.json] [--out lockers] [--fetch] SOURCE...
//
// SOURCE is an unzipped Discord data package, a harvest.json, or a refs.json
// from the old bot. --only and --suppress take ids or paths like
// "Autumn's Locker/music"; locker.json may hold {owner, only, suppress}.

import { readFile, writeFile, mkdir, readdir, stat, access } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { parseArgs } from "node:util";
import { knit, render, media, images } from "../js/knit.js";
import { fromLegacyRefs, fromDataPackage, merge } from "../js/harvest.js";

const { values: opt, positionals } = parseArgs({
  allowPositionals: true,
  options: {
    config: { type: "string" },
    out: { type: "string", default: "lockers" },
    owner: { type: "string" },
    only: { type: "string", multiple: true, default: [] },
    suppress: { type: "string", multiple: true, default: [] },
    fetch: { type: "boolean", default: false },
  },
});

const config = opt.config ? JSON.parse(await readFile(opt.config, "utf8")) : {};
config.owner = opt.owner || config.owner;
config.only = [...(config.only || []), ...opt.only];
config.suppress = [...(config.suppress || []), ...opt.suppress];

async function walk(root, dir = root) {
  const out = [];
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) out.push(...await walk(root, full));
    else out.push(relative(root, full));
  }
  return out;
}

async function harvestFrom(source) {
  if ((await stat(source)).isDirectory())
    return fromDataPackage(await walk(source), p => readFile(join(source, p), "utf8"));
  const json = JSON.parse(await readFile(source, "utf8"));
  if (json.links) return fromLegacyRefs([json]);
  if (json.messages && json.channels) return json;
  throw new Error(`${source}: not a data package, harvest or refs.json`);
}

if (!positionals.length) {
  console.error("usage: bin/knit.mjs [--config locker.json] [--out DIR] [--fetch] SOURCE...");
  process.exit(2);
}

const harvest = merge(await Promise.all(positionals.map(harvestFrom)));
const refs = knit(harvest, config);

const expired = url => {
  const ex = new URL(url).searchParams.get("ex");
  return ex && parseInt(ex, 16) * 1000 < Date.now();
};

const local = {};
let fetched = 0;
if (opt.fetch) {
  const byId = new Map(harvest.messages.map(m => [m.id, m]));
  const wanted = refs.records.flatMap(r => [
    ...(r.sources || []).flatMap(id => byId.get(id) ? media(byId.get(id)).filter(h => h.platform === "discord").map(h => [id, h.url]) : []),
    ...(r.cover && byId.get(r.cover) ? images(byId.get(r.cover)).map(url => [r.cover, url]) : []),
  ]);
  for (const [id, url] of wanted) {
    const name = `media/${id}-${decodeURIComponent(new URL(url).pathname.split("/").pop())}`;
    const path = join(opt.out, name);
    if (await access(path).then(() => true, () => false)) { local[url] = name; continue; }
    if (expired(url)) { console.warn(`expired, re-harvest to fetch: ${name}`); continue; }
    const res = await fetch(url);
    if (!res.ok) { console.warn(`${res.status} fetching ${name}`); continue; }
    await mkdir(dirname(path), { recursive: true });
    await writeFile(path, Buffer.from(await res.arrayBuffer()));
    local[url] = name;
    fetched++;
  }
}

await mkdir(opt.out, { recursive: true });
await writeFile(join(opt.out, "refs.json"), JSON.stringify(refs, null, 2) + "\n");
for (const file of render(refs, harvest, local)) {
  await mkdir(dirname(join(opt.out, file.path)), { recursive: true });
  await writeFile(join(opt.out, file.path), file.text);
}

const tracks = refs.records.filter(r => r.kind !== "album").length;
console.log(`${harvest.messages.length} messages -> ${tracks} records, ${refs.unmatched.length} unmatched` +
  (opt.fetch ? `, ${fetched} fetched` : "") + ` -> ${opt.out}/`);
