# Artist Lockers

This is a template repository. That means you can use GitHub to copy it
directly to your account without forking this one. You will be detached from my
updates, which you should consider a feature! It's yours now. Make it cool.

This repository is configured variously by:
- `.env`: Holds environment variables and sensitive secrets for dotenv loader
- `bin/setup`: Prepares server- and dev-side tooling

This repository contains multiple entry points:
- `knit.html`: The same knitting, in the browser, from the zip Discord sends you
- `bin/page`: Serves `knit.html` locally, no Ruby needed
- `bin/knit.mjs SOURCE...`: Knits your own locker into refs and markdown
- `bin/Locker`: Reads channels in categories ending in ` Locker` (legacy bot)
- `bin/daily "CategorySubstring"`: Reads channels in matching categories
- `bin/serve`: Runs the Jekyll dev server for inspection

This repository automatically builds and deploys for pushes to branch `main`.

## Knit your own locker

Nobody reads the server for you. You harvest your own posts, the knitter
turns them into a map, and the map renders into pages you can host anywhere.

Open `knit.html`, drop in the zip Discord sent you, uncheck what is not for
publishing, and download your locker. The download is a website already:
an `index.html` that needs no build, your own audio files beside it, and the
markdown and `refs.json` underneath. Put the folder on any host. Or from a
terminal:

```
bin/knit.mjs --only "Artist Lockers" --out lockers ~/Downloads/package
bin/knit.mjs --suppress "Autumn's Locker/personas" --fetch --out lockers ~/Downloads/package
```

A source is Discord's own data package (Settings › Data & Privacy › Request
all of my data, unzipped), or a `refs.json` the old bot wrote. A data package
only ever holds the person who asked for it.

The rules, in the order they are tried:

1. A post that starts with `locker:` is a control post, and wins.
2. A forum post is one record. Its title is the post's title.
3. Every song link or audio file in it is a source. Several services for one
   song are the listener's choice, not duplicates.
4. Long posts in an unbroken run are the lyrics, in posting order.
5. The first image is the cover; failing that, a link's own thumbnail.
6. Anything else goes to `_unmatched.md`, with the control post that fixes it.

Control posts, pasted into the forum post they are about:

```
locker: lyrics            locker: sources           locker: cover
<message link>            <message link>            <message link>
<message link>            <message link>
                                                    locker: title Better Name
locker: skip              locker: album Exit Music
                          <forum post link>
                          <forum post link>
```

`refs.json` holds message ids, never words. Edit a lyric in Discord,
re-harvest, re-knit: the page changes and the map does not.

`--suppress` and `--only` take ids or paths like `Autumn's Locker/music`.
Forum names repeat from locker to locker; the locker is the namespace.

A data package knows forums only by number. Name them on the page once;
`refs.json` remembers (`config.names`, which `locker.json` can hold too).

Every item in the work queue that has a fix comes with its control post
written out, message links in posting order. Copy it, reorder if needed,
paste it into the forum post.

`--fetch` copies your own attachments into `lockers/media/` while the
harvest's links are fresh. Discord signs them for 24 hours.

## Why there is no bot

A bot is one account holding read access to every channel it can see, run
by one person, writing everybody's work into that person's files. It cannot
tell an owner's request from anyone else's, because nobody asked: it simply
reads. That is exfiltration, whatever it is called, and it scales the wrong
way: one rate limit, one copy, one breach, one person deciding what
everyone's locker means.

Knitting is the other way round. Each owner harvests only themselves, with
their own login, on their own time. The work is as large as one person's
history and runs in as many places as there are people. What comes out is a
folder they hold. Anyone who wants an aggregate links to the pages people
chose to publish; nobody needs a copy of the server.

The lockers were already curated by hand, each its own way. The job was
never to pour them into one database. It was to help people host what they
had already made.

## About

This is a bespoke Jekyll site that reads data committed by a discord.py bot.
The bot is legacy. Nothing new depends on it.

The bot only needs to turn on long enough to read messages since it's last appearance.

Messages are only processed if they have a media signal: attachments, embeds, or links to supported music domains.

Media-focused information is stored per Category group in a server.

Messages and media are treated as stable once fetched.

## Engineering philosophy

Minimalism
: Code demonstrates clear signals of intent, without superficial comments
: Express variables and routines with full but strategically short names
: Prefer flatter structures to deeply nested ones
: Reduce outbound queries with aggressive long-lived File or Blob caching

Self-sufficiency
: All monolith entry points are offered by `bin/` executables
: Accumulate offline media caches
: No frameworks
: No third-party vendor support loaded by the frontend runtime
: Leverage modern standards in HTML, CSS, and JS

## Tooling

Python
: Managed by `uv`
: Versioned by `.python-version`
: Secrets provided via dotenv

Ruby
: Managed by `bundler`
: Versioned by `.ruby-version`

Node
: Managed by `npm`

CI/CD
: Performed by GitHub Actions
: Secrets provided via repository Secrets and Variables

Deployment
: Hosted on GitHub Pages

Discord API
: Provided to the bot by discord.py
: Provided to the static site users by the Discord-authenticated HTTP API

Static site
: Built by Jekyll
: Served by GitHub Pages
: Cached by Cloudflare

IPFS
: Provided over HTTP gateway via "Pinata" (sic)

## Terms

Server
: a Discord "Guild"

Locker
: a Discord "Category" of more channels

Channel
: a Discord text-type channel, or a forum_post-type thread

Author
: a Discord user account who posts inside channels within a Locker
