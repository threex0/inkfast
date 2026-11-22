import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { test } from "node:test";
import {
  deployDist,
  diffDeployment,
  loadManifest,
  manifestPath,
  remoteJoin,
} from "../src/deploy.js";
import { configFor, silentLogger, tempRoot } from "./helpers.js";

async function makeDist(t) {
  const root = await tempRoot(t);
  await fs.mkdir(path.join(root, "dist", "posts"), { recursive: true });
  await fs.writeFile(path.join(root, "dist", "index.html"), "<h1>home</h1>");
  await fs.writeFile(path.join(root, "dist", "posts", "a.html"), "post a");
  return root;
}

function fakeClient(events) {
  return {
    ftp: {},
    async access(options) {
      events.push({ type: "access", options });
    },
    async cd(dir) {
      events.push({ type: "cd", dir });
    },
    async ensureDir(dir) {
      events.push({ type: "ensureDir", dir });
    },
    async uploadFrom(local, remote) {
      await fs.access(local);
      events.push({ type: "upload", local, remote });
    },
    async remove(remote) {
      events.push({ type: "remove", remote });
    },
    close() {
      events.push({ type: "close" });
    },
  };
}

function deployConfig(overrides = {}) {
  return configFor({
    deploy: {
      host: "ftp.example.test",
      user: "publisher",
      password: "hunter2",
      port: 21,
      secure: false,
      remoteDir: "/site",
      timeout: 30000,
      ...overrides,
    },
  });
}

test("diffDeployment uploads new and changed files, deletes only known stale files", () => {
  const files = new Map([
    ["a", "1"],
    ["b", "2"],
    ["c", "3"],
  ]);
  const manifest = { files: { a: "1", b: "old", d: "4" } };
  assert.deepEqual(diffDeployment(files, manifest), {
    uploads: ["b", "c"],
    deletes: ["d"],
  });
  assert.deepEqual(diffDeployment(files, manifest, { force: true }), {
    uploads: ["a", "b", "c"],
    deletes: ["d"],
  });
  assert.deepEqual(diffDeployment(files, null), {
    uploads: ["a", "b", "c"],
    deletes: [],
  });
});

test("remoteJoin builds safe absolute FTP paths", () => {
  assert.equal(remoteJoin("/", "index.html"), "/index.html");
  assert.equal(remoteJoin("/site", "posts/x/index.html"), "/site/posts/x/index.html");
  assert.equal(remoteJoin("/site/", "a.txt"), "/site/a.txt");
  assert.throws(() => remoteJoin("/site", "../secret"), /suspicious path/);
});

test("deployDist uploads, records a manifest, and skips unchanged builds", async (t) => {
  const root = await makeDist(t);
  const config = deployConfig();
  const logger = silentLogger();
  const events = [];

  const first = await deployDist({
    root,
    config,
    logger,
    options: { clientFactory: () => fakeClient(events) },
  });

  assert.equal(first.uploads, 2);
  assert.equal(first.deletes, 0);
  assert.ok(first.bytes > 0);
  assert.equal(events.filter((event) => event.type === "upload").length, 2);
  const access = events.find((event) => event.type === "access");
  assert.equal(access.options.host, "ftp.example.test");
  assert.equal(access.options.user, "publisher");
  assert.equal(access.options.password, "hunter2");
  assert.equal(events.at(-1).type, "close");

  const manifest = await loadManifest(root);
  assert.deepEqual(Object.keys(manifest.files).sort(), ["index.html", "posts/a.html"]);
  assert.equal(manifest.target, "ftp.example.test:21|false|/site");

  let factoryCalled = false;
  const second = await deployDist({
    root,
    config,
    logger,
    options: {
      clientFactory: () => {
        factoryCalled = true;
        return fakeClient([]);
      },
    },
  });
  assert.equal(second.uploads, 0);
  assert.equal(factoryCalled, false);
});

test("deployDist uploads changes, removes deleted files, and updates the manifest", async (t) => {
  const root = await makeDist(t);
  const config = deployConfig();
  const logger = silentLogger();

  await deployDist({
    root,
    config,
    logger,
    options: { clientFactory: () => fakeClient([]) },
  });

  await fs.writeFile(path.join(root, "dist", "index.html"), "<h1>changed</h1>");
  await fs.rm(path.join(root, "dist", "posts", "a.html"));
  await fs.writeFile(path.join(root, "dist", "about.html"), "about");

  const events = [];
  const result = await deployDist({
    root,
    config,
    logger,
    options: { clientFactory: () => fakeClient(events) },
  });

  assert.equal(result.uploads, 2);
  assert.equal(result.deletes, 1);
  assert.deepEqual(
    events.filter((event) => event.type === "upload").map((event) => event.remote).sort(),
    ["/site/about.html", "/site/index.html"],
  );
  assert.deepEqual(
    events.filter((event) => event.type === "remove").map((event) => event.remote),
    ["/site/posts/a.html"],
  );

  const manifest = await loadManifest(root);
  assert.deepEqual(Object.keys(manifest.files).sort(), ["about.html", "index.html"]);
});

test("only paths recorded in the manifest are eligible for deletion", async (t) => {
  const root = await makeDist(t);
  const config = deployConfig();
  const logger = silentLogger();

  await deployDist({
    root,
    config,
    logger,
    options: { clientFactory: () => fakeClient([]) },
  });

  await fs.rm(path.join(root, "dist", "posts", "a.html"));
  await fs.writeFile(path.join(root, "dist", "new.html"), "new");

  const events = [];
  const result = await deployDist({
    root,
    config,
    logger,
    options: { clientFactory: () => fakeClient(events) },
  });

  assert.equal(result.uploads, 1);
  assert.equal(result.deletes, 1);
  assert.deepEqual(
    events.filter((event) => event.type === "remove").map((event) => event.remote),
    ["/site/posts/a.html"],
  );
  // The deployer never lists or prunes the remote directory, so files it does
  // not know about cannot be touched.
  assert.ok(events.every((event) => !["list", "removeDir", "removeEmptyDir"].includes(event.type)));
});

test("dry runs work without credentials and never connect", async (t) => {
  const root = await makeDist(t);
  let factoryCalled = false;

  const result = await deployDist({
    root,
    config: configFor({ deploy: { host: "", user: "", password: "" } }),
    logger: silentLogger(),
    options: {
      dryRun: true,
      clientFactory: () => {
        factoryCalled = true;
        return fakeClient([]);
      },
    },
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.uploads, 2);
  assert.equal(factoryCalled, false);
});

test("dry runs never connect and leave the manifest untouched", async (t) => {
  const root = await makeDist(t);
  const config = deployConfig();
  let factoryCalled = false;

  const result = await deployDist({
    root,
    config,
    logger: silentLogger(),
    options: {
      dryRun: true,
      clientFactory: () => {
        factoryCalled = true;
        return fakeClient([]);
      },
    },
  });

  assert.equal(result.dryRun, true);
  assert.equal(result.uploads, 2);
  assert.equal(factoryCalled, false);
  await assert.rejects(fs.access(manifestPath(root)));
});

test("a changed deploy target uploads everything again", async (t) => {
  const root = await makeDist(t);
  const logger = silentLogger();

  await deployDist({
    root,
    config: deployConfig(),
    logger,
    options: { clientFactory: () => fakeClient([]) },
  });

  const events = [];
  const result = await deployDist({
    root,
    config: deployConfig({ remoteDir: "/other" }),
    logger,
    options: { clientFactory: () => fakeClient(events) },
  });

  assert.equal(result.uploads, 2);
  assert.equal(result.deletes, 0);
  assert.ok(
    events
      .filter((event) => event.type === "upload")
      .every((event) => event.remote.startsWith("/other/")),
  );
});

test("missing credentials produce an actionable error", async (t) => {
  const root = await makeDist(t);
  await assert.rejects(
    deployDist({
      root,
      config: configFor({ deploy: { host: "", user: "", password: "" } }),
      logger: silentLogger(),
      options: { clientFactory: () => fakeClient([]) },
    }),
    /Missing FTP settings/,
  );
});
