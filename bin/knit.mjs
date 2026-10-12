#!/usr/bin/env node
// Knit an owner's own locker into refs and markdown.
//
//   bin/knit.mjs [--config locker.json] [--out lockers] [--fetch] SOURCE...
//
// SOURCE is an unzipped Discord data package, a harvest.json, or a refs.json
// from the old bot. --only and --suppress take ids or paths like
// "Autumn's Locker/music"; locker.json may hold {owner, only, suppress}.
//
// The refs.json already in --out is the bookmark: whatever this harvest
// holds that it did not point at is reported new, and the --only and
// --suppress it was knitted with carry over unless --config is given.

import { readFile, writeFile, mkdir, readdir, stat } from "node:fs/promises";
import { join, dirname, relative } from "node:path";
import { parseArgs } from "node:util";
import { knit, render, pages } from "../js/knit.js";
import { fromLegacyRefs, fromDataPackage, merge } from "../js/harvest.js";
import { keep } from "../js/keep.js";
import { site } from "../js/site.js";

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

const last = join(opt.out, "refs.json");
const previous = await readFile(last, "utf8").then(JSON.parse, () => null);
const config = opt.config ? JSON.parse(await readFile(opt.config, "utf8")) : { ...previous?.config };
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
const refs = knit(harvest, config, previous);

let kept = { files: [], local: {}, failed: [] };
if (opt.fetch) {
  const have = new Set(await readdir(join(opt.out, "media")).then(names => names.map(n => `media/${n}`), () => []));
  kept = await keep(refs, harvest, { have });
  for (const file of kept.files) {
    await mkdir(dirname(join(opt.out, file.path)), { recursive: true });
    await writeFile(join(opt.out, file.path), file.bytes);
  }
  for (const f of kept.failed) console.warn(`not kept: ${f.url} (${f.reason})`);
}

await mkdir(opt.out, { recursive: true });
await writeFile(join(opt.out, "refs.json"), JSON.stringify(refs, null, 2) + "\n");
for (const file of [...render(refs, harvest, kept.local), ...site(pages(refs, harvest, kept.local))]) {
  await mkdir(dirname(join(opt.out, file.path)), { recursive: true });
  await writeFile(join(opt.out, file.path), file.text);
}

const tracks = refs.records.filter(r => r.kind !== "album").length;
console.log(`${harvest.messages.length} messages -> ${tracks} records, ${refs.unmatched.length} unmatched, ` +
  (previous ? `${refs.new.length} new, ${refs.gone.length} gone` : "first knit") +
  (opt.fetch ? `, ${kept.files.length} fetched` : "") + ` -> ${opt.out}/`);
