import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { assertSafeOutDir, buildSite } from "../src/build.js";
import { configFor, post, writeProject } from "./helpers.js";

const NOW = new Date("2026-01-01T00:00:00Z");

async function read(root, relative) {
  return fs.readFile(path.join(root, ...relative.split("/")), "utf8");
}

function baseProject(t) {
  return writeProject(t, {
    posts: {
      "2020-01-01-first.md": post({
        title: "First Post",
        date: "2020-01-01",
        description: "The first post.",
        tags: ["one", "shared"],
        body: [
          "# A heading",
          "",
          "Read [about](/about/) or the [second post](/posts/second/).",
          "",
          "![Map](/images/pic.svg)",
          "",
          "```js",
          "const x = 1;",
          "```",
        ].join("\n"),
      }),
      "2020-02-02-second.md": post({
        title: "Second & Last",
        date: "2020-02-02",
        description: "The second post.",
        tags: ["two", "shared"],
        body: "The last body.",
      }),
      "draft.md": post({
        title: "Draft Post",
        date: "2020-03-03",
        draft: true,
      }),
      "future.md": post({
        title: "Future Post",
        date: "2099-01-01",
      }),
    },
    pages: {
      "about.md": "---\ntitle: About\ndescription: About this site.\norder: 1\n---\n\nAbout body.\n",
    },
    staticFiles: {
      "favicon.svg": "<svg></svg>",
      "images/pic.svg": "<svg></svg>",
    },
  });
}

test("build writes posts, pages, tags, archive, feeds, and search data", async (t) => {
  const root = await baseProject(t);
  const config = configFor();
  const result = await buildSite({ root, config, options: { now: NOW } });

  assert.equal(result.posts.length, 2);
  assert.equal(result.pages.length, 1);
  assert.equal(result.tags.length, 3);
  assert.equal(result.totalPages, 1);
  assert.ok(result.files >= 15);

  const index = await read(root, "dist/index.html");
  assert.match(index, /First Post/);
  assert.match(index, /Second &amp; Last/);
  assert.doesNotMatch(index, /Draft Post/);
  assert.doesNotMatch(index, /Future Post/);
  assert.match(index, /href="\/posts\/first\/"/);
  assert.match(index, /href="\/tags\/shared\/"/);
  assert.match(index, /href="\/assets\/style.css"/);

  for (const file of [
    "dist/posts/first/index.html",
    "dist/posts/second/index.html",
    "dist/about/index.html",
    "dist/tags/index.html",
    "dist/tags/one/index.html",
    "dist/tags/shared/index.html",
    "dist/archive/index.html",
    "dist/feed.xml",
    "dist/sitemap.xml",
    "dist/robots.txt",
    "dist/search-index.json",
    "dist/404.html",
    "dist/assets/style.css",
    "dist/assets/app.js",
    "dist/favicon.svg",
    "dist/images/pic.svg",
  ]) {
    await fs.access(path.join(root, ...file.split("/")));
  }

  const postHtml = await read(root, "dist/posts/first/index.html");
  assert.match(postHtml, /id="a-heading"/);
  assert.match(postHtml, /href="\/about\/"/);
  assert.match(postHtml, /class="language-js"/);
  assert.match(postHtml, /loading="lazy"/);

  const search = JSON.parse(await read(root, "dist/search-index.json"));
  assert.equal(search.posts.length, 2);
  assert.deepEqual(search.posts.map((entry) => entry.title).sort(), ["First Post", "Second & Last"]);
  assert.ok(search.posts.every((entry) => entry.url.startsWith("/posts/")));
  assert.ok(search.posts.every((entry) => !entry.text.includes("<")));

  const feed = await read(root, "dist/feed.xml");
  assert.match(feed, /<item>/);
  assert.doesNotMatch(feed, /Draft Post/);
  assert.doesNotMatch(feed, /Future Post/);

  const sitemap = await read(root, "dist/sitemap.xml");
  assert.match(sitemap, /\/posts\/first\//);
  assert.match(sitemap, /\/about\//);

  const robots = await read(root, "dist/robots.txt");
  assert.match(robots, /User-agent: \*/);
});

test("drafts and future posts can be included explicitly", async (t) => {
  const root = await baseProject(t);
  const config = configFor();

  const drafts = await buildSite({ root, config, options: { now: NOW, drafts: true } });
  assert.equal(drafts.posts.length, 3);
  assert.ok(drafts.posts.some((item) => item.title === "Draft Post"));

  const future = await buildSite({ root, config, options: { now: NOW, future: true } });
  assert.equal(future.posts.length, 3);
  assert.ok(future.posts.some((item) => item.title === "Future Post"));

  const all = await buildSite({ root, config, options: { now: NOW, drafts: true, future: true } });
  assert.equal(all.posts.length, 4);
});

test("pagination generates numbered pages with rel links", async (t) => {
  const root = await writeProject(t, {
    posts: {
      "2020-01-01-a.md": post({ title: "Post A", date: "2020-01-01" }),
      "2020-01-02-b.md": post({ title: "Post B", date: "2020-01-02" }),
      "2020-01-03-c.md": post({ title: "Post C", date: "2020-01-03" }),
    },
  });
  const config = configFor({ build: { postsPerPage: 2 } });
  const result = await buildSite({ root, config, options: { now: NOW } });
  assert.equal(result.totalPages, 2);

  const page1 = await read(root, "dist/index.html");
  assert.match(page1, /Post C/);
  assert.match(page1, /Post B/);
  assert.doesNotMatch(page1, /Post A/);
  assert.match(page1, /rel="next" href="\/page\/2\/"/);
  assert.match(page1, /Page 1 of 2/);

  const page2 = await read(root, "dist/page/2/index.html");
  assert.match(page2, /Post A/);
  assert.match(page2, /rel="prev" href="\/"/);
  assert.match(page2, /Page 2 of 2/);
  assert.match(page2, /<h1>Posts<\/h1>/);
});

test("site.homePage renders a page at / and moves the blog listing to /blog/", async (t) => {
  const root = await writeProject(t, {
    posts: {
      "2020-01-01-a.md": post({ title: "Post A", date: "2020-01-01" }),
      "2020-01-02-b.md": post({ title: "Post B", date: "2020-01-02" }),
      "2020-01-03-c.md": post({ title: "Post C", date: "2020-01-03" }),
    },
    pages: {
      "about.md": "---\ntitle: About\ndescription: About this site.\n---\n\nAbout body.\n",
    },
  });
  const config = configFor({ site: { homePage: "/about/" }, build: { postsPerPage: 2 } });
  const result = await buildSite({ root, config, options: { now: NOW } });
  assert.equal(result.totalPages, 2);

  const home = await read(root, "dist/index.html");
  assert.match(home, /About body/);
  assert.doesNotMatch(home, /Post C/);
  assert.match(home, /rel="canonical" href="\/"/);

  const blog1 = await read(root, "dist/blog/index.html");
  assert.match(blog1, /Post C/);
  assert.match(blog1, /Post B/);
  assert.doesNotMatch(blog1, /Post A/);
  assert.match(blog1, /rel="next" href="\/blog\/page\/2\/"/);
  assert.match(blog1, /<h1>Posts<\/h1>/);

  const blog2 = await read(root, "dist/blog/page/2/index.html");
  assert.match(blog2, /Post A/);
  assert.match(blog2, /rel="prev" href="\/blog\/"/);

  const sitemap = await read(root, "dist/sitemap.xml");
  assert.match(sitemap, /\/blog\//);
  assert.match(sitemap, /\/blog\/page\/2\//);
});

test("a missing home page fails with a clear message", async (t) => {
  const root = await writeProject(t);
  const config = configFor({ site: { homePage: "nope" } });
  await assert.rejects(
    buildSite({ root, config, options: { now: NOW } }),
    /site\.homePage "nope" does not match any page/,
  );
});

test("base path is applied to links, assets, and search results", async (t) => {
  const root = await writeProject(t, {
    posts: {
      "2020-01-01-hello.md": post({
        title: "Hello",
        date: "2020-01-01",
        tags: ["tag"],
        body: "See [about](/about/) and ![pic](/images/pic.svg).",
        extra: "image: /images/pic.svg",
      }),
    },
    pages: { "about.md": "---\ntitle: About\n---\n\nAbout.\n" },
    staticFiles: { "images/pic.svg": "<svg></svg>" },
  });
  const config = configFor({ site: { basePath: "/blog/" } });
  await buildSite({ root, config, options: { now: NOW } });

  const index = await read(root, "dist/index.html");
  assert.match(index, /href="\/blog\/assets\/style.css"/);
  assert.match(index, /href="\/blog\/posts\/hello\/"/);
  assert.match(index, /href="\/blog\/archive\/"/);
  assert.match(index, /data-base="\/blog\/"/);
  assert.match(index, /href="\/blog\/feed.xml"/);

  const postHtml = await read(root, "dist/posts/hello/index.html");
  assert.match(postHtml, /href="\/blog\/about\/"/);
  assert.match(postHtml, /src="\/blog\/images\/pic.svg"/);
  assert.match(postHtml, /property="og:image" content="\/blog\/images\/pic.svg"/);

  const search = JSON.parse(await read(root, "dist/search-index.json"));
  assert.equal(search.posts[0].url, "/blog/posts/hello/");
  assert.equal(search.site.basePath, "/blog/");
});

test("nav supports external links without a base-path prefix", async (t) => {
  const root = await writeProject(t);
  const config = configFor({
    site: {
      basePath: "/site/",
      nav: [
        { label: "Blog", href: "/blog/" },
        { label: "lVl", href: "https://designeragents.com/lvl/" },
        {
          label: "LinkedIn",
          href: "https://www.linkedin.com/in/example/",
          icon: "linkedin",
        },
        { label: "RSS", href: "/feed.xml", icon: "not-a-real-icon" },
      ],
    },
  });
  await buildSite({ root, config, options: { now: NOW } });
  const home = await read(root, "dist/index.html");
  assert.match(home, /<a href="\/site\/blog\/">Blog<\/a>/);
  assert.match(
    home,
    /<a href="https:\/\/designeragents\.com\/lvl\/">lVl<\/a>/,
  );
  assert.match(
    home,
    /<a class="nav-icon" href="https:\/\/www\.linkedin\.com\/in\/example\/" aria-label="LinkedIn" title="LinkedIn">/,
  );
  assert.match(home, /<svg class="icon icon-fill" aria-hidden="true" focusable="false"/);
  assert.match(home, /<path d="M0 1\.146/);
  assert.match(home, /<a href="\/site\/feed\.xml">RSS<\/a>/);
});

test("duplicate or reserved slugs fail with a helpful message", async (t) => {
  const root = await writeProject(t, {
    posts: {
      "a.md": post({ title: "A", date: "2020-01-01", slug: "same" }),
      "b.md": post({ title: "B", date: "2020-01-02", slug: "same" }),
    },
  });
  await assert.rejects(
    buildSite({ root, config: configFor(), options: { now: NOW } }),
    /Duplicate post slug "same"/,
  );

  const pagesRoot = await writeProject(t, {
    pages: { "tags.md": "---\ntitle: Tags\n---\n\nNope.\n" },
  });
  await assert.rejects(
    buildSite({ root: pagesRoot, config: configFor(), options: { now: NOW } }),
    /reserved by the generator/,
  );

  const blogRoot = await writeProject(t, {
    pages: { "blog.md": "---\ntitle: Blog\n---\n\nNope.\n" },
  });
  await assert.rejects(
    buildSite({ root: blogRoot, config: configFor(), options: { now: NOW } }),
    /reserved by the generator/,
  );
});

test("an empty blog still builds a useful home page", async (t) => {
  const root = await writeProject(t);
  const result = await buildSite({ root, config: configFor(), options: { now: NOW } });
  assert.equal(result.posts.length, 0);
  const index = await read(root, "dist/index.html");
  assert.match(index, /No posts yet/);
  const search = JSON.parse(await read(root, "dist/search-index.json"));
  assert.deepEqual(search.posts, []);
});

test("unsafe output directories are rejected", async (t) => {
  const root = await writeProject(t);
  const config = configFor();
  assert.throws(() => assertSafeOutDir(root, root, config), /must not contain/);
  assert.throws(
    () => assertSafeOutDir(root, path.join(root, "content"), config),
    /overlaps the content directory/,
  );
  assert.throws(
    () => assertSafeOutDir(root, path.join(root, "src"), config),
    /overlaps the src directory/,
  );
  assert.doesNotThrow(() => assertSafeOutDir(root, path.join(root, "dist"), config));
});

test("stale build locks are recovered and the lock is released", async (t) => {
  const root = await writeProject(t);
  const lockDir = path.join(root, ".blog-cache");
  const lockFile = path.join(lockDir, "build.lock");
  await fs.mkdir(lockDir, { recursive: true });
  await fs.writeFile(
    lockFile,
    JSON.stringify({ pid: 2147483647, token: "stale", at: new Date().toISOString() }),
  );

  const result = await buildSite({ root, config: configFor(), options: { now: NOW } });
  assert.ok(result.files > 0);
  await assert.rejects(fs.access(lockFile));
});
