import { test } from "node:test";
import assert from "node:assert/strict";
import { knit } from "../js/knit.js";
import { keep } from "../js/keep.js";

const ME = "106584132900941824";
const guild = { id: "1", name: "Artist Lockers" };
const NOW = Date.UTC(2026, 9, 11);
const msg = (id, channel, content = "", extra = {}) =>
  ({ id, channel, author: ME, timestamp: "", content, attachments: [], embeds: [], ...extra });
const cdn = (name, query = "") => `https://cdn.discordapp.com/attachments/1/2/${name}${query}`;
const attach = (...urls) => ({ attachments: urls.map(url => ({ url, filename: decodeURIComponent(url.split("/").pop().split("?")[0]) })) });
const ex = seconds => `?ex=${Math.floor(NOW / 1000 + seconds).toString(16)}`;

function harvest(messages) {
  const at = (id, name, type, parent = null) => ({ id, name, type, parent, category: "Autumn's Locker", guild });
  return {
    owner: { id: ME },
    channels: { 10: at("10", "music", "forum"), 11: at("11", "Your Body: Exit", "forum_post", "10"), 30: at("30", "stream", "text") },
    messages,
  };
}

function fake(answer = () => null) {
  const asked = [];
  const fetch = async url => {
    asked.push(url);
    const a = answer(url);
    if (a instanceof Error) throw a;
    return a || new Response(url);
  };
  return { fetch, asked };
}

test("keeps the discord audio and the cover, named by message, and never a suno link", async () => {
  const h = harvest([
    msg("100", "11", "", attach(cdn("your%20body%20exit.mp3"))),
    msg("101", "11", "https://suno.com/song/def"),
    msg("102", "11", "", attach(cdn("art.png"))),
    msg("103", "11", "", attach(cdn("not-the-cover.png"))),
  ]);
  const { fetch, asked } = fake();
  const kept = await keep(knit(h), h, { fetch });
  assert.deepEqual(asked.sort(), [cdn("art.png"), cdn("your%20body%20exit.mp3")]);
  assert.deepEqual(kept.local, { [cdn("your%20body%20exit.mp3")]: "media/100-your body exit.mp3", [cdn("art.png")]: "media/102-art.png" });
  assert.deepEqual(kept.failed, []);
  for (const f of kept.files) {
    assert.ok(f.bytes instanceof Uint8Array);
    assert.equal(new TextDecoder().decode(f.bytes), Object.keys(kept.local).find(url => kept.local[url] === f.path));
  }
});

test("one url is fetched once, named by the first message that holds it", async () => {
  const h = harvest([msg("1", "30", "", attach(cdn("a.mp3"), cdn("a.png"))), msg("2", "30", "", attach(cdn("a.mp3")))]);
  const refs = { records: [{ id: "x", sources: ["1", "2"], cover: "1" }, { id: "y", sources: ["2"], cover: "1" }] };
  const { fetch, asked } = fake();
  const kept = await keep(refs, h, { fetch });
  assert.deepEqual(asked.sort(), [cdn("a.mp3"), cdn("a.png")]);
  assert.deepEqual(kept.files.map(f => f.path).sort(), ["media/1-a.mp3", "media/1-a.png"]);
});

test("what is already kept is pointed at, not fetched again", async () => {
  const h = harvest([msg("100", "30", "", attach(cdn("a.mp3"))), msg("101", "30", "", attach(cdn("b.mp3")))]);
  const { fetch, asked } = fake();
  const kept = await keep(knit(h), h, { fetch, have: new Set(["media/100-a.mp3"]) });
  assert.deepEqual(asked, [cdn("b.mp3")]);
  assert.deepEqual(kept.files.map(f => f.path), ["media/101-b.mp3"]);
  assert.deepEqual(kept.local, { [cdn("a.mp3")]: "media/100-a.mp3", [cdn("b.mp3")]: "media/101-b.mp3" });
});

test("an expired link is never fetched; it asks for a fresh harvest", async () => {
  const h = harvest([msg("100", "30", "", attach(cdn("old.mp3", ex(-60)))), msg("101", "30", "", attach(cdn("new.mp3", ex(3600))))]);
  const { fetch, asked } = fake();
  const kept = await keep(knit(h), h, { fetch, now: NOW });
  assert.deepEqual(asked, [cdn("new.mp3", ex(3600))]);
  assert.deepEqual(kept.failed, [{ url: cdn("old.mp3", ex(-60)), id: "100", reason: "expired: harvest again to keep it" }]);
});

test("a refused or blocked fetch lands in failed with its reason, and the rest are kept", async () => {
  const h = harvest(["gone", "cors", "boom", "ok"].map((name, i) => msg(`10${i}`, "30", "", attach(cdn(`${name}.mp3`)))));
  const { fetch } = fake(url =>
    url.includes("gone") ? new Response("", { status: 404 })
    : url.includes("cors") ? new TypeError("Failed to fetch")
    : url.includes("boom") ? new Error("disk full") : null);
  const kept = await keep(knit(h), h, { fetch });
  assert.deepEqual(Object.fromEntries(kept.failed.map(f => [f.id, f.reason])),
    { 100: "HTTP 404", 101: "blocked or expired (CORS)", 102: "disk full" });
  assert.deepEqual(kept.local, { [cdn("ok.mp3")]: "media/103-ok.mp3" });
});

test("never more than three at once, with progress after each", async () => {
  const h = harvest(Array.from({ length: 7 }, (_, i) => msg(`90${i}`, "30", "", attach(cdn(`${i}.mp3`)))));
  let open = 0, most = 0;
  const fetch = async url => {
    most = Math.max(most, ++open);
    await new Promise(r => setTimeout(r, 5));
    open--;
    return new Response(url);
  };
  const seen = [];
  const kept = await keep(knit(h), h, { fetch, progress: p => seen.push(p) });
  assert.equal(most, 3);
  assert.equal(kept.files.length, 7);
  assert.deepEqual(seen.map(p => [p.done, p.total]), [1, 2, 3, 4, 5, 6, 7].map(n => [n, 7]));
});
