import { absoluteUrl, urlJoin } from "./utils.js";

export function renderSearchIndex({ posts, site, basePath, textLimit = 12000 }) {
  return {
    version: 1,
    site: { title: site.title, basePath },
    posts: posts.map((post) => ({
      title: post.title,
      url: post.href,
      date: post.dateIso,
      dateDisplay: post.dateDisplay,
      tags: post.tags,
      description: post.description,
      text: String(post.text || "").slice(0, textLimit),
    })),
  };
}

export function renderRss({ site, posts, basePath, limit = 20 }) {
  const feedUrl = absoluteUrl(site.url, urlJoin(basePath, "feed.xml"));
  const homeUrl = absoluteUrl(site.url, basePath);
  const items = posts
    .slice(0, limit)
    .map((post) => {
      const link = absoluteUrl(site.url, post.href);
      return `    <item>
      <title>${xml(post.title)}</title>
      <link>${xml(link)}</link>
      <guid isPermaLink="true">${xml(link)}</guid>
      <pubDate>${xml(post.dateRfc)}</pubDate>
      <description>${xml(post.description)}</description>
${post.tags.map((tag) => `      <category>${xml(tag)}</category>`).join("\n")}
    </item>`;
    })
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${xml(site.title)}</title>
    <link>${xml(homeUrl)}</link>
    <description>${xml(site.description || "")}</description>
    <language>${xml(site.lang || "en")}</language>
${posts.length ? `    <lastBuildDate>${xml(posts[0].dateRfc)}</lastBuildDate>\n` : ""}    <atom:link href="${xml(feedUrl)}" rel="self" type="application/rss+xml"/>
${items}
  </channel>
</rss>
`;
}

export function renderSitemap({
  site,
  posts,
  pages,
  tags,
  totalPages,
  basePath,
  listingRoot = "/",
}) {
  const entries = [];
  const root = listingRoot.endsWith("/") ? listingRoot : `${listingRoot}/`;
  const add = (path, lastmod) => {
    entries.push({
      loc: absoluteUrl(site.url, urlJoin(basePath, path)),
      lastmod: lastmod || null,
    });
  };

  add("/");
  if (root !== "/") add(root);
  for (let page = 2; page <= totalPages; page += 1) add(`${root}page/${page}/`);
  add("/archive/");
  add("/tags/");
  for (const tag of tags) add(`/tags/${tag.dir}/`);
  for (const post of posts) add(post.urlPath, post.updatedIso || post.dateIso);
  for (const page of pages) add(page.urlPath, page.updatedIso || undefined);

  const urls = entries
    .map(
      (entry) =>
        `  <url><loc>${xml(entry.loc)}</loc>${entry.lastmod ? `<lastmod>${xml(entry.lastmod)}</lastmod>` : ""}</url>`,
    )
    .join("\n");

  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls}
</urlset>
`;
}

export function renderRobots({ site, basePath }) {
  const lines = ["User-agent: *", "Allow: /"];
  if (site.url) {
    lines.push("", `Sitemap: ${absoluteUrl(site.url, urlJoin(basePath, "sitemap.xml"))}`);
  }
  return `${lines.join("\n")}\n`;
}

function xml(value) {
  return String(value ?? "").replace(/[<>&'"]/g, (char) => {
    switch (char) {
      case "<":
        return "&lt;";
      case ">":
        return "&gt;";
      case "&":
        return "&amp;";
      case "'":
        return "&apos;";
      default:
        return "&quot;";
    }
  });
}
