// Harvest -> refs -> markdown. Pure: no DOM, no fs, no network.
//
// A harvest is one owner's own messages, however they were gathered.
// Refs are a map of pointers into a harvest, never a copy of it, so a
// re-harvest after an edit re-renders without the map moving.
//
// Refs are also the bookmark. Whatever a new harvest holds that the last
// refs did not point at is new; nothing has to keep reading to find it.

const MEDIA = /https?:\/\/(?:[\w-]+\.)*(suno|udio|youtube|youtu|soundcloud|spotify|bandcamp)\.[a-z]+\/[^\s<>]+/gi;
const LINK = /https?:\/\/(?:\w+\.)?discord(?:app)?\.com\/channels\/(\d+|@me)\/(\d+)(?:\/(\d+))?/g;
const BARE = /^\s*(\d{17,20})\s*$/gm;
const CONTROL = /^\s*locker:\s*(\w+)\s*(.*?)\s*$/i;
const AUDIO = /\.(mp3|wav|flac|m4a|aac|ogg|opus|mp4|mov|webm|mkv)$/i;
const IMAGE = /\.(png|jpe?g|gif|webp|avif)$/i;
const THREADS = new Set(["thread", "forum_post"]);
const LYRIC_LINES = 4;

const older = (a, b) => a.length - b.length || (a < b ? -1 : a > b ? 1 : 0);
const lines = s => s.split("\n").filter(l => l.trim()).length;
const trim = url => url.replace(/[)\].,>]+$/, "");

export function slug(s) {
  return (s || "").normalize("NFKD").replace(/[̀-ͯ]/g, "")
    .toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
}

function kind(attachment) {
  const type = attachment.content_type || "";
  const name = attachment.filename || new URL(attachment.url).pathname;
  if (/^(audio|video)\//.test(type) || AUDIO.test(name)) return "media";
  if (/^image\//.test(type) || IMAGE.test(name)) return "image";
  return null;
}

export function media(message) {
  const seen = new Set();
  const hits = [];
  const add = hit => seen.has(hit.url) || (seen.add(hit.url), hits.push(hit));
  for (const a of message.attachments || [])
    if (kind(a) === "media") add({ platform: "discord", url: a.url, filename: a.filename, content_type: a.content_type });
  for (const m of (message.content || "").matchAll(MEDIA))
    add({ platform: platform(m[1]), url: trim(m[0]) });
  for (const e of message.embeds || []) {
    const via = [...(e.url || "").matchAll(MEDIA)][0];
    const hit = hits.find(h => h.url === e.url) || hits.find(h => !h.title && via && h.platform === platform(via[1]));
    if (hit) Object.assign(hit, { title: e.title, thumbnail: e.thumbnail });
  }
  return hits;
}

const platform = name => name.toLowerCase() === "youtu" ? "youtube" : name.toLowerCase();

export function images(message) {
  return (message.attachments || []).filter(a => kind(a) === "image").map(a => a.url);
}

export function prose(message) {
  return (message.content || "")
    .replace(MEDIA, "").replace(LINK, "").replace(/<\s*>/g, "")
    .split("\n").map(l => l.trimEnd()).join("\n").trim();
}

export function control(message) {
  const [first] = (message.content || "").split("\n");
  const m = first.match(CONTROL);
  if (!m) return null;
  const body = message.content.slice(first.length);
  const targets = [
    ...[...body.matchAll(LINK)].map(l => l[3] || l[2]),
    ...[...body.matchAll(BARE)].map(b => b[1]),
  ];
  return { verb: m[1].toLowerCase(), arg: m[2], targets, message: message.id };
}

// The places a unit lives, outermost first: locker, forum or channel, thread.
export function ancestry(harvest, channelId) {
  const chain = [];
  for (let c = harvest.channels[channelId]; c; c = harvest.channels[c.parent]) chain.unshift(c);
  const locker = chain[0]?.category || chain[0]?.guild?.name || "";
  return { ids: chain.map(c => c.id), names: [locker, ...chain.map(c => c.name)] };
}

function matches(rule, where) {
  if (where.ids.includes(rule)) return true;
  const path = where.names.join("/").toLowerCase();
  const want = rule.toLowerCase().replace(/\/+$/, "");
  return path === want || path.startsWith(want + "/");
}

const pointers = r => [...(r.sources || []), ...(r.lyrics || []), r.cover, ...(r.tracks || [])].filter(Boolean);

export function knit(harvest, config = {}, previous = null) {
  const owner = config.owner || harvest.owner?.id;
  const allowed = m => {
    const where = ancestry(harvest, m.channel);
    if (!harvest.channels[m.channel]?.guild) return false;
    if (config.only?.length && !config.only.some(r => matches(r, where))) return false;
    return !(config.suppress || []).some(r => matches(r, where));
  };
  const mine = harvest.messages
    .filter(m => (!owner || m.author === owner) && allowed(m))
    .sort((a, b) => older(a.id, b.id));
  const byId = new Map(mine.map(m => [m.id, m]));
  const controls = mine.map(control).filter(Boolean);
  const isControl = new Set(controls.map(c => c.message));

  // A forum post is one unit. In a plain channel each media post stands alone.
  const units = new Map();
  const unitOf = new Map();
  for (const m of mine) {
    if (isControl.has(m.id)) continue;
    const thread = THREADS.has(harvest.channels[m.channel]?.type);
    if (!thread && !media(m).length) continue;
    const id = thread ? m.channel : m.id;
    if (!units.has(id)) units.set(id, { id, channel: m.channel, messages: [] });
    units.get(id).messages.push(m);
    unitOf.set(m.id, id);
  }

  const unmatched = [];
  const flag = (id, reason, hint) => unmatched.push({ id, reason, ...(hint && { hint }) });
  const records = new Map();
  const albums = [];
  const skipped = new Set();
  const dropped = new Set();
  const overrides = new Map();

  for (const c of controls) {
    const here = byId.get(c.message);
    const scope = THREADS.has(harvest.channels[here.channel]?.type) ? here.channel
      : units.has(c.targets[0]) ? c.targets[0] : unitOf.get(c.targets[0]);
    if (c.verb === "album") {
      albums.push({ id: c.message, kind: "album", title: c.arg || null, tracks: c.targets, by: "control" });
      continue;
    }
    if (c.verb === "skip") {
      if (!c.targets.length && scope) skipped.add(scope);
      for (const t of c.targets) units.has(t) ? skipped.add(t) : dropped.add(t);
      continue;
    }
    if (!scope) {
      flag(c.message, `control post "locker: ${c.verb}" has nothing to apply to`,
        "post it inside the forum post, or make its first link point at one");
      continue;
    }
    const o = overrides.get(scope) || {};
    if (c.verb === "lyrics") o.lyrics = c.targets;
    else if (c.verb === "sources" || c.verb === "song") o.sources = c.targets;
    else if (c.verb === "cover") o.cover = c.targets[0] || null;
    else if (c.verb === "title") o.title = c.arg;
    else { flag(c.message, `unknown control verb "${c.verb}"`, "use lyrics, sources, cover, title, skip or album"); continue; }
    overrides.set(scope, o);
  }

  for (const unit of units.values()) {
    if (skipped.has(unit.id)) continue;
    const msgs = unit.messages.filter(m => !dropped.has(m.id));
    const o = overrides.get(unit.id) || {};
    const record = { id: unit.id, channel: unit.channel, kind: "track", by: Object.keys(o).length ? "control" : "auto" };
    if (o.title) record.title = o.title;

    const sources = msgs.filter(m => media(m).length).map(m => m.id);
    record.sources = o.sources || sources;
    for (const id of sources)
      if (!record.sources.includes(id)) flag(id, "media not placed by the sources control post", "add its link to `locker: sources`, or `locker: skip` it");

    record.cover = o.cover !== undefined ? o.cover : msgs.find(m => images(m).length)?.id || null;

    const lyrical = msgs.filter(m => lines(prose(m)) >= LYRIC_LINES).map(m => m.id);
    if (o.lyrics) record.lyrics = o.lyrics;
    else if (lyrical.length) {
      const from = msgs.findIndex(m => m.id === lyrical[0]);
      const run = msgs.slice(from, from + lyrical.length).map(m => m.id);
      if (run.every((id, i) => id === lyrical[i])) record.lyrics = lyrical;
      else {
        record.lyrics = null;
        flag(unit.id, `lyrics are split across ${lyrical.length} posts with other posts between them`,
          "post `locker: lyrics` followed by their message links, in the order they should read");
      }
    } else record.lyrics = null;

    if (!record.sources.length) {
      record.kind = "post";
      flag(unit.id, "no media in this post", "link one with `locker: sources`, `locker: skip` it, or suppress its forum");
    }
    for (const id of [...record.sources, ...(record.lyrics || []), record.cover].filter(Boolean))
      if (!byId.has(id)) flag(unit.id, `control post points at ${id}, which is not in this harvest`);
    records.set(unit.id, record);
  }

  for (const album of albums)
    for (const t of album.tracks)
      if (!records.has(t)) flag(album.id, `album track ${t} is not a record`, "link the forum post itself, not a message in it");

  const all = [...records.values(), ...albums];
  const fresh = [];
  const gone = [];
  if (previous) {
    const had = new Set(previous.records.map(r => r.id));
    const seen = new Set(previous.records.flatMap(pointers));
    for (const r of all) {
      if (!had.has(r.id)) fresh.push({ id: r.id, what: r.kind === "album" ? "album" : "post" });
      else for (const id of r.sources || []) if (!seen.has(id)) fresh.push({ id, what: "media", record: r.id });
    }
    const now = new Set(all.map(r => r.id));
    for (const r of previous.records) if (!now.has(r.id)) gone.push({ id: r.id, what: r.kind, channel: r.channel });
  }

  return {
    owner: owner || null,
    knitted_at: new Date().toISOString(),
    config: { only: config.only || [], suppress: config.suppress || [] },
    records: all,
    unmatched,
    new: fresh,
    gone,
  };
}

// ---------------------------------------------------------------- render --

function deepLink(harvest, channel, message) {
  const guild = harvest.channels[channel]?.guild?.id || "@me";
  return `https://discord.com/channels/${guild}/${channel}${message ? `/${message}` : ""}`;
}

const yaml = v => JSON.stringify(v);

// What a page holds, before it is markdown. The browser previews these.
export function pages(refs, harvest, local = {}) {
  const byId = new Map(harvest.messages.map(m => [m.id, m]));
  const used = new Set();
  const out = new Map();

  for (const r of refs.records.filter(r => r.kind !== "album")) {
    const where = ancestry(harvest, r.channel);
    const thread = THREADS.has(harvest.channels[r.channel]?.type);
    const first = byId.get(r.sources[0]) || byId.get(r.id);
    const title = r.title || (thread ? harvest.channels[r.channel].name
      : first && (media(first)[0]?.title || media(first)[0]?.filename || prose(first).split("\n")[0])) || r.id;
    const dirs = where.names.slice(0, 2).map(n => slug(n) || "untitled");
    let path = [...dirs, `${slug(title) || r.id}.md`].join("/");
    if (used.has(path)) path = path.replace(/\.md$/, `-${r.id}.md`);
    used.add(path);
    const near = url => local[url] ? relative(path, local[url]) : url;

    const sources = r.sources.flatMap(id => {
      const m = byId.get(id);
      if (!m) return [];
      const caption = prose(m);
      return media(m).map(h => ({
        platform: h.platform,
        url: near(h.url),
        ...(h.title && { label: h.title }),
        ...(caption && lines(caption) < LYRIC_LINES && { caption }),
        link: deepLink(harvest, m.channel, m.id),
      }));
    });
    const coverMsg = byId.get(r.cover);
    const cover = coverMsg ? images(coverMsg)[0]
      : r.sources.map(id => byId.get(id)).filter(Boolean).flatMap(media).find(h => h.thumbnail)?.thumbnail;
    out.set(r.id, {
      id: r.id, kind: r.kind, path, title,
      locker: where.names[0], place: where.names[1],
      link: deepLink(harvest, r.channel, thread ? null : r.id),
      cover: cover ? near(cover) : null,
      sources,
      lyrics: (r.lyrics || []).map(id => byId.get(id)).filter(Boolean).map(prose).join("\n\n") || null,
    });
  }

  for (const a of refs.records.filter(r => r.kind === "album")) {
    const title = a.title || `album ${a.id}`;
    const path = `albums/${slug(title) || a.id}.md`;
    const tracks = a.tracks.map(t => out.get(t)).filter(Boolean).map(t => ({ title: t.title, path: relative(path, t.path) }));
    out.set(a.id, { id: a.id, kind: "album", path, title, tracks });
  }
  return [...out.values()];
}

// The owner's work queue, every line with somewhere to go and fix it.
export function queue(refs, harvest, list = pages(refs, harvest)) {
  const byId = new Map(harvest.messages.map(m => [m.id, m]));
  const titles = new Map(list.map(p => [p.id, p.title]));
  const at = (id, channel) => {
    const m = byId.get(id);
    return m ? deepLink(harvest, m.channel, m.id) : deepLink(harvest, harvest.channels[id] ? id : channel || id);
  };
  return {
    unmatched: refs.unmatched.map(u => ({ ...u, title: titles.get(u.id) || u.id, link: at(u.id) })),
    new: (refs.new || []).map(n => ({ ...n, title: titles.get(n.record || n.id) || n.id, link: at(n.id) })),
    gone: (refs.gone || []).map(g => ({ ...g, link: at(g.id, g.channel) })),
  };
}

export function render(refs, harvest, local = {}) {
  const list = pages(refs, harvest, local);
  const files = list.map(p => {
    if (p.kind === "album") return {
      path: p.path,
      text: ["---", `title: ${yaml(p.title)}`, "kind: album", "---", "",
        ...p.tracks.map((t, i) => `${i + 1}. [${t.title}](${t.path})`), ""].join("\n"),
    };
    const front = [
      "---",
      `title: ${yaml(p.title)}`,
      `locker: ${yaml(p.locker)}`,
      `link: ${yaml(p.link)}`,
      ...(p.cover ? [`cover: ${yaml(p.cover)}`] : []),
      ...(p.sources.length ? ["sources:", ...p.sources.map(s => `  - ${yaml(s)}`)] : []),
      "---",
    ];
    const body = p.lyrics ? p.lyrics.split("\n").map(l => l ? `${l}  ` : "").join("\n") + "\n" : "";
    return { path: p.path, text: front.join("\n") + "\n\n" + body };
  });

  const index = [...list].sort((a, b) => a.path.localeCompare(b.path));
  files.push({
    path: "index.md",
    text: ["---", "title: Locker", "---", "", ...index.map(p => `- [${p.title}](${p.path})`), ""].join("\n"),
  });

  const q = queue(refs, harvest, list);
  files.push({
    path: "_unmatched.md",
    text: [
      `# Unmatched (${q.unmatched.length})`,
      "",
      "The work queue. Each line is something the knitter would not guess at.",
      "Fix it in Discord with a control post, re-harvest, re-knit.",
      "",
      ...q.unmatched.map(u => `- [ ] [${u.title}](${u.link}) ${u.reason}${u.hint ? `\n  - ${u.hint}` : ""}`),
      ...(q.new.length ? ["", `## New since the last knit (${q.new.length})`, "",
        ...q.new.map(n => `- [${n.title}](${n.link}) new ${n.what}`)] : []),
      ...(q.gone.length ? ["", `## Gone since the last knit (${q.gone.length})`, "",
        "Deleted in Discord, suppressed, or missing from this harvest.", "",
        ...q.gone.map(g => `- [${g.id}](${g.link}) ${g.what}`)] : []),
      "",
    ].join("\n"),
  });
  return files;
}

function relative(from, to) {
  const up = from.split("/").length - 1;
  return "../".repeat(up) + to;
}
