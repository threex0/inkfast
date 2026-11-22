import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { DEFAULT_CONFIG } from "../src/config.js";

export function configFor(overrides = {}) {
  const config = structuredClone(DEFAULT_CONFIG);
  Object.assign(config.site, overrides.site || {});
  Object.assign(config.build, overrides.build || {});
  Object.assign(config.deploy, overrides.deploy || {});
  return config;
}

export async function tempRoot(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "inkfast-test-"));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  return root;
}

export async function writeProject(t, { posts = {}, pages = {}, staticFiles = {} } = {}) {
  const root = await tempRoot(t);
  await fs.mkdir(path.join(root, "src", "assets"), { recursive: true });
  await fs.writeFile(path.join(root, "src", "assets", "style.css"), "body{color:black}\n");
  await fs.writeFile(path.join(root, "src", "assets", "app.js"), "export {};\n");

  for (const [relative, contents] of Object.entries(posts)) {
    const file = path.join(root, "content", "posts", ...relative.split("/"));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, contents);
  }
  for (const [relative, contents] of Object.entries(pages)) {
    const file = path.join(root, "content", "pages", ...relative.split("/"));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, contents);
  }
  for (const [relative, contents] of Object.entries(staticFiles)) {
    const file = path.join(root, "static", ...relative.split("/"));
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, contents);
  }
  return root;
}

export function post({
  title,
  date = "2020-01-01",
  description,
  tags,
  draft,
  slug,
  body = "Body text.",
  extra = "",
} = {}) {
  const lines = ["---", `title: ${JSON.stringify(title)}`, `date: ${date}`];
  if (description) lines.push(`description: ${JSON.stringify(description)}`);
  if (tags) lines.push(`tags: ${JSON.stringify(tags)}`);
  if (draft != null) lines.push(`draft: ${draft}`);
  if (slug) lines.push(`slug: ${slug}`);
  if (extra) lines.push(extra);
  lines.push("---", "", body, "");
  return lines.join("\n");
}

export function silentLogger() {
  return { log() {}, warn() {}, error() {} };
}
