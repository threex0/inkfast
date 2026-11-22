import { absoluteUrl, escapeHtml, isExternalUrl, tagDirName, urlJoin } from "./utils.js";

const hreff = (basePath, relative) => escapeHtml(urlJoin(basePath, relative));

export function renderLayout({
  site,
  basePath,
  page = {},
  body,
  bodyClass = "",
  jsonLd = [],
}) {
  const lang = site.lang || "en";
  const pageTitle = page.title ? `${page.title} — ${site.title}` : site.title;
  const description = page.description || site.description || "";
  const path = page.path ?? "/";
  const canonical = absoluteUrl(site.url, urlJoin(basePath, path));
  const image = assetUrl(site, basePath, page.image);
  const type = page.type || "website";
  const nav = site.nav?.length
    ? site.nav
    : [
        { label: "Archive", href: "/archive/" },
        { label: "Tags", href: "/tags/" },
      ];

  const navHtml = nav
    .map((item) => {
      const label = typeof item === "string" ? item : item.label;
      const href = typeof item === "string" ? item : item.href;
      const active = isActive(path, href);
      return `<a href="${hreff(basePath, href)}"${active ? ' aria-current="page"' : ""}>${escapeHtml(label)}</a>`;
    })
    .join("");

  const head = [
    '<meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    '<meta name="color-scheme" content="light dark">',
    '<meta name="theme-color" content="#fcfcfa" media="(prefers-color-scheme: light)">',
    '<meta name="theme-color" content="#131413" media="(prefers-color-scheme: dark)">',
    '<meta name="generator" content="inkfast">',
    `<title>${escapeHtml(pageTitle)}</title>`,
    description ? `<meta name="description" content="${escapeHtml(description)}">` : "",
    page.noindex ? '<meta name="robots" content="noindex">' : "",
    `<link rel="canonical" href="${escapeHtml(canonical)}">`,
    `<link rel="alternate" type="application/rss+xml" title="${escapeHtml(site.title)} RSS" href="${hreff(basePath, "feed.xml")}">`,
    `<link rel="icon" href="${hreff(basePath, "favicon.svg")}" type="image/svg+xml">`,
    themeBootScript(),
    `<link rel="stylesheet" href="${hreff(basePath, "assets/style.css")}">`,
    `<meta property="og:site_name" content="${escapeHtml(site.title)}">`,
    `<meta property="og:type" content="${escapeHtml(type)}">`,
    `<meta property="og:title" content="${escapeHtml(pageTitle)}">`,
    description ? `<meta property="og:description" content="${escapeHtml(description)}">` : "",
    `<meta property="og:url" content="${escapeHtml(canonical)}">`,
    image ? `<meta property="og:image" content="${escapeHtml(image)}">` : "",
    `<meta name="twitter:card" content="${image ? "summary_large_image" : "summary"}">`,
    page.published ? `<meta property="article:published_time" content="${escapeHtml(page.published)}">` : "",
    page.updated ? `<meta property="article:modified_time" content="${escapeHtml(page.updated)}">` : "",
    jsonLd
      .map(
        (data) =>
          `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, "\\u003c")}</script>`,
      )
      .join(""),
  ]
    .filter(Boolean)
    .join("\n");

  return `<!doctype html>
<html lang="${escapeHtml(lang)}">
<head>
${head}
</head>
<body class="${escapeHtml(bodyClass)}" data-base="${escapeHtml(basePath)}">
<a class="skip-link" href="#main">Skip to content</a>
<header class="site-header">
  <a class="brand" href="${hreff(basePath, "/")}" aria-label="${escapeHtml(site.title)} home">${escapeHtml(site.title)}</a>
  <nav class="site-nav" aria-label="Primary">
    ${navHtml}
    <button type="button" class="search-trigger" data-search-open aria-label="Search posts" title="Search (press /)">
      <svg class="icon" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>
      <span class="search-trigger-label">Search</span><kbd>/</kbd>
    </button>
    <button type="button" class="theme-toggle" data-theme-toggle aria-label="Toggle color theme" title="Toggle color theme">
      <svg class="icon icon-sun" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><circle cx="12" cy="12" r="4"></circle><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"></path></svg>
      <svg class="icon icon-moon" aria-hidden="true" viewBox="0 0 24 24" width="18" height="18"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8Z"></path></svg>
    </button>
  </nav>
</header>
<main id="main" class="site-main">
${body}
</main>
<footer class="site-footer">
  <p>© ${new Date().getUTCFullYear()} ${escapeHtml(site.author || site.title)} <span aria-hidden="true">·</span> <a href="${hreff(basePath, "feed.xml")}">RSS</a></p>
  <noscript><p class="footer-note">Search needs JavaScript. You can <a href="${hreff(basePath, "/archive/")}">browse the archive</a> instead.</p></noscript>
</footer>
${renderSearchDialog(site)}
<script type="module" src="${hreff(basePath, "assets/app.js")}"></script>
</body>
</html>
`;
}

export function renderHome({
  site,
  posts,
  pageNumber = 1,
  totalPages = 1,
  perPage = 20,
  basePath,
  listingRoot = "/",
  isListingHome = true,
}) {
  const start = (pageNumber - 1) * perPage;
  const pagePosts = posts.slice(start, start + perPage);
  const isFirst = pageNumber === 1;
  let intro;
  if (!isFirst) {
    intro = `<section class="listing-header">
  <p class="eyebrow">Page ${pageNumber}</p>
  <h1>Posts</h1>
</section>`;
  } else if (isListingHome) {
    intro = `<section class="intro">
  <h1>${escapeHtml(site.title)}</h1>
  ${site.description ? `<p class="tagline">${escapeHtml(site.description)}</p>` : ""}
</section>`;
  } else {
    intro = `<section class="listing-header">
  <p class="eyebrow">Blog</p>
  <h1>Posts</h1>
</section>`;
  }
  const canonicalPath = isFirst ? listingRoot : `${listingRoot}page/${pageNumber}/`;
  const body = `
${intro}
${renderPostList(pagePosts, { basePath, locale: site.lang, emptyMessage: "No posts yet. Add a Markdown file to content/posts." })}
${renderPagination(pageNumber, totalPages, basePath, listingRoot)}
`;
  return renderLayout({
    site,
    basePath,
    body,
    page: {
      title: isFirst ? (isListingHome ? null : "Posts") : `Posts, page ${pageNumber}`,
      description: site.description,
      path: canonicalPath,
      type: "website",
    },
    jsonLd: isFirst && isListingHome
      ? [
          {
            "@context": "https://schema.org",
            "@type": "Blog",
            name: site.title,
            description: site.description,
            url: absoluteUrl(site.url, basePath),
          },
        ]
      : [],
  });
}

export function renderPost({ post, newer, older, site, basePath }) {
  const tags = renderTagLinks(post.tags, basePath);
  const body = `
<article class="post">
  <header class="post-header">
    <h1>${escapeHtml(post.title)}</h1>
    <p class="post-meta">
      <time datetime="${escapeHtml(post.dateIso)}">${escapeHtml(post.dateDisplay)}</time>
      <span aria-hidden="true">·</span>
      <span>${post.readingMinutes} min read</span>
      ${post.author ? `<span aria-hidden="true">·</span><span>${escapeHtml(post.author)}</span>` : ""}
    </p>
    ${tags}
  </header>
  <div class="prose">
${post.html}
  </div>
</article>
${renderPostNavigation({ newer, older })}
`;
  return renderLayout({
    site,
    basePath,
    body,
    bodyClass: "is-post",
    page: {
      title: post.title,
      description: post.description,
      path: post.urlPath,
      type: "article",
      published: post.dateIso,
      updated: post.updatedIso || post.dateIso,
      image: post.image,
    },
    jsonLd: [
      {
        "@context": "https://schema.org",
        "@type": "BlogPosting",
        headline: post.title,
        description: post.description,
        datePublished: post.dateIso,
        dateModified: post.updatedIso || post.dateIso,
        author: { "@type": "Person", name: post.author || site.author || site.title },
        image: assetUrl(site, basePath, post.image) || undefined,
        url: absoluteUrl(site.url, post.href),
        mainEntityOfPage: absoluteUrl(site.url, post.href),
        keywords: post.tags.join(", "),
      },
    ],
  });
}

export function renderTagPage({ tag, site, basePath }) {
  const body = `
<section class="listing-header">
  <p class="eyebrow">Tag</p>
  <h1>#${escapeHtml(tag.name)}</h1>
  <p class="tagline">${tag.posts.length} ${tag.posts.length === 1 ? "post" : "posts"}</p>
</section>
${renderPostList(tag.posts, { basePath, locale: site.lang, emptyMessage: "No posts with this tag." })}
`;
  return renderLayout({
    site,
    basePath,
    body,
    page: {
      title: `Posts tagged “${tag.name}”`,
      description: `Posts tagged ${tag.name} on ${site.title}.`,
      path: `/tags/${tag.dir}/`,
      type: "website",
    },
  });
}

export function renderTagsIndex({ tags, site, basePath }) {
  const body = `
<section class="listing-header">
  <p class="eyebrow">Browse</p>
  <h1>Tags</h1>
  <p class="tagline">${tags.length} ${tags.length === 1 ? "tag" : "tags"}</p>
</section>
${
  tags.length
    ? `<ul class="tag-index">${tags
        .map(
          (tag) => `<li><a href="${hreff(basePath, `/tags/${tag.dir}/`)}"><span>#${escapeHtml(tag.name)}</span><span class="count">${tag.posts.length}</span></a></li>`,
        )
        .join("")}</ul>`
    : '<p class="empty">No tags yet.</p>'
}
`;
  return renderLayout({
    site,
    basePath,
    body,
    page: { title: "Tags", description: `All tags on ${site.title}.`, path: "/tags/" },
  });
}

export function renderArchive({ posts, site, basePath }) {
  const body = `
<section class="listing-header">
  <p class="eyebrow">Browse</p>
  <h1>Archive</h1>
  <p class="tagline">${posts.length} ${posts.length === 1 ? "post" : "posts"} in total</p>
</section>
${renderArchiveList(posts, { basePath, locale: site.lang, emptyMessage: "Nothing here yet." })}
`;
  return renderLayout({
    site,
    basePath,
    body,
    page: { title: "Archive", description: `Every post on ${site.title}.`, path: "/archive/" },
  });
}

export function renderPage({ page, site, basePath, path: pagePath, bodyClass = "" }) {
  const body = `
<article class="post page">
  <header class="post-header">
    <h1>${escapeHtml(page.title)}</h1>
  </header>
  <div class="prose">
${page.html}
  </div>
</article>
`;
  return renderLayout({
    site,
    basePath,
    body,
    bodyClass,
    page: {
      title: page.title,
      description: page.description,
      path: pagePath ?? page.urlPath,
      updated: page.updatedIso || undefined,
    },
  });
}

export function renderNotFound({ site, basePath }) {
  const body = `
<section class="not-found">
  <p class="eyebrow">404</p>
  <h1>Page not found</h1>
  <p>The page you were looking for doesn’t exist or has moved.</p>
  <p><a class="button" href="${hreff(basePath, "/")}">Go home</a> <button type="button" class="button button-secondary" data-search-open>Search posts</button></p>
</section>
`;
  return renderLayout({
    site,
    basePath,
    body,
    page: { title: "Page not found", path: "/404.html", noindex: true },
  });
}

export function renderPostList(posts, { basePath, locale = "en-US", emptyMessage = "No posts yet." }) {
  if (!posts.length) return `<p class="empty">${escapeHtml(emptyMessage)}</p>`;
  const groups = groupByYear(posts);
  return groups
    .map(
      ([year, items]) => `
<section class="year-group" aria-labelledby="year-${year}">
  <h2 class="year-label" id="year-${year}">${year}</h2>
  <ol class="post-list">
${items.map((post) => renderPostListItem(post, { basePath, locale })).join("")}
  </ol>
</section>`,
    )
    .join("");
}

export function renderArchiveList(
  posts,
  { basePath, locale = "en-US", emptyMessage = "No posts yet." },
) {
  if (!posts.length) return `<p class="empty">${escapeHtml(emptyMessage)}</p>`;
  return groupByYear(posts)
    .map(
      ([year, items]) => `
<section class="year-group" aria-labelledby="archive-year-${year}">
  <h2 class="year-label" id="archive-year-${year}">${year}</h2>
  <ol class="archive-list">
${items
  .map(
    (post) => `<li><time datetime="${escapeHtml(post.dateIso)}">${escapeHtml(shortDate(post.date, locale))}</time> <a href="${escapeHtml(post.href)}">${escapeHtml(post.title)}</a></li>`,
  )
  .join("\n")}
  </ol>
</section>`,
    )
    .join("");
}

export function renderPagination(current, total, basePath, root = "/") {
  if (total <= 1) return "";
  const base = root.endsWith("/") ? root : `${root}/`;
  const pathFor = (page) => (page <= 1 ? base : `${base}page/${page}/`);
  const newer = current > 1 ? pathFor(current - 1) : null;
  const older = current < total ? pathFor(current + 1) : null;
  return `
<nav class="pagination" aria-label="Pagination">
  ${newer ? `<a class="pagination-link" rel="prev" href="${hreff(basePath, newer)}">← Newer</a>` : '<span class="pagination-spacer"></span>'}
  <span class="pagination-status">Page ${current} of ${total}</span>
  ${older ? `<a class="pagination-link" rel="next" href="${hreff(basePath, older)}">Older →</a>` : '<span class="pagination-spacer"></span>'}
</nav>`;
}

function renderPostListItem(post, { basePath, locale }) {
  return `    <li class="post-item">
      <p class="post-item-meta"><time datetime="${escapeHtml(post.dateIso)}">${escapeHtml(shortDate(post.date, locale))}</time> <span aria-hidden="true">·</span> <span>${post.readingMinutes} min</span></p>
      <h3 class="post-item-title"><a href="${escapeHtml(post.href)}">${escapeHtml(post.title)}</a></h3>
      ${post.excerpt ? `<p class="post-item-excerpt">${escapeHtml(post.excerpt)}</p>` : ""}
      ${renderTagLinks(post.tags, basePath)}
    </li>`;
}

function renderPostNavigation({ newer, older }) {
  if (!newer && !older) return "";
  return `
<nav class="post-nav" aria-label="More posts">
  ${
    newer
      ? `<a class="post-nav-link post-nav-newer" rel="prev" href="${escapeHtml(newer.href)}"><span class="post-nav-label">← Newer</span><span class="post-nav-title">${escapeHtml(newer.title)}</span></a>`
      : '<span class="post-nav-spacer"></span>'
  }
  ${
    older
      ? `<a class="post-nav-link post-nav-older" rel="next" href="${escapeHtml(older.href)}"><span class="post-nav-label">Older →</span><span class="post-nav-title">${escapeHtml(older.title)}</span></a>`
      : '<span class="post-nav-spacer"></span>'
  }
</nav>`;
}

function renderTagLinks(tags, basePath) {
  if (!tags.length) return "";
  return `<ul class="tag-list" aria-label="Tags">${tags
    .map(
      (tag) =>
        `<li><a class="tag" href="${hreff(basePath, `/tags/${tagDirName(tag)}/`)}">#${escapeHtml(tag)}</a></li>`,
    )
    .join("")}</ul>`;
}

function renderSearchDialog(site) {
  return `<dialog id="search-dialog" class="search-dialog" aria-labelledby="search-title">
  <div class="search-panel">
    <h2 id="search-title" class="visually-hidden">Search ${escapeHtml(site.title)}</h2>
    <div class="search-field">
      <svg class="icon" aria-hidden="true" viewBox="0 0 24 24" width="20" height="20"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-3.5-3.5"></path></svg>
      <label class="visually-hidden" for="search-input">Search posts</label>
      <input id="search-input" type="search" placeholder="Search posts…" autocomplete="off" autocapitalize="off" spellcheck="false" aria-controls="search-results" aria-describedby="search-status">
      <button type="button" class="search-close" data-search-close aria-label="Close search">Esc</button>
    </div>
    <p id="search-status" class="search-status" aria-live="polite"></p>
    <ul id="search-results" class="search-results"></ul>
    <p class="search-help"><kbd>↑</kbd><kbd>↓</kbd> navigate <span aria-hidden="true">·</span> <kbd>Enter</kbd> open <span aria-hidden="true">·</span> <kbd>Esc</kbd> close</p>
  </div>
</dialog>`;
}

function themeBootScript() {
  return `<script>try{var t=localStorage.getItem("theme");if(t==="dark"||t==="light")document.documentElement.dataset.theme=t}catch(e){}</script>`;
}

function groupByYear(posts) {
  const groups = new Map();
  for (const post of posts) {
    const year = post.year;
    if (!groups.has(year)) groups.set(year, []);
    groups.get(year).push(post);
  }
  return [...groups.entries()];
}

function shortDate(date, locale = "en-US") {
  return new Intl.DateTimeFormat(locale || "en-US", {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  }).format(date);
}

function assetUrl(site, basePath, image) {
  if (!image) return null;
  if (isExternalUrl(image)) return image;
  const siteRelative = image.startsWith("/") ? image : `/${image}`;
  return absoluteUrl(site.url, urlJoin(basePath, siteRelative));
}

function isActive(currentPath, href) {
  if (!href || isExternalUrl(href)) return false;
  const normalized = href.endsWith("/") ? href : `${href}/`;
  if (normalized === "/") return currentPath === "/";
  return currentPath.startsWith(normalized);
}
