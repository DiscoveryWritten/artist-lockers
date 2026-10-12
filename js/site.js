// Pages -> a static site: one index.html and a .nojekyll. No build, no script;
// the covers and sources are the only things it reaches for.

const ESC = { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" };
const SCHEME = /^[a-z][\w+.-]*:/i;

const CSS = `
:root { color-scheme: dark; --ink: oklab(86% 0 0); --dim: oklab(66% 0 0); --link: oklab(74.357% -0.02027 -0.10769); }
body { max-width: 46rem; margin: 0 auto; padding: 1.5rem .75rem 4rem; background: oklab(22% 0 0); color: var(--ink); font: 16px/1.45 system-ui, sans-serif; }
a { color: var(--link); }
h1, h2 { font-family: ui-monospace, "SF Mono", Menlo, Consolas, monospace; font-weight: normal; letter-spacing: .04em; margin: 0; }
h1 { font-size: 2rem; padding-inline: .25rem; }
h2 { font-size: 1.1rem; margin-bottom: .25rem; }
section { background: oklab(27% 0 0); border-radius: .75rem; padding: 1rem; margin-top: 1rem; }
article { display: grid; grid-template-columns: 4.5rem 1fr; gap: .6rem 1rem; padding: .9rem 0; border-top: 1px solid oklab(33% 0 0); overflow-wrap: anywhere; }
article > :nth-child(n+3) { grid-column: 1 / -1; }
article > img, .blank { width: 4.5rem; height: 4.5rem; object-fit: cover; border-radius: .5rem; background: oklab(32% 0 0); display: grid; place-items: center; font-size: 1.75rem; color: var(--dim); }
article:target h3 { color: var(--link); }
h3 { margin: 0; font-size: 1.05rem; }
.where, small, summary { color: var(--dim); }
.where { margin: .1rem 0 0; font-size: .85rem; }
ul { list-style: none; padding: 0; margin: 0; display: grid; gap: .5rem; }
ol { margin: 0; padding-left: 1.5rem; }
audio { display: block; width: 100%; height: 2rem; margin-bottom: .2rem; }
summary { cursor: pointer; font-size: .9rem; }
.lyrics { white-space: pre-line; margin-top: .4rem; }
.badge { font: .7rem system-ui, sans-serif; padding: .1rem .5rem; border-radius: 1rem; background: oklab(40% 0 0); margin-left: .5rem; vertical-align: .15rem; }
`;

const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ESC[c]);
const bare = s => s.replace(/[\x00-\x20\x7f]/g, "");
const where = p => [p.locker, p.place].filter(Boolean).join(" › ");

function resolve(from, to) {
  const parts = from.split("/").slice(0, -1);
  for (const part of to.split("/")) part === ".." ? parts.pop() : part === "." || parts.push(part);
  return parts.join("/");
}

// http(s) or relative, else "#". A page's relative urls are relative to its
// .md and index.html sits at the root, so they are resolved before checking.
function href(from, url) {
  url = String(url ?? "");
  const at = SCHEME.test(bare(url)) || bare(url).startsWith("/") ? url : resolve(from, url);
  return esc(/^https?:\/\//i.test(bare(at)) || !SCHEME.test(bare(at)) ? at : "#");
}

const source = (p, s) => "<li>" +
  (s.platform === "discord" ? `<audio controls preload="none" src="${href(p.path, s.url)}"></audio>` : "") +
  `<a href="${href(p.path, s.url)}">${esc(s.label || s.platform)}</a>` +
  (s.caption ? ` <small>${esc(s.caption)}</small>` : "") + "</li>";

function card(p, byPath) {
  const open = `<article id="r-${esc(p.id)}">`;
  if (p.kind === "album") {
    const items = p.tracks.map(t => {
      const r = byPath.get(resolve(p.path, t.path));
      return `<li>${r ? `<a href="#r-${esc(r.id)}">${esc(t.title)}</a>` : esc(t.title)}</li>`;
    });
    return `${open}<div class="blank">♫</div><div><h3>${esc(p.title)}<span class="badge">album</span></h3></div>\n<ol>${items.join("")}</ol></article>`;
  }
  return [
    open + (p.cover ? `<img src="${href(p.path, p.cover)}" alt="" loading="lazy">` : `<div class="blank"></div>`),
    `<div><h3>${esc(p.title)}</h3><p class="where">${esc(where(p))} · <a href="${href(p.path, p.link)}">in Discord</a></p></div>`,
    p.sources.length ? `<ul>${p.sources.map(s => source(p, s)).join("\n")}</ul>` : "",
    p.lyrics ? `<details><summary>lyrics</summary><div class="lyrics">${esc(p.lyrics)}</div></details>` : "",
    "</article>",
  ].filter(Boolean).join("\n");
}

export function site(list, { title = "Locker" } = {}) {
  const albums = list.filter(p => p.kind === "album");
  const records = list.filter(p => p.kind !== "album");
  const byPath = new Map(records.map(p => [p.path, p]));
  const groups = new Map();
  for (const p of [...albums, ...records]) {
    const name = p.kind === "album" ? "albums" : where(p);
    (groups.get(name) || groups.set(name, []).get(name)).push(p);
  }
  const sections = [...groups].map(([name, ps]) =>
    `<section>\n<h2>${esc(name)}</h2>\n${ps.map(p => card(p, byPath)).join("\n")}\n</section>`);
  const html = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>${CSS}</style>
</head>
<body>
<h1>${esc(title)}</h1>
${sections.join("\n")}
</body>
</html>
`;
  return [{ path: "index.html", text: html }, { path: ".nojekyll", text: "" }];
}
