import fs from "node:fs/promises";
import path from "node:path";
import { splitFrontmatter } from "./frontmatter.js";
import { markdownToText, renderMarkdown } from "./markdown.js";
import {
  excerptFromText,
  formatDate,
  formatDateIso,
  normalizeBasePath,
  parseBoolean,
  parseDate,
  readingMinutes,
  slugify,
  tagDirName,
  urlJoin,
  walkFiles,
} from "./utils.js";

const RESERVED_PAGE_SLUGS = new Set([
  "tags",
  "archive",
  "page",
  "posts",
  "blog",
  "assets",
  "feed.xml",
  "sitemap.xml",
  "robots.txt",
  "404.html",
  "search-index.json",
]);

/**
 * Load posts and standalone pages from disk.
 * Returns normalized objects that the build and template layers can share.
 */
export async function loadContent({ root, config, options = {} }) {
  const basePath = normalizeBasePath(config.site.basePath ?? "/");
  const contentDir = path.resolve(root, config.build.contentDir ?? "content");
  const now = options.now ?? new Date();
  const includeDrafts = Boolean(options.drafts);
  const includeFuture = Boolean(options.future ?? config.build.includeFuture);

  const posts = await loadPosts({
    dir: path.join(contentDir, "posts"),
    basePath,
    includeDrafts,
    includeFuture,
    now,
    locale: config.site.lang,
  });

  const pages = await loadPages({
    dir: path.join(contentDir, "pages"),
    basePath,
    includeDrafts,
  });

  const tags = buildTagIndex(posts);
  assertUniqueTagDirs(tags);

  const perPage = Math.max(1, config.build.postsPerPage ?? 20);
  const totalPages = Math.max(1, Math.ceil(posts.length / perPage));

  return { posts, pages, tags, basePath, perPage, totalPages };
}

async function loadPosts({ dir, basePath, includeDrafts, includeFuture, now, locale }) {
  const files = (await walkFiles(dir)).filter((file) => /\.md$/i.test(file));
  const posts = [];
  const seenSlugs = new Map();

  for (const rel of files) {
    const absolute = path.join(dir, ...rel.split("/"));
    const raw = await fs.readFile(absolute, "utf8");
    let parsed;
    try {
      parsed = splitFrontmatter(raw);
    } catch (error) {
      throw new Error(`${rel}: ${error.message}`);
    }
    const { data, body } = parsed;
    const fileBase = path.posix.basename(rel).replace(/\.md$/i, "");
    const datePrefix = /^(\d{4}-\d{2}-\d{2})[-_ ]+/.exec(fileBase)?.[1];
    const derivedSlug = fileBase.replace(/^\d{4}-\d{2}-\d{2}[-_ ]+/, "");

    const title = String(data.title ?? humanize(derivedSlug)).trim();
    if (!title) throw new Error(`${rel}: a title is required (frontmatter or filename)`);

    const dateValue = data.date ?? datePrefix;
    if (!dateValue) {
      throw new Error(`${rel}: a date is required (add "date: YYYY-MM-DD" or prefix the filename with a date)`);
    }
    const date = parseDate(dateValue, `${rel}: date`);

    let draft = false;
    try {
      draft = data.draft == null ? false : parseBoolean(data.draft, `${rel}: draft`);
    } catch (error) {
      throw new Error(error.message);
    }
    if (draft && !includeDrafts) continue;
    if (!includeFuture && date.getTime() > now.getTime()) continue;

    const slug = slugify(data.slug ?? derivedSlug);
    if (!slug) throw new Error(`${rel}: could not derive a slug; add "slug: ..." to the frontmatter`);
    if (seenSlugs.has(slug)) {
      throw new Error(`Duplicate post slug "${slug}" in ${rel} and ${seenSlugs.get(slug)}`);
    }
    seenSlugs.set(slug, rel);

    const tags = normalizeTags(data.tags).filter((tag) => tag.toLowerCase() !== "draft");
    const html = renderMarkdown(body, { basePath });
    const text = markdownToText(body);
    const description = String(data.description ?? "").trim() || excerptFromText(text, 160);
    const updated = data.updated ? parseDate(data.updated, `${rel}: updated`) : null;

    posts.push({
      kind: "post",
      slug,
      title,
      date,
      dateIso: formatDateIso(date),
      dateDisplay: formatDate(date, { locale }),
      dateRfc: date.toUTCString(),
      year: date.getUTCFullYear(),
      updated,
      updatedIso: updated ? formatDateIso(updated) : null,
      description,
      excerpt: excerptFromText(description || text, 170),
      tags,
      draft,
      image: data.image ? String(data.image) : null,
      author: data.author ? String(data.author) : null,
      html,
      text,
      readingMinutes: readingMinutes(text),
      sourcePath: rel,
      urlPath: `/posts/${slug}/`,
      href: urlJoin(basePath, `/posts/${slug}/`),
    });
  }

  posts.sort((a, b) => b.date - a.date || a.title.localeCompare(b.title));
  return posts;
}

async function loadPages({ dir, basePath, includeDrafts }) {
  const files = (await walkFiles(dir)).filter((file) => /\.md$/i.test(file));
  const pages = [];
  const seenSlugs = new Map();

  for (const rel of files) {
    const absolute = path.join(dir, ...rel.split("/"));
    const raw = await fs.readFile(absolute, "utf8");
    let parsed;
    try {
      parsed = splitFrontmatter(raw);
    } catch (error) {
      throw new Error(`${rel}: ${error.message}`);
    }
    const { data, body } = parsed;
    if (data.draft != null && parseBoolean(data.draft, `${rel}: draft`) && !includeDrafts) continue;

    const fileBase = path.posix.basename(rel).replace(/\.md$/i, "");
    const slug = slugify(data.slug ?? fileBase);
    if (!slug) throw new Error(`${rel}: could not derive a slug; add "slug: ..." to the frontmatter`);
    if (RESERVED_PAGE_SLUGS.has(slug)) {
      throw new Error(`${rel}: the page slug "${slug}" is reserved by the generator`);
    }
    if (seenSlugs.has(slug)) {
      throw new Error(`Duplicate page slug "${slug}" in ${rel} and ${seenSlugs.get(slug)}`);
    }
    seenSlugs.set(slug, rel);

    const html = renderMarkdown(body, { basePath });
    const text = markdownToText(body);
    const title = String(data.title ?? humanize(fileBase)).trim();
    const updated = data.updated ? parseDate(data.updated, `${rel}: updated`) : null;

    pages.push({
      kind: "page",
      slug,
      title,
      description: String(data.description ?? "").trim() || excerptFromText(text, 160),
      html,
      text,
      order: Number.isFinite(Number(data.order)) ? Number(data.order) : 999,
      updated,
      updatedIso: updated ? formatDateIso(updated) : null,
      urlPath: `/${slug}/`,
      href: urlJoin(basePath, `/${slug}/`),
      sourcePath: rel,
    });
  }

  pages.sort((a, b) => a.order - b.order || a.title.localeCompare(b.title));
  return pages;
}

export function buildTagIndex(posts) {
  const groups = new Map();
  for (const post of posts) {
    for (const tag of post.tags) {
      const key = tag.toLowerCase();
      if (!groups.has(key)) {
        groups.set(key, { name: tag, dir: tagDirName(tag), posts: [] });
      }
      groups.get(key).posts.push(post);
    }
  }
  return [...groups.values()].sort(
    (a, b) => b.posts.length - a.posts.length || a.name.localeCompare(b.name),
  );
}

function assertUniqueTagDirs(tags) {
  const dirs = new Map();
  for (const tag of tags) {
    if (dirs.has(tag.dir) && dirs.get(tag.dir) !== tag.name) {
      throw new Error(
        `Tags "${dirs.get(tag.dir)}" and "${tag.name}" both map to /tags/${tag.dir}/; rename one of them`,
      );
    }
    dirs.set(tag.dir, tag.name);
  }
}

export function normalizeTags(value) {
  if (value == null || value === "") return [];
  const list = Array.isArray(value) ? value : String(value).split(",");
  const seen = new Set();
  const tags = [];
  for (const item of list) {
    const tag = String(item).trim();
    if (!tag) continue;
    const key = tag.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    tags.push(tag);
  }
  return tags;
}

function humanize(value) {
  return String(value)
    .replace(/[-_]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^./, (char) => char.toUpperCase());
}
