// knit.html: harvest, choose, knit, keep. Nothing here leaves the page.

import { knit, pages, queue, render, ancestry, media, toc } from "./knit.js";
import { fromLegacyRefs, fromDataPackage, merge } from "./harvest.js";
import { entries, zip } from "./zip.js";
import { keep } from "./keep.js";
import { site } from "./site.js";

const SAMPLE = { harvest: "sample/harvest.json", last: "sample/last-refs.json" };
const ICONS = new Set(["discord", "suno", "udio", "youtube", "spotify"]);
const $ = s => document.querySelector(s);
const state = { harvests: [], previous: null, harvest: null, refs: null };

function h(tag, attrs = {}, ...kids) {
  const el = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs))
    if (v === true) el.setAttribute(k, "");
    else if (v != null && v !== false) el.setAttribute(k, k === "href" || k === "src" ? safe(v) : v);
  el.append(...kids.flat().filter(k => k != null && k !== false));
  return el;
}
const ticks = text => text.split("`").map((part, i) => i % 2 ? h("code", {}, part) : part);
const safe = url => /^https?:\/\//i.test(url) || !/^[a-z][\w+.-]*:/i.test(url) ? url : "#";

async function harvestFrom(file) {
  if (/\.zip$/i.test(file.name)) {
    const z = await entries(file);
    return fromDataPackage(z.paths, z.read);
  }
  const json = JSON.parse(await file.text());
  if (json.links) return fromLegacyRefs([json]);
  if (json.messages && json.channels) return json;
  if (json.records && json.unmatched) throw new Error(`${file.name} is a refs.json from a knit: put it in "your last refs.json"`);
  throw new Error(`${file.name}: not a data package, harvest or refs.json`);
}

async function gather(files) {
  $("#error").textContent = "";
  try {
    state.harvests.push(...await Promise.all([...files].map(harvestFrom)));
    state.harvest = merge(state.harvests);
    drawTree();
    reknit();
  } catch (e) {
    $("#error").textContent = e.message;
  }
}

// ------------------------------------------------------------------ tree --
// Lockers, then the forums and channels in them, then forum posts. A locker
// left unchecked is never read; anything unchecked inside one is suppressed.

function drawTree() {
  const { harvest, previous } = state;
  const owner = harvest.owner?.id;
  const lockers = new Map();
  for (const m of harvest.messages) {
    if (owner && m.author !== owner) continue;
    if (!harvest.channels[m.channel]?.guild) continue;
    const { ids, names } = ancestry(harvest, m.channel);
    const hit = media(m).length ? 1 : 0;
    const locker = lockers.get(names[0]) || lockers.set(names[0], { places: new Map(), posts: 0, media: 0 }).get(names[0]);
    const place = locker.places.get(ids[0]) || locker.places.set(ids[0], { name: names[1], threads: new Map(), posts: 0, media: 0 }).get(ids[0]);
    locker.posts++; locker.media += hit; place.posts++; place.media += hit;
    if (ids[1]) {
      const thread = place.threads.get(ids[1]) || place.threads.set(ids[1], { name: names[2], posts: 0, media: 0 }).get(ids[1]);
      thread.posts++; thread.media += hit;
    }
  }

  const had = previous?.config;
  const on = name => had?.only?.length ? had.only.includes(name) : /locker/i.test(name) || lockers.size === 1;
  const kept = id => !had?.suppress?.includes(id);
  const count = n => h("small", {}, ` ${n.media} with media, ${n.posts} posts`);
  const unnamed = name => /^\d{15,}$/.test(name);
  const box = (rule, checked, name, n, level) =>
    h("label", {}, h("input", { type: "checkbox", "data-rule": rule, "data-level": level, checked }), " ",
      unnamed(name) ? h("input", { type: "text", class: "name", "data-name": rule, value: had?.names?.[rule] || "", placeholder: "name this forum" })
        : h("span", {}, name), count(n));

  const tree = h("ul", { class: "tree" }, [...lockers].sort().map(([name, locker]) =>
    h("li", {}, box(name, on(name), name, locker, "locker"),
      h("ul", {}, [...locker.places].map(([id, place]) =>
        h("li", {}, box(id, kept(id), place.name, place, "place"),
          place.threads.size ? h("details", {}, h("summary", {}, `${place.threads.size} posts`),
            h("ul", {}, [...place.threads].map(([tid, t]) => h("li", {}, box(tid, kept(tid), t.name, t, "thread"))))) : null))))));
  $("#tree").replaceChildren(tree);
  tree.addEventListener("change", reknit);
  $("#choose").hidden = false;
}

function choices() {
  const only = [], suppress = [], names = { ...state.previous?.config?.names };
  for (const i of $("#tree").querySelectorAll("[data-name]")) i.value.trim() ? (names[i.dataset.name] = i.value.trim()) : delete names[i.dataset.name];
  for (const locker of $("#tree").querySelectorAll(":scope > ul > li")) {
    const lockerBox = locker.querySelector("input");
    const inner = [...locker.querySelectorAll(":scope ul input[type=checkbox]")];
    inner.forEach(i => (i.disabled = !lockerBox.checked));
    if (!lockerBox.checked) continue;
    only.push(lockerBox.dataset.rule);
    for (const i of inner) if (i.type === "checkbox" && !i.checked) suppress.push(i.dataset.rule);
  }
  return { only, suppress, names };
}

// ----------------------------------------------------------------- knit --

function reknit() {
  const { harvest, previous } = state;
  if (!harvest) return;
  const chosen = choices();
  drawToc(toc(harvest, chosen));
  state.refs = knit(harvest, chosen, previous);
  const list = pages(state.refs, harvest);
  drawQueue(queue(state.refs, harvest, list));
  drawLocker(list);
}

// The proto-project list: forums and the header post of each entry in them.
function drawToc(projects) {
  const full = projects.filter(p => p.entries.length), empty = projects.filter(p => !p.entries.length);
  const chip = s => h("a", { href: s.url, target: "_blank", "data-platform": s.platform },
    ICONS.has(s.platform) ? h("img", { src: `img/${s.platform}.png`, alt: "" }) : null, s.label || s.platform);
  $("#toc").replaceChildren(
    ...full.map(p => h("div", { class: "project" },
      h("h3", {}, p.name, h("small", {}, ` ${p.locker} · ${p.entries.length} ${p.entries.length === 1 ? "entry" : "entries"}`)),
      h("ol", {}, p.entries.map(e => h("li", {},
        e.cover ? h("img", { src: e.cover, alt: "", loading: "lazy" }) : h("span", { class: "blank" }),
        h("span", {}, h("a", { href: e.link, target: "_blank" }, e.title),
          e.sources.length ? h("span", { class: "chips" }, e.sources.map(chip)) : null,
          h("small", {}, e.header ? (e.replies ? ` +${e.replies} after the header` : "") : " header not harvested"))))))),
    empty.length ? h("p", {}, h("small", {}, `${empty.length} more projects with nothing harvested: ${empty.map(p => p.name).join(", ")}`)) : "");
  const n = (k, word) => `${k} ${word}${k === 1 ? "" : "s"}`;
  $("#toc-count").textContent = `${n(full.length, "project")}, ${n(full.reduce((k, p) => k + p.entries.length, 0), "entry").replace(/entrys$/, "entries")}`;
  $("#projects").hidden = false;
}

function drawQueue(q) {
  const items = [
    ...q.unmatched.map(u => h("li", {}, h("a", { href: u.link, target: "_blank" }, u.title), ` ${u.reason}`, u.hint ? h("br") : null, u.hint ? h("small", {}, ticks(u.hint)) : null,
      u.post ? h("div", { class: "post" }, h("pre", {}, u.post), h("button", { type: "button", "data-post": u.post }, "copy")) : null)),
    ...q.new.map(n => h("li", { class: "new" }, "new ", n.what, ": ", h("a", { href: n.link, target: "_blank" }, n.title))),
    ...q.gone.map(g => h("li", { class: "gone" }, `gone ${g.what}: `, h("a", { href: g.link, target: "_blank" }, g.id))),
  ];
  $("#queue").replaceChildren(...(items.length ? items : [h("li", { class: "done" }, "Nothing to fix. Everything found a place.")]));
  $("#tally").textContent = `${q.unmatched.length} unmatched` +
    (state.previous ? `, ${q.new.length} new, ${q.gone.length} gone` : "");
  $("#work").hidden = false;
}

function drawLocker(list) {
  const fresh = new Set((state.refs.new || []).filter(n => n.what !== "media").map(n => n.id)
    .concat((state.refs.new || []).filter(n => n.what === "media").map(n => n.record)));
  const source = s => h("li", {},
    s.platform === "discord" ? h("audio", { controls: true, preload: "none", src: s.url }) : null,
    h("a", { href: s.url, target: "_blank", "data-platform": s.platform },
      ICONS.has(s.platform) ? h("img", { src: `img/${s.platform}.png`, alt: "" }) : null,
      s.label || s.platform),
    s.caption ? h("small", {}, ` ${s.caption}`) : null);

  const cards = list.map(p => p.kind === "album"
    ? h("article", { class: "album" }, h("div", { class: "blank" }, "♫"),
        h("div", {}, h("h3", {}, p.title, h("span", { class: "badge quiet" }, "album")),
          h("ol", {}, p.tracks.map(t => h("li", {}, t.title)))))
    : h("article", {},
        p.cover ? h("img", { src: p.cover, alt: "", loading: "lazy" }) : h("div", { class: "blank" }),
        h("div", {},
          h("h3", {}, p.title, fresh.has(p.id) ? h("span", { class: "badge" }, "new") : null),
          h("p", { class: "where" }, `${p.locker} › ${p.place} · `, h("a", { href: p.link, target: "_blank" }, "in Discord")),
          p.sources.length ? h("ul", { class: "sources" }, p.sources.map(source)) : null,
          p.lyrics ? h("details", {}, h("summary", {}, "lyrics"), h("div", { class: "lyrics" }, p.lyrics)) : null)));
  $("#records").replaceChildren(...cards);
  $("#count").textContent = `${list.length} records`;
  $("#locker").hidden = false;
}

async function download() {
  const { refs, harvest } = state;
  const button = $("#download");
  let kept = { files: [], local: {}, failed: [] };
  if ($("#keep").checked) {
    button.disabled = true;
    kept = await keep(refs, harvest, { progress: ({ done, total }) => (button.textContent = `keeping ${done}/${total}`) });
    button.disabled = false;
    $("#kept").replaceChildren(...kept.failed.map(f => h("li", {}, h("a", { href: f.url, target: "_blank" }, f.url.split("/").pop().split("?")[0]), ` ${f.reason}`)));
  }
  button.textContent = "download .zip";
  const files = [
    ...render(refs, harvest, kept.local),
    ...site(pages(refs, harvest, kept.local)),
    ...kept.files,
    { path: "refs.json", text: JSON.stringify(refs, null, 2) + "\n" },
  ];
  const a = h("a", { href: URL.createObjectURL(zip(files)), download: "locker.zip" });
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// ---------------------------------------------------------------- wiring --

document.addEventListener("DOMContentLoaded", () => {
  const drop = $("[data-drop]");
  $("#pick").addEventListener("change", e => gather(e.target.files));
  $("#last").addEventListener("change", async e => {
    try {
      state.previous = JSON.parse(await e.target.files[0].text());
      if (state.harvest) { drawTree(); reknit(); }
    } catch (err) { $("#error").textContent = `last refs.json: ${err.message}`; }
  });
  $("#sample").addEventListener("click", async () => {
    const [harvest, last] = await Promise.all([SAMPLE.harvest, SAMPLE.last].map(u => fetch(u).then(r => r.ok ? r.text() : Promise.reject(new Error(`${u}: ${r.status}`)))))
      .catch(e => [($("#error").textContent = e.message), null]);
    if (!last) return;
    state.harvests = [];
    state.previous = JSON.parse(last);
    gather([new File([harvest], "harvest.json")]);
  });
  $("#download").addEventListener("click", download);
  $("#queue").addEventListener("click", async e => {
    const button = e.target.closest("[data-post]");
    if (!button) return;
    await navigator.clipboard.writeText(button.dataset.post).then(() => (button.textContent = "copied"), () => (button.textContent = "select and copy"));
  });
  drop.addEventListener("dragover", e => { e.preventDefault(); drop.classList.add("over"); });
  drop.addEventListener("dragleave", () => drop.classList.remove("over"));
  drop.addEventListener("drop", e => { e.preventDefault(); drop.classList.remove("over"); gather(e.dataTransfer.files); });
});
