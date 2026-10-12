import { test } from "node:test";
import assert from "node:assert/strict";
import { knit, pages } from "../js/knit.js";
import { site } from "../js/site.js";

const ME = "106584132900941824";
const guild = { id: "1", name: "Artist Lockers" };
const msg = (id, channel, content = "", extra = {}) =>
  ({ id, channel, author: ME, timestamp: "", content, attachments: [], embeds: [], ...extra });
const file = (url, filename) => ({ attachments: [{ url, filename }] });
const MP3 = "https://cdn.discordapp.com/a/1/exit.mp3";

function harvest(messages) {
  const at = (id, name, type, parent = null) => ({ id, name, type, parent, category: "Autumn's Locker", guild });
  return {
    owner: { id: ME },
    channels: {
      10: at("10", "music", "forum"),
      11: at("11", "<script>alert(1)</script>", "forum_post", "10"),
      12: at("12", "Split Song", "forum_post", "10"),
      30: at("30", "stream", "text"),
    },
    messages,
  };
}
const index = (h, local) => site(pages(knit(h), h, local)).find(f => f.path === "index.html").text;

test("user content is text: a <script> title and lyrics come out escaped", () => {
  const html = index(harvest([
    msg("100", "11", "https://suno.com/song/a"),
    msg("101", "11", `<script>one</script>\ntwo & "three"\nfour\nfive`),
  ]));
  assert.ok(!html.includes("<script"));
  assert.match(html, /<h3>&lt;script&gt;alert\(1\)&lt;\/script&gt;<\/h3>/);
  assert.match(html, /<div class="lyrics">&lt;script&gt;one&lt;\/script&gt;\ntwo &amp; &quot;three&quot;\nfour\nfive<\/div>/);
  assert.match(html, /Autumn&#39;s Locker › music/);
});

test("only http(s) and relative urls survive, and relative ones are rebased to the site root", () => {
  const art = "https://cdn.discordapp.com/a/1/art.png";
  const html = index(harvest([
    msg("200", "12", "", file("javascript:alert(1)", "evil.mp3")),
    msg("201", "12", "", file(MP3, "exit.mp3")),
    msg("202", "12", "", file(art, "art.png")),
  ]), { [MP3]: "media/201-exit.mp3", [art]: "../javascript:alert(2)" });
  assert.ok(!/javascript:/i.test(html));
  assert.match(html, /<audio controls preload="none" src="#"><\/audio><a href="#">discord<\/a>/);
  assert.match(html, /<audio controls preload="none" src="media\/201-exit\.mp3">/);
  assert.match(html, /<img src="#"/);
});

test("a Discord file gets a player; a link to a service does not", () => {
  const html = index(harvest([msg("300", "11", "https://suno.com/song/s"), msg("301", "11", "", file(MP3, "exit.mp3"))]));
  assert.deepEqual(html.match(/<audio [^>]*>/g), [`<audio controls preload="none" src="${MP3}">`]);
  assert.match(html, /<li><a href="https:\/\/suno\.com\/song\/s">suno<\/a><\/li>/);
});

test("an album's items jump to its tracks' cards, in the album's order", () => {
  const html = index(harvest([
    msg("600", "11", "https://suno.com/song/a"),
    msg("601", "12", "https://suno.com/song/b"),
    msg("602", "30", "locker: album Exit Music\nhttps://discord.com/channels/1/12\nhttps://discord.com/channels/1/11"),
  ]));
  assert.deepEqual([...html.matchAll(/<li><a href="(#r-\d+)">/g)].map(m => m[1]), ["#r-12", "#r-11"]);
  assert.match(html, /<article id="r-11">/);
  assert.match(html, /<article id="r-12">/);
  assert.deepEqual([...html.matchAll(/<h2>(.*)<\/h2>/g)].map(m => m[1]), ["albums", "Autumn&#39;s Locker › music"]);
});

test("a .nojekyll ships empty, so GitHub Pages serves the files untouched", () => {
  const h = harvest([msg("700", "11", "https://suno.com/song/a")]);
  const files = site(pages(knit(h), h), { title: "Exit <Music>" });
  assert.deepEqual(files.map(f => f.path), ["index.html", ".nojekyll"]);
  assert.equal(files[1].text, "");
  assert.match(files[0].text, /<title>Exit &lt;Music&gt;<\/title>/);
});
