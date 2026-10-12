// Harvesters: whatever an owner already holds, turned into one harvest.
//
// {
//   owner: {id, name},
//   source: "data-package" | "legacy-refs" | ...,
//   channels: {<id>: {id, name, type, parent, category, guild: {id, name}}},
//   messages: [{id, channel, author, timestamp, content,
//               attachments: [{url, filename, content_type}],
//               embeds: [{url, title, thumbnail}]}]
// }
//
// type is "text" | "forum" | "thread" | "forum_post". Nothing here reaches
// the network: a harvest is made from things already in the owner's hands.

export function merge(harvests) {
  const out = { owner: null, source: [], channels: {}, messages: [] };
  const byId = new Map();
  for (const h of harvests) {
    out.owner ||= h.owner;
    out.source.push(h.source);
    Object.assign(out.channels, h.channels);
    for (const m of h.messages) byId.set(m.id, m);
  }
  out.source = out.source.join("+");
  out.messages = [...byId.values()];
  return out;
}

// The bot's own refs.json, one per category. Kept so nothing it read is lost.
export function fromLegacyRefs(payloads) {
  const channels = {};
  const messages = new Map();
  for (const link of payloads.flatMap(p => p.links || [])) {
    const guild = { id: link.guild.id, name: link.guild.name };
    const category = link.category?.name || null;
    const parent = link.parent_channel?.id || null;
    if (parent) channels[parent] ||= { id: parent, name: link.parent_channel.name, type: "forum", parent: null, category, guild };
    channels[link.channel.id] ||= { id: link.channel.id, name: link.channel.name, type: link.channel.type, parent, category, guild };

    const id = link.message.id;
    if (!messages.has(id)) messages.set(id, {
      id, channel: link.channel.id, author: link.message.author_id, timestamp: link.message.timestamp,
      content: link.message.content, attachments: [], embeds: [],
    });
    const m = messages.get(id);
    if (link.attachment) m.attachments.push({ url: link.url, filename: link.attachment.filename, content_type: link.attachment.content_type });
    if (link.embed) m.embeds.push({ url: link.url, title: link.embed.title, thumbnail: link.embed.thumbnail_url });
  }
  return { owner: null, source: "legacy-refs", channels, messages: [...messages.values()] };
}

// Discord's own "Request all of my data" package, unzipped. It only ever holds
// the requester's messages, so it cannot be used to take anyone else's.
//
// paths: every file's path relative to the package root.
// read:  path -> Promise<text>. A folder picker in the browser, fs in node.
const SNOWFLAKES = /("(?:ID|id|guild_id|parent_id)"\s*:\s*)(\d{16,})/g;
const parse = text => JSON.parse(text.replace(SNOWFLAKES, '$1"$2"'));
const THREAD_TYPES = new Set([10, 11, 12]);

export async function fromDataPackage(paths, read) {
  const find = re => paths.find(p => re.test(p));
  const userPath = find(/(^|\/)account\/user\.json$/i);
  const user = userPath ? parse(await read(userPath)) : {};
  const owner = { id: user.id ? String(user.id) : null, name: user.global_name || user.username || null };

  const channels = {};
  const messages = [];
  for (const path of paths) {
    const m = path.match(/^(.*?(?:^|\/)messages\/c(\d+))\/channel\.json$/i);
    if (!m) continue;
    const [, dir] = m;
    const c = parse(await read(path));
    if (!c.guild) continue;
    const thread = THREAD_TYPES.has(c.type) || /THREAD/i.test(String(c.type));
    const parent = c.parent_id ? String(c.parent_id) : null;
    const guild = { id: String(c.guild.id), name: c.guild.name };
    if (parent) channels[parent] ||= { id: parent, name: parent, type: "forum", parent: null, category: null, guild };
    channels[String(c.id)] = {
      id: String(c.id), name: c.name || String(c.id),
      type: thread ? (parent ? "forum_post" : "thread") : "text",
      parent, category: null, guild,
    };

    const json = paths.find(p => p.toLowerCase() === `${dir}/messages.json`.toLowerCase());
    const csvPath = paths.find(p => p.toLowerCase() === `${dir}/messages.csv`.toLowerCase());
    const rows = json ? parse(await read(json)) : csvPath ? csv(await read(csvPath)) : [];
    for (const r of rows) messages.push({
      id: String(r.ID),
      channel: String(c.id),
      author: owner.id,
      timestamp: r.Timestamp,
      content: r.Contents || "",
      attachments: (r.Attachments || "").split(/\s+/).filter(Boolean).map(url => ({
        url, filename: decodeURIComponent(new URL(url).pathname.split("/").pop()),
      })),
      embeds: [],
    });
  }
  return { owner, source: "data-package", channels, messages };
}

function csv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++; }
      else if (ch === '"') quoted = false;
      else field += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(field); field = ""; }
    else if (ch === "\n") { row.push(field.replace(/\r$/, "")); rows.push(row); row = []; field = ""; }
    else field += ch;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head = [], ...body] = rows;
  return body.map(r => Object.fromEntries(head.map((h, i) => [h, r[i]])));
}
