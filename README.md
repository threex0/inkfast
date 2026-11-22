# Inkfast

A small static blog generator with instant search, tag/archive browsing, and one-command publishing over FTP or FTPS.

Write Markdown files, run `npm run publish`, and the changed files are uploaded. There is no database, no server runtime, and no framework. The generated site is plain HTML, one stylesheet, and a tiny optional script for search and the theme toggle.

## Features

- **Static output** — every page is pre-rendered to HTML.
- **Instant search** — a pre-built JSON index is matched in the browser. No search service, no query API.
- **Browsable** — reverse-chronological posts, year grouping, tags, pagination, and a compact archive.
- **Incremental FTP/FTPS publishing** — a hash manifest means only new or changed files are uploaded; removed files are cleaned up.
- **Minimal by default** — system fonts, no external requests, one small CSS file, light and dark themes.
- **Extras that matter** — RSS, sitemap, robots.txt, canonical/Open Graph metadata, JSON-LD, 404 page, clean URLs, accessible search dialog.
- **Local dev server** — rebuilds on change and reloads the browser over SSE.

## Requirements

Node.js 22 or newer (uses the built-in test runner, `fs.watch` recursion, and `process.loadEnvFile`).

```sh
npm ci
npm run build
npm run dev       # build, watch, and serve
```

Open the preview URL printed by `npm run dev` (default `http://127.0.0.1:3000/`).

To look at an existing `dist/` without rebuilding or watching, run `npm run preview` (default `http://127.0.0.1:3001/`).

Do not open `dist/index.html` directly through `file://`. The site uses root-relative URLs such as `/assets/style.css`, so a file URL resolves them against the drive root and the page appears unstyled. Serve the folder over HTTP instead — `npm run preview` does exactly that.

## Project layout

```
inkfast/
  blog.config.json       committed defaults (safe to publish)
  blog.config.local.json your site settings (gitignored)
  .env                   FTP credentials (never commit this)
  content/
    posts/               one Markdown file per post
    pages/               standalone pages such as About
  static/                copied verbatim to dist/ (favicon, images, …)
  src/
    cli.js               build / dev / publish / new / clean
    assets/              style.css and app.js copied into dist/assets/
    …                    generator modules
  test/                  node:test suite
  dist/                  generated output (gitignored)
  .blog-cache/           deploy manifest (gitignored)
```

## Writing a post

Create `content/posts/2026-11-08-my-post.md`:

```md
---
title: My post
date: 2026-11-08
description: One sentence used in lists, metadata, and search results.
tags: [notes, web]
---

The body starts here. Standard Markdown and GFM work: headings, lists,
tables, task lists, fenced code, blockquotes, links, and images.

Raw HTML is allowed because the content is trusted.
```

Or let the CLI create the file as a draft:

```sh
npm run new -- "My post" --tags notes,web
```

### Frontmatter

| Field | Required | Notes |
| --- | --- | --- |
| `title` | recommended | Falls back to a humanised filename. |
| `date` | yes | `YYYY-MM-DD` or an ISO timestamp. Date-only values are treated as UTC midnight. A filename prefix such as `2026-11-08-` also works. |
| `description` | no | Used for lists, meta tags, RSS, and search. Falls back to the first ~160 characters. |
| `tags` | no | Inline (`[a, b]`) or an indented list. Tags are case-insensitive for grouping. |
| `draft` | no | `true` excludes the post unless you build with `--drafts`. |
| `slug` | no | Overrides the slug derived from the filename. |
| `updated` | no | ISO date used in metadata and the sitemap. |
| `image` | no | Open Graph image. Root-relative and relative paths are resolved against the site base path; absolute URLs are left alone. |
| `author` | no | Overrides the site author in JSON-LD. |

Posts dated in the future are skipped unless you build with `--future`. This gives lightweight scheduling: publish later, or run a scheduled build.

The filename's date prefix and slug are derived after the prefix is removed: `2026-11-08-my-post.md` becomes `/posts/my-post/`.

### Pages

Files in `content/pages/` become `/<slug>/` pages. They do not need a date:

```md
---
title: About
description: A short page about this blog.
order: 1
---

Page content.
```

Add pages to the navigation in `blog.config.json`. The reserved slugs `tags`, `archive`, `page`, `posts`, `assets`, and the generated filenames cannot be used.

### Images and other files

Anything in `static/` is copied to the site root. For example, `static/images/diagram.svg` is available at `/images/diagram.svg` (or `/blog/images/diagram.svg` under a base path).

In Markdown, root-relative links and images are automatically prefixed with the site base path:

```md
![Diagram](/images/diagram.svg)
[About](/about/)
```

For a site under a subdirectory, `site.basePath` handles the prefix everywhere — links, assets, feeds, and the search index.

## Commands

| Command | What it does |
| --- | --- |
| `npm run build` | Render `dist/`. |
| `npm run dev` | Build, serve, watch, and reload. |
| `npm run preview` | Serve the existing `dist/` without rebuilding. |
| `npm run publish` | Build and upload changed files. |
| `npm run new -- "Title"` | Create a draft post. |
| `npm test` | Run the test suite. |

Useful flags:

```
build    --drafts --future --out <dir> --config <file>
dev      --port <port> --drafts --future
preview  --port <port>
publish  --dry-run --force --no-build --verbose --drafts --future
new      --tags a,b --date YYYY-MM-DD
clean
```

`--dry-run` prints the upload/delete plan without connecting (credentials are not required for a dry run). `--force` re-uploads every file. `--no-build` deploys the existing `dist/` unchanged.

## Configuration

Settings are layered; later sources win:

1. built-in defaults
2. `blog.config.json` — committed, safe to publish
3. `blog.config.local.json` — gitignored, for your own site
4. environment variables (`.env`)

`blog.config.json` is merged with the defaults:

```json
{
  "site": {
    "title": "My Blog",
    "description": "Notes and projects.",
    "url": "https://example.com",
    "author": "Your Name",
    "lang": "en",
    "basePath": "/",
    "homePage": "",
    "nav": [
      { "label": "About", "href": "/about/" },
      { "label": "Archive", "href": "/archive/" },
      { "label": "Tags", "href": "/tags/" }
    ]
  },
  "build": {
    "contentDir": "content",
    "outDir": "dist",
    "postsPerPage": 20,
    "feedLimit": 20,
    "includeFuture": false,
    "devPort": 3000,
    "previewPort": 3001,
    "searchTextLimit": 12000
  },
  "deploy": {
    "host": "",
    "port": 21,
    "user": "",
    "password": "",
    "secure": false,
    "remoteDir": "/",
    "timeout": 30000,
    "verbose": false
  }
}
```

Notes:

- `site.url` should be the public origin (for example `https://example.com`). If it is empty, feed and sitemap links are relative and a warning is printed.
- `site.basePath` is `/` for a site at the domain root, or `/blog/` for a subdirectory. All internal links, assets, and search URLs are prefixed.
- `site.homePage` — set it to a page slug (for example `"about"`) to render that page at `/` instead of the post list. The blog listing then moves to `/blog/` (and `/blog/page/2/`, …). Leave it empty to keep the post list on the home page. Add a `Blog` link to `site.nav` if you want one.
- `nav` hrefs are site-relative; absolute `http(s)://` links are used as-is, so you can point at another site (for example `{ "label": "lVl", "href": "https://designeragents.com/lvl/" }`).
- `build.searchTextLimit` caps how much plain text each post contributes to the search index.
- Keep personal values (title, author, domain, nav) in `blog.config.local.json`. It is gitignored, so the committed config stays generic. Any key you omit there falls back to `blog.config.json`.
- Keep credentials in `.env` (or environment variables), not in the committed config.

## Publishing over FTP

Copy `.env.example` to `.env` and fill it in:

```ini
BLOG_FTP_HOST=ftp.example.com
BLOG_FTP_PORT=21
BLOG_FTP_USER=your-user
BLOG_FTP_PASSWORD=your-password
BLOG_FTP_SECURE=false
BLOG_FTP_REMOTE_DIR=/public_html
```

Then:

```sh
npm run publish -- --dry-run   # see what would change
npm run publish
```

Environment variables override `blog.config.json`. Values in `.env` are loaded automatically.

| Variable | Meaning |
| --- | --- |
| `BLOG_FTP_HOST` | Server hostname. |
| `BLOG_FTP_PORT` | Port (default 21; implicit FTPS is usually 990). |
| `BLOG_FTP_USER` | Username. |
| `BLOG_FTP_PASSWORD` | Password. |
| `BLOG_FTP_SECURE` | `false` (plain FTP), `true` (explicit FTPS), or `implicit`. |
| `BLOG_FTP_REMOTE_DIR` | Absolute remote directory, e.g. `/public_html/blog`. |
| `BLOG_FTP_TIMEOUT` | Connection timeout in milliseconds. |
| `BLOG_FTP_VERBOSE` | Log raw FTP traffic when `true`. |

Plain `FTP_HOST`, `FTP_USER`, `FTP_PASSWORD`, `FTP_PORT`, `FTP_SECURE`, and `FTP_REMOTE_DIR` are also accepted as fallbacks.

### How incremental publishing works

The first publish uploads everything and writes `.blog-cache/deploy-manifest.json` with a SHA-256 hash for each file. Later publishes compare the new build to the manifest and upload only files whose contents changed.

Deletion is deliberately narrow: a remote path is removed only when that exact path is recorded in the manifest and no longer exists in `dist/`. The deployer does not scan the remote directory for stale files, so files uploaded by another tool, another site, or by hand are left alone. If the manifest is missing, corrupt, or belongs to a different host/port/remote directory, the publish only uploads — nothing is deleted.

Two consequences:

- A build file at the same remote path as existing data will overwrite it (for example, an existing `index.html`).
- If a remote file was deleted by hand, the manifest still believes it is there, so an unchanged file will not be re-uploaded. Use `--force` to republish everything.

Directories left empty after a deletion are not removed. `--force` uploads everything again without clearing the delete history. A changed host/port/remote directory is treated as a new target and starts with a full upload and no deletions.

### Clean URLs

Pages are written as `<path>/index.html`, so `/posts/my-post/`, `/tags/web/`, and `/archive/` work on typical Apache/LiteSpeed shared hosting with directory indexes enabled. If your host does not serve `index.html` for directory URLs, configure it in the control panel or put the site at a path that does.

To use the generated `404.html`, point the host's custom error document at `/404.html`.

### Apache and static hosts

Node is only used on your machine to build and upload. The published output is entirely static: HTML, CSS, one browser-side JavaScript file, JSON, XML, and SVG. Apache does not need Node, PHP, CGI, or any rewrite rules.

- Upload the **contents** of `dist/` into the document root, or into the directory configured by `BLOG_FTP_REMOTE_DIR`.
- Keep `DirectoryIndex index.html` enabled (the Apache default) so URLs like `/posts/my-post/` resolve.
- For a site under a subdirectory, set `site.basePath` (for example `/blog/`) and rebuild before uploading.
- Standard Apache MIME mappings already serve `.css`, `.js`, `.json`, `.svg`, and `.xml` correctly.
- Search is a static JSON file fetched and matched in the browser; there is no search backend.
- You can bypass `npm run publish` entirely and copy `dist/` with any FTP client.

A minimal optional `.htaccess`:

```apache
DirectoryIndex index.html
ErrorDocument 404 /404.html
```

If `.htaccess` overrides are disabled on the host, put the same directives in the virtual host configuration.

## Local development

`npm run dev` builds once, starts a small server bound to `127.0.0.1`, and watches `content/`, `static/`, `src/assets/`, `blog.config.json`, and `blog.config.local.json`. Changed content triggers a rebuild and a browser reload. A failed build appears as a red banner instead of a blank page.

Builds are staged and swapped into place, so a failed build leaves the previous `dist/` untouched. A per-project lock keeps a manual build from racing the dev server; a stale lock from a killed process is recovered automatically.

Changes to generator code (`src/*.js`) require restarting the dev server.

The dev server also understands `site.basePath`, so a site configured for `/blog/` previews at `http://127.0.0.1:3000/blog/`.

`npm run preview` serves the current `dist/` with correct MIME types but does not watch or rebuild. It is the quickest way to check the exact files that would be uploaded. Opening `dist/index.html` straight from disk will not load the CSS or JavaScript, because the generated URLs are root-relative.

## Search

The build writes `search-index.json` containing each published post's title, URL, date, tags, description, and up to `searchTextLimit` characters of plain text. The browser fetches it the first time the search dialog opens and then answers queries locally.

- Click **Search** or press `/` or `Ctrl/Cmd+K`.
- Every query token must match somewhere.
- Title matches rank above tags, descriptions, and body text.
- `↑`/`↓` navigate, `Enter` opens, `Esc` closes.
- Opening search with an empty query shows recent posts.

Reading and browsing work without JavaScript; only the search overlay and theme toggle require it. The archive is always available as a no-JS fallback.

## Design notes

- One `style.css`, no web fonts, no external requests.
- Theme defaults to the OS preference and can be toggled; the choice is stored in `localStorage`.
- Search data is loaded lazily, so the index does not slow down normal page views.
- Posts are grouped by year on the home page and archive.
- Images are lazy-loaded and decoded asynchronously.
- The generated page set includes `feed.xml`, `sitemap.xml`, `robots.txt`, `404.html`, and `search-index.json`.

## Testing

```sh
npm test
```

The suite covers frontmatter parsing, Markdown rendering and link rewriting, search scoring, build output (including drafts, future dates, pagination, and base paths), config validation, deploy diffing and manifest updates (with a fake FTP client), and the dev/preview servers.

## Security

- `.env`, `blog.config.local.json`, `dist/`, and `.blog-cache/` are gitignored. Keep credentials out of the committed `blog.config.json`.
- The deploy manifest never contains the password.
- Markdown is trusted input: raw HTML is rendered as-is. Do not publish content you would not put on your own site.
- The dev server binds to `127.0.0.1` only.
- FTPS with a valid certificate is recommended where the host supports it.

## Troubleshooting

**The page looks unstyled / Times New Roman** — you are almost certainly opening `dist/index.html` through `file://`, or serving `dist` from a subfolder instead of as the web root. Run `npm run preview` and use its URL, or serve the contents of `dist/` at the site root. The stylesheet is referenced as `/assets/style.css` (prefixed by `site.basePath`), so it needs an HTTP server whose document root is `dist/`.

**`530 Authentication failed`** — check the username/password, and whether the host expects the user to include a domain prefix (some shared hosts use `user@example.com`).

**`ECONNREFUSED` / timeout** — check the port and firewall. Plain FTP usually uses 21; explicit FTPS also typically starts on 21; implicit FTPS usually uses 990 with `BLOG_FTP_SECURE=implicit`.

**Files upload but the site is unchanged** — check `BLOG_FTP_REMOTE_DIR`. It must be the directory that serves the public site, not the FTP account's home directory unless they are the same.

**Links 404 under a subdirectory** — set `site.basePath` to the subdirectory (with leading and trailing slashes, e.g. `/blog/`) and rebuild.

**Search finds nothing** — confirm `search-index.json` is reachable at `<basePath>search-index.json`; opening search in dev tools should show the fetch. Search requires JavaScript.

**A post is missing** — it may be a draft or dated in the future. Use `--drafts` or `--future` for a local build.

**An old post still exists on the server** — deletion history lives in `.blog-cache/deploy-manifest.json` in the project you publish from. A fresh checkout or another machine has no history, so it uploads without pruning. Publish from the same checkout or remove stale paths manually.

**A file deleted on the server did not come back** — the manifest assumes the last publish succeeded. Run `npm run publish -- --force` to upload every file again.

## License

MIT — see [LICENSE](LICENSE).
