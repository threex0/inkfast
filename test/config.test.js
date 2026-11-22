import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  DEFAULT_CONFIG,
  loadConfig,
  normalizeRemoteDir,
  parseSecure,
  validateConfig,
} from "../src/config.js";
import { configFor, tempRoot } from "./helpers.js";

function withEnv(t, values) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value == null) delete process.env[key];
    else process.env[key] = value;
  }
  t.after(() => {
    for (const [key, value] of previous) {
      if (value == null) delete process.env[key];
      else process.env[key] = value;
    }
  });
}

test("loads defaults, merges file config, and applies env overrides", async (t) => {
  const root = await tempRoot(t);
  await fs.writeFile(
    path.join(root, "blog.config.json"),
    JSON.stringify({
      site: { title: "File title", url: "https://file.example" },
      deploy: { host: "file.example", user: "file-user", password: "file-pass" },
    }),
  );
  withEnv(t, {
    BLOG_FTP_HOST: "env.example",
    BLOG_FTP_USER: "env-user",
    BLOG_FTP_PASSWORD: "env-pass",
    BLOG_FTP_SECURE: "implicit",
    BLOG_FTP_REMOTE_DIR: "public_html/blog",
    BLOG_SITE_URL: "https://env.example",
  });

  const { config } = await loadConfig({ root });
  assert.equal(config.site.title, "File title");
  assert.equal(config.site.url, "https://env.example");
  assert.equal(config.site.basePath, "/");
  assert.equal(config.deploy.host, "env.example");
  assert.equal(config.deploy.user, "env-user");
  assert.equal(config.deploy.password, "env-pass");
  assert.equal(config.deploy.secure, "implicit");
  assert.equal(config.deploy.remoteDir, "/public_html/blog");
});

test("local config overrides the committed config, and env still wins", async (t) => {
  const root = await tempRoot(t);
  await fs.writeFile(
    path.join(root, "blog.config.json"),
    JSON.stringify({
      site: { title: "Shared", url: "https://shared.example" },
      build: { postsPerPage: 10 },
    }),
  );
  await fs.writeFile(
    path.join(root, "blog.config.local.json"),
    JSON.stringify({ site: { title: "Local" }, build: { postsPerPage: 5 } }),
  );
  withEnv(t, { BLOG_SITE_URL: "https://env.example" });

  const { config } = await loadConfig({ root });
  assert.equal(config.site.title, "Local");
  assert.equal(config.build.postsPerPage, 5);
  assert.equal(config.site.url, "https://env.example");
});

test("loading config does not mutate shared defaults", async (t) => {
  const root = await tempRoot(t);
  await fs.writeFile(
    path.join(root, "blog.config.json"),
    JSON.stringify({ site: { title: "One", basePath: "/one/" }, build: { postsPerPage: 2 } }),
  );
  const first = await loadConfig({ root });
  assert.equal(first.config.site.title, "One");
  assert.equal(first.config.site.basePath, "/one/");

  assert.equal(DEFAULT_CONFIG.site.title, "My Blog");
  assert.equal(DEFAULT_CONFIG.site.basePath, "/");
  assert.equal(DEFAULT_CONFIG.build.postsPerPage, 20);

  const secondRoot = await tempRoot(t);
  const second = await loadConfig({ root: secondRoot });
  assert.equal(second.config.site.title, "My Blog");
});

test("rejects invalid settings", () => {
  assert.throws(
    () => validateConfig(configFor({ build: { postsPerPage: 0 } })),
    /postsPerPage/,
  );
  assert.throws(
    () => validateConfig(configFor({ build: { feedLimit: 0 } })),
    /feedLimit/,
  );
  assert.throws(
    () => validateConfig(configFor({ build: { searchTextLimit: 10 } })),
    /searchTextLimit/,
  );
  assert.throws(
    () => validateConfig(configFor({ build: { previewPort: 0 } })),
    /previewPort/,
  );
  assert.throws(
    () => validateConfig(configFor({ site: { url: "example.com" } })),
    /site.url/,
  );
  assert.throws(
    () => validateConfig(configFor({ site: { basePath: "/../evil/" } })),
    /basePath/,
  );
  assert.throws(
    () => validateConfig(configFor({ deploy: { port: 70000 } })),
    /deploy.port/,
  );
});

test("normalises FTP remote paths and secure modes", () => {
  assert.equal(normalizeRemoteDir("/"), "/");
  assert.equal(normalizeRemoteDir(""), "/");
  assert.equal(normalizeRemoteDir("public_html"), "/public_html");
  assert.equal(normalizeRemoteDir("/public_html/"), "/public_html");
  assert.throws(() => normalizeRemoteDir("/a/../b"), /may not contain/);

  assert.equal(parseSecure(false), false);
  assert.equal(parseSecure(true), true);
  assert.equal(parseSecure("false"), false);
  assert.equal(parseSecure("explicit"), true);
  assert.equal(parseSecure("implicit"), "implicit");
  assert.throws(() => parseSecure("maybe"), /must be false, true/);
});

test("reports malformed JSON clearly", async (t) => {
  const root = await tempRoot(t);
  await fs.writeFile(path.join(root, "blog.config.json"), "{ nope");
  await assert.rejects(loadConfig({ root }), /Could not parse/);
});
