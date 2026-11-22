import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import { buildSite } from "../src/build.js";
import { startDevServer, startPreviewServer } from "../src/server.js";
import { configFor, post, silentLogger, writeProject } from "./helpers.js";

const NOW = new Date("2026-01-01T00:00:00Z");

async function project(t) {
  const root = await writeProject(t, {
    posts: {
      "2020-01-01-hello.md": post({
        title: "Hello Dev",
        date: "2020-01-01",
        description: "A dev server test.",
        tags: ["test"],
        body: "Hello from the dev server.",
      }),
    },
  });
  return root;
}

test("serves built pages, assets, 404s, and injects the reload script", async (t) => {
  const root = await project(t);
  const config = configFor();
  await buildSite({ root, config, options: { now: NOW } });

  const dev = await startDevServer({
    root,
    config,
    port: 0,
    logger: silentLogger(),
    rebuild: async () => ({ files: 0, durationMs: 0 }),
  });
  t.after(() => dev.close());

  const home = await fetch(dev.url);
  assert.equal(home.status, 200);
  assert.match(home.headers.get("content-type"), /text\/html/);
  const html = await home.text();
  assert.match(html, /Hello Dev/);
  assert.match(html, /__reload/);

  const css = await fetch(new URL("assets/style.css", dev.url));
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css/);

  const postResponse = await fetch(new URL("posts/hello/", dev.url));
  assert.equal(postResponse.status, 200);
  assert.match(await postResponse.text(), /Hello from the dev server/);

  const missing = await fetch(new URL("does-not-exist", dev.url));
  assert.equal(missing.status, 404);
  assert.match(await missing.text(), /Page not found/);

  const traversal = await fetch(`${dev.url}..%2f..%2fpackage.json`);
  assert.ok([403, 404].includes(traversal.status));
});

test("honours a base path and redirects directories with a trailing slash", async (t) => {  const root = await project(t);
  const config = configFor({ site: { basePath: "/blog/" } });
  await buildSite({ root, config, options: { now: NOW } });

  const dev = await startDevServer({
    root,
    config,
    port: 0,
    logger: silentLogger(),
    rebuild: async () => ({ files: 0, durationMs: 0 }),
  });
  t.after(() => dev.close());

  assert.match(dev.url, /\/blog\/$/);
  const home = await fetch(dev.url);
  assert.equal(home.status, 200);
  assert.match(await home.text(), /href="\/blog\/assets\/style.css"/);

  const bare = await fetch(new URL("/blog", dev.url), { redirect: "manual" });
  assert.equal(bare.status, 301);
  assert.equal(bare.headers.get("location"), "/blog/");

  const noSlash = await fetch(new URL("posts/hello", dev.url), { redirect: "manual" });
  assert.equal(noSlash.status, 301);
  assert.equal(noSlash.headers.get("location"), "/blog/posts/hello/");

  const outside = await fetch(new URL("/", dev.url));
  assert.equal(outside.status, 404);
});

test("preview serves an existing build without injecting the reload script", async (t) => {
  const root = await project(t);
  const config = configFor();
  await buildSite({ root, config, options: { now: NOW } });

  const preview = await startPreviewServer({
    root,
    config,
    port: 0,
    logger: silentLogger(),
  });
  t.after(() => preview.close());

  const home = await fetch(preview.url);
  assert.equal(home.status, 200);
  const html = await home.text();
  assert.match(html, /Hello Dev/);
  assert.doesNotMatch(html, /__reload/);

  const css = await fetch(new URL("assets/style.css", preview.url));
  assert.equal(css.status, 200);
  assert.match(css.headers.get("content-type"), /text\/css/);
});

test("preview refuses to start without a build", async (t) => {
  const root = await project(t);
  await assert.rejects(
    startPreviewServer({ root, config: configFor(), port: 0, logger: silentLogger() }),
    /Run "npm run build" first/,
  );
});

test("watches content changes and triggers a rebuild", async (t) => {
  const root = await project(t);
  const config = configFor();
  await buildSite({ root, config, options: { now: NOW } });

  let rebuilds = 0;
  const warnings = [];
  const logger = {
    log() {},
    error() {},
    warn(message) {
      warnings.push(message);
    },
  };

  const dev = await startDevServer({
    root,
    config,
    port: 0,
    logger,
    rebuild: async () => {
      rebuilds += 1;
      return { files: 0, durationMs: 0 };
    },
  });
  t.after(() => dev.close());

  await fs.writeFile(
    path.join(root, "content", "posts", "2020-01-02-new.md"),
    post({ title: "New Post", date: "2020-01-02" }),
  );

  const deadline = Date.now() + 5000;
  while (rebuilds === 0 && Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  assert.ok(rebuilds > 0, "expected the content watcher to trigger a rebuild");
  assert.deepEqual(warnings, []);
});
