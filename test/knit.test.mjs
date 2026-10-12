import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { knit, render, control } from "../js/knit.js";
import { fromLegacyRefs, fromDataPackage } from "../js/harvest.js";

const ME = "106584132900941824";
const guild = { id: "1", name: "Artist Lockers" };
const verse = n => `verse ${n} line one\nline two\nline three\nline four`;
const msg = (id, channel, content = "", extra = {}) =>
  ({ id, channel, author: ME, timestamp: "", content, attachments: [], embeds: [], ...extra });
const link = id => `https://discord.com/channels/1/0/${id}`;

function harvest(messages) {
  const at = (id, name, type, parent = null) => ({ id, name, type, parent, category: "Autumn's Locker", guild });
  return {
    owner: { id: ME },
    channels: {
      10: at("10", "music", "forum"),
      11: at("11", "Your Body: Exit", "forum_post", "10"),
      12: at("12", "Split Song", "forum_post", "10"),
      13: at("13", "Words Only", "forum_post", "10"),
      20: at("20", "personas", "forum"),
      21: at("21", "Vanguard", "forum_post", "20"),
      30: at("30", "stream", "text"),
    },
    messages,
  };
}

test("a forum post is one record: every service kept, contiguous lyrics, first image the cover", () => {
  const refs = knit(harvest([
    msg("100", "11", "https://udio.com/songs/abc"),
    msg("101", "11", "", { attachments: [{ url: "https://cdn.discordapp.com/a/1/exit.mp3", filename: "exit.mp3" }] }),
    msg("102", "11", "https://suno.com/song/def"),
    msg("103", "11", verse(1)),
    msg("104", "11", verse(2)),
    msg("105", "11", "", { attachments: [{ url: "https://cdn.discordapp.com/a/1/art.png", filename: "art.png" }] }),
  ]));
  const [r] = refs.records;
  assert.deepEqual(r.sources, ["100", "101", "102"]);
  assert.deepEqual(r.lyrics, ["103", "104"]);
  assert.equal(r.cover, "105");
  assert.equal(refs.unmatched.length, 0);
});

test("lyrics split by other posts are not guessed at; a control post puts them in order", () => {
  const split = [
    msg("200", "12", "https://suno.com/song/x"),
    msg("201", "12", verse(2)),
    msg("202", "12", "https://udio.com/songs/y"),
    msg("203", "12", verse(1)),
  ];
  const guessed = knit(harvest(split));
  assert.equal(guessed.records[0].lyrics, null);
  assert.match(guessed.unmatched[0].reason, /split across 2 posts/);

  const fixed = knit(harvest([...split, msg("204", "12", `locker: lyrics\n${link("203")}\n${link("201")}`)]));
  assert.deepEqual(fixed.records[0].lyrics, ["203", "201"]);
  assert.equal(fixed.records[0].by, "control");
  assert.equal(fixed.unmatched.length, 0);
});

test("a post with no media lands in the work queue, and skip clears it", () => {
  const words = [msg("300", "13", verse(1))];
  assert.match(knit(harvest(words)).unmatched[0].reason, /no media/);
  const skipped = knit(harvest([...words, msg("301", "13", "locker: skip")]));
  assert.equal(skipped.records.length, 0);
  assert.equal(skipped.unmatched.length, 0);
});

test("suppress by locker path never lets a forum land, even though forum names repeat across lockers", () => {
  const h = harvest([msg("400", "21", "https://suno.com/song/p"), msg("401", "11", "https://suno.com/song/q")]);
  const refs = knit(h, { suppress: ["Autumn's Locker/personas"] });
  assert.deepEqual(refs.records.map(r => r.id), ["11"]);
});

test("only the owner's posts are knitted", () => {
  const refs = knit(harvest([msg("500", "11", "https://suno.com/song/z", { author: "someone-else" })]));
  assert.equal(refs.records.length, 0);
});

test("an album control post orders forum posts; render links them", () => {
  const h = harvest([
    msg("600", "11", "https://suno.com/song/a"),
    msg("601", "12", "https://suno.com/song/b"),
    msg("602", "30", `locker: album Exit Music\nhttps://discord.com/channels/1/12\nhttps://discord.com/channels/1/11`),
  ]);
  const refs = knit(h);
  const album = refs.records.find(r => r.kind === "album");
  assert.deepEqual(album.tracks, ["12", "11"]);
  const page = render(refs, h).find(f => f.path === "albums/exit-music.md");
  assert.match(page.text, /1\. \[Split Song\]\(\.\.\/autumn-s-locker\/music\/split-song\.md\)/);
});

test("refs point, render resolves: an edit to lyrics re-renders without the map moving", () => {
  const h = harvest([msg("700", "11", "https://suno.com/song/a"), msg("701", "11", verse(1))]);
  const refs = knit(h);
  h.messages[1].content = verse(1).replace("line two", "line two, edited");
  const page = render(refs, h).find(f => f.path.endsWith("your-body-exit.md"));
  assert.match(page.text, /line two, edited {2}/);
});

test("control posts parse message links and bare ids", () => {
  assert.deepEqual(control(msg("1", "11", `locker: sources\n${link("9")}\n123456789012345678`)).targets, ["9", "123456789012345678"]);
  assert.equal(control(msg("1", "11", "not locker: lyrics")), null);
});

test("the old bot's refs.json knits: forum posts titled by their thread", async () => {
  const legacy = JSON.parse(await readFile(new URL("../_data/243230995954925568/1507611893622378587/refs.json", import.meta.url)));
  const h = fromLegacyRefs([legacy]);
  const refs = knit(h, { owner: ME });
  const titles = render(refs, h).map(f => f.text.match(/^title: "(.*)"$/m)?.[1]).filter(Boolean);
  assert.ok(titles.includes("This is the Title"));
  assert.ok(titles.includes("BITFLIP"));
  assert.equal(refs.records.find(r => r.id === "1507612124317483139").sources.length, 2);
});

test("a Discord data package: snowflakes survive, DMs never enter, CSV and JSON both read", async () => {
  const files = {
    "Account/user.json": `{"id": 106584132900941824, "username": "thenautumn"}`,
    "Messages/c1507612124317483139/channel.json": `{"id": 1507612124317483139, "type": 11, "name": "This is the Title", "parent_id": 1507611981371277373, "guild": {"id": 243230995954925568, "name": "Artist Lockers"}}`,
    "Messages/c1507612124317483139/messages.json": `[{"ID": 1507612526077022209, "Timestamp": "2026-05-23 09:28:57", "Contents": "an audio snip", "Attachments": "https://cdn.discordapp.com/attachments/1/2/1-2.mp3?ex=6a15d4d4"}]`,
    "Messages/c9/channel.json": `{"id": 9, "type": 1, "recipients": ["a", "b"]}`,
    "Messages/c9/messages.json": `[{"ID": 1, "Contents": "a private word"}]`,
    "messages/c42/channel.json": `{"id": 42, "type": 0, "name": "stream", "guild": {"id": 243230995954925568, "name": "Artist Lockers"}}`,
    "messages/c42/messages.csv": `ID,Timestamp,Contents,Attachments\n1507819507702300824,2026-05-24,"two lines, ""quoted""\nhttps://suno.com/song/x",\n`,
  };
  const h = await fromDataPackage(Object.keys(files), async p => files[p]);
  assert.equal(h.owner.id, ME);
  assert.equal(h.channels["1507612124317483139"].type, "forum_post");
  assert.equal(h.channels["1507612124317483139"].parent, "1507611981371277373");
  assert.deepEqual(h.messages.map(m => m.id).sort(), ["1507612526077022209", "1507819507702300824"]);
  assert.ok(!h.messages.some(m => m.content === "a private word"));
  assert.equal(h.messages.find(m => m.id === "1507819507702300824").content, 'two lines, "quoted"\nhttps://suno.com/song/x');

  const refs = knit(h);
  assert.deepEqual(refs.records.map(r => r.id).sort(), ["1507612124317483139", "1507819507702300824"]);
});

test("refs are the bookmark: what the last refs did not point at is new, what they did and is missing is gone", () => {
  const first = harvest([msg("800", "11", "https://suno.com/song/a"), msg("801", "13", "https://suno.com/song/w")]);
  const before = knit(first);
  assert.deepEqual([before.new, before.gone], [[], []]);

  const second = harvest([
    msg("800", "11", "https://suno.com/song/a"),
    msg("802", "11", "https://udio.com/songs/b"),
    msg("803", "12", "https://suno.com/song/c"),
  ]);
  const after = knit(second, {}, before);
  assert.deepEqual(after.new, [{ id: "802", what: "media", record: "11" }, { id: "12", what: "post" }]);
  assert.deepEqual(after.gone.map(g => g.id), ["13"]);
  const queue = render(after, second).find(f => f.path === "_unmatched.md").text;
  assert.match(queue, /## New since the last knit \(2\)/);
  assert.match(queue, /\[Your Body: Exit\]\(.*\/11\/802\) new media/);
});

test("zip: what the page hands back opens again, names and all", async () => {
  const { zip, entries } = await import("../js/zip.js");
  const files = [{ path: "autumn-s-locker/music/ünïcode.md", text: "lyrics  \n" }, { path: "refs.json", text: "{}\n" }];
  const back = await entries(zip(files));
  assert.deepEqual(back.paths, files.map(f => f.path));
  assert.equal(await back.read(files[0].path), files[0].text);
});
