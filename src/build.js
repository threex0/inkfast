import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { normalizeHomePage } from "./config.js";
import { loadContent } from "./content.js";
import { renderRobots, renderRss, renderSearchIndex, renderSitemap } from "./feed.js";
import {
  renderArchive,
  renderHome,
  renderNotFound,
  renderPage,
  renderPost,
  renderTagPage,
  renderTagsIndex,
} from "./templates.js";
import {
  copyDir,
  ensureDir,
  formatBytes,
  normalizeBasePath,
  pathExists,
  removeDir,
  walkFiles,
  writeFileEnsured,
} from "./utils.js";

export async function buildSite(args) {
  const release = await acquireBuildLock(args.root);
  try {
    return await runBuild(args);
  } finally {
    await release();
  }
}

async function runBuild({ root, config, options = {} }) {
  const started = performance.now();
  const basePath = normalizeBasePath(config.site.basePath);
  const outDir = path.resolve(root, config.build.outDir || "dist");
  assertSafeOutDir(root, outDir, config);

  const site = { ...config.site, basePath };
  const content = await loadContent({ root, config, options });
  const { posts, pages, tags, totalPages, perPage } = content;

  const homePageSlug = normalizeHomePage(config.site.homePage);
  const homePage = homePageSlug
    ? pages.find((page) => page.slug === homePageSlug)
    : null;
  if (homePageSlug && !homePage) {
    const available = pages.map((page) => page.slug).join(", ") || "none";
    throw new Error(
      `site.homePage "${homePageSlug}" does not match any page in content/pages (available: ${available})`,
    );
  }
  // When a page is the home page, the blog listing moves to /blog/.
  const listingRoot = homePage ? "/blog/" : "/";

  const warnings = [];
  if (!site.url) {
    warnings.push(
      "site.url is empty, so feed/sitemap links are relative. Set it in blog.config.local.json for production.",
    );
  }

  const stagingDir = `${outDir}.tmp-${process.pid}`;
  await removeDir(stagingDir);
  await ensureDir(stagingDir);

  let filesWritten = 0;
  const write = async (relativePath, contents) => {
    const target = path.join(stagingDir, ...relativePath.split("/"));
    await writeFileEnsured(target, contents);
    filesWritten += 1;
  };

  try {
    const staticDir = path.resolve(root, "static");
    if (await pathExists(staticDir)) {
      await copyDir(staticDir, stagingDir);
    }
    await copyDir(path.resolve(root, "src", "assets"), path.join(stagingDir, "assets"));

    if (homePage) {
      await write(
        "index.html",
        renderPage({ page: homePage, site, basePath, path: "/", bodyClass: "is-home" }),
      );
    }

    for (let pageNumber = 1; pageNumber <= totalPages; pageNumber += 1) {
      const html = renderHome({
        site,
        posts,
        pageNumber,
        totalPages,
        perPage,
        basePath,
        listingRoot,
        isListingHome: !homePage,
      });
      await write(listingRoute(listingRoot, pageNumber), html);
    }

    for (let index = 0; index < posts.length; index += 1) {
      const post = posts[index];
      const html = renderPost({
        post,
        newer: posts[index - 1] ?? null,
        older: posts[index + 1] ?? null,
        site,
        basePath,
      });
      await write(`${post.urlPath.replace(/^\//, "")}index.html`, html);
    }

    for (const page of pages) {
      await write(
        `${page.urlPath.replace(/^\//, "")}index.html`,
        renderPage({ page, site, basePath }),
      );
    }

    await write("tags/index.html", renderTagsIndex({ tags, site, basePath }));
    for (const tag of tags) {
      await write(`tags/${tag.dir}/index.html`, renderTagPage({ tag, site, basePath }));
    }
    await write("archive/index.html", renderArchive({ posts, site, basePath }));
    await write("404.html", renderNotFound({ site, basePath }));

    await write("feed.xml", renderRss({ site, posts, basePath, limit: config.build.feedLimit }));
    await write(
      "sitemap.xml",
      renderSitemap({ site, posts, pages, tags, totalPages, basePath, listingRoot }),
    );
    await write("robots.txt", renderRobots({ site, basePath }));
    const index = renderSearchIndex({
      posts,
      site,
      basePath,
      textLimit: config.build.searchTextLimit,
    });
    await write("search-index.json", `${JSON.stringify(index, null, 2)}\n`);

    await removeDir(outDir);
    await renameWithRetry(stagingDir, outDir);
  } catch (error) {
    await removeDir(stagingDir).catch(() => {});
    throw error;
  }

  const files = await walkFiles(outDir);
  let bytes = 0;
  for (const relativePath of files) {
    const stat = await fs.stat(path.join(outDir, ...relativePath.split("/")));
    bytes += stat.size;
  }

  return {
    outDir,
    site,
    posts,
    pages,
    tags,
    totalPages,
    perPage,
    files: files.length,
    filesWritten,
    bytes,
    bytesDisplay: formatBytes(bytes),
    durationMs: Math.round(performance.now() - started),
    warnings,
  };
}

/** "/" -> index.html / page/N/; "/blog/" -> blog/index.html / blog/page/N/. */
function listingRoute(root, pageNumber) {
  const prefix = root.replace(/^\/+|\/+$/g, "");
  if (pageNumber === 1) return prefix ? `${prefix}/index.html` : "index.html";
  return prefix ? `${prefix}/page/${pageNumber}/index.html` : `page/${pageNumber}/index.html`;
}

export function assertSafeOutDir(root, outDir, config) {
  const rootDir = path.resolve(root);
  const contentDir = path.resolve(rootDir, config.build.contentDir || "content");
  const srcDir = path.resolve(rootDir, "src");

  if (outDir === path.parse(outDir).root) {
    throw new Error(`Refusing to use the filesystem root as build.outDir (${outDir})`);
  }
  if (outDir === rootDir || isInside(outDir, rootDir)) {
    throw new Error(`build.outDir (${outDir}) must not contain the project directory`);
  }
  const protectedDirs = [
    ["content directory", contentDir],
    ["src directory", srcDir],
    ["static directory", path.resolve(rootDir, "static")],
  ];
  for (const [label, dir] of protectedDirs) {
    if (outDir === dir || isInside(outDir, dir) || isInside(dir, outDir)) {
      throw new Error(`build.outDir (${outDir}) overlaps the ${label} (${dir})`);
    }
  }
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

async function renameWithRetry(source, destination) {
  let lastError;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      await fs.rename(source, destination);
      return;
    } catch (error) {
      lastError = error;
      if (!["EPERM", "EBUSY", "EACCES"].includes(error.code)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 60 * (attempt + 1)));
    }
  }
  throw lastError;
}

const LOCK_WAIT_MS = 15000;
const LOCK_STALE_MS = 10 * 60 * 1000;

/**
 * One build at a time per project. This keeps a manual `npm run build`
 * from fighting with a dev-server rebuild over the same output directory.
 */
async function acquireBuildLock(root) {
  const lockPath = path.join(root, ".blog-cache", "build.lock");
  await ensureDir(path.dirname(lockPath));
  const token = randomUUID();
  const deadline = Date.now() + LOCK_WAIT_MS;

  for (;;) {
    try {
      const handle = await fs.open(lockPath, "wx");
      await handle.writeFile(
        JSON.stringify({ pid: process.pid, token, at: new Date().toISOString() }),
      );
      await handle.close();
      return async () => {
        try {
          const info = JSON.parse(await fs.readFile(lockPath, "utf8"));
          if (info.token === token) await fs.rm(lockPath, { force: true });
        } catch {
          /* lock already gone */
        }
      };
    } catch (error) {
      if (error.code !== "EEXIST") throw error;

      let stale = false;
      try {
        const info = JSON.parse(await fs.readFile(lockPath, "utf8"));
        const age = Date.now() - Date.parse(info.at);
        stale = !isProcessAlive(info.pid) || !Number.isFinite(age) || age > LOCK_STALE_MS;
      } catch {
        stale = true;
      }
      if (stale) {
        await fs.rm(lockPath, { force: true }).catch(() => {});
        continue;
      }
      if (Date.now() > deadline) {
        throw new Error(
          `Another build is still running (lock: ${lockPath}). Remove the lock file if it is stale.`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 150));
    }
  }
}

function isProcessAlive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === "EPERM";
  }
}
