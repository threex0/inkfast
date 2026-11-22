import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

/** Normalize line endings so parsing behaves the same on Windows and Linux. */
export function normalizeEol(text) {
  return String(text).replace(/\r\n?/g, "\n");
}

/** URL/file-safe slug. "Hello, World!" -> "hello-world". */
export function slugify(value) {
  return String(value)
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/['\u2019]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** Directory name for a tag. Keeps tags like "C++" and "C#" distinct. */
export function tagDirName(tag) {
  const words = String(tag)
    .replace(/\+\+/g, " plusplus ")
    .replace(/\+/g, " plus ")
    .replace(/#/g, " sharp ")
    .replace(/&/g, " and ")
    .replace(/@/g, " at ");
  const slug = slugify(words);
  if (slug) return slug;
  return `tag-${createHash("sha1").update(String(tag)).digest("hex").slice(0, 6)}`;
}

/** Ensure a leading and trailing slash: "blog" -> "/blog/". */
export function normalizeBasePath(value = "/") {
  let p = String(value || "/").trim();
  if (/^[a-z][a-z0-9+.-]*:\/\//i.test(p)) {
    p = new URL(p).pathname;
  }
  p = p.replace(/\\/g, "/");
  if (!p.startsWith("/")) p = `/${p}`;
  p = p.replace(/\/{2,}/g, "/");
  if (!p.endsWith("/")) p += "/";
  return p;
}

/** Join a site base path with a site-relative path. Leaves absolute URLs alone. */
export function urlJoin(basePath, relative = "") {
  const rel = String(relative);
  if (!rel) return normalizeBasePath(basePath);
  if (/^[a-z][a-z0-9+.-]*:/i.test(rel) || rel.startsWith("//") || rel.startsWith("#")) {
    return rel;
  }
  const base = normalizeBasePath(basePath);
  return base + rel.replace(/^\/+/, "");
}

/** Turn a site path into an absolute URL when a site URL is configured. */
export function absoluteUrl(siteUrl, hrefPath) {
  if (!siteUrl) return hrefPath;
  try {
    const base = siteUrl.endsWith("/") ? siteUrl : `${siteUrl}/`;
    return new URL(hrefPath, base).toString();
  } catch {
    return hrefPath;
  }
}

const HTML_ESCAPES = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

export function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (char) => HTML_ESCAPES[char]);
}

/** Decode the HTML entities that marked/browser input can produce. */
export function decodeEntities(text) {
  return String(text)
    .replace(/&#x([0-9a-f]+);/gi, (_, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_, dec) => String.fromCodePoint(Number(dec)))
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&apos;/gi, "'");
}

/** Convert rendered HTML into readable plain text for search and excerpts. */
export function htmlToText(html) {
  return decodeEntities(
    String(html)
      .replace(/<(script|style)\b[^>]*>[\s\S]*?<\/\1>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/<[^>]+>/g, " "),
  )
    .replace(/\s+/g, " ")
    .trim();
}

/** Trim to a whole-word excerpt. */
export function excerptFromText(text, max = 160) {
  const clean = String(text || "").replace(/\s+/g, " ").trim();
  if (clean.length <= max) return clean;
  const cut = clean.slice(0, max - 1);
  const at = cut.lastIndexOf(" ");
  return `${(at > max * 0.5 ? cut.slice(0, at) : cut).replace(/[\s,;:.-]+$/, "")}\u2026`;
}

export function formatDate(date, { locale = "en-US", style = "medium" } = {}) {
  return new Intl.DateTimeFormat(locale, {
    dateStyle: style,
    timeZone: "UTC",
  }).format(date);
}

export function formatDateIso(date) {
  return date.toISOString().slice(0, 10);
}

export function readingMinutes(text) {
  const words = String(text).trim().split(/\s+/).filter(Boolean).length;
  return Math.max(1, Math.ceil(words / 220));
}

/**
 * Parse a frontmatter date. Date-only values are treated as UTC midnight so
 * builds are deterministic regardless of the machine's timezone.
 */
export function parseDate(value, label = "date") {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  const raw = String(value ?? "").trim();
  if (!raw) throw new Error(`${label} is required`);
  if (!/^\d{4}-\d{2}-\d{2}(?:[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})?)?$/.test(raw)) {
    throw new Error(`${label} must look like YYYY-MM-DD or an ISO timestamp (got "${raw}")`);
  }
  let iso = raw;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    iso = `${raw}T00:00:00Z`;
  } else {
    const hasTime = /[T ]\d{2}:\d{2}/.test(raw);
    const hasZone = /(?:Z|[+-]\d{2}:?\d{2})$/i.test(raw);
    if (hasTime && !hasZone) iso = `${raw.replace(" ", "T")}Z`;
  }
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) throw new Error(`${label} is not a valid date (got "${raw}")`);
  return date;
}

export function parseBoolean(value, label = "value") {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["true", "yes", "on", "1"].includes(normalized)) return true;
  if (["false", "no", "off", "0", ""].includes(normalized)) return false;
  throw new Error(`${label} must be true or false (got "${value}")`);
}

export function sha256(buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 0) return "0 B";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value >= 10 ? value.toFixed(0) : value.toFixed(1)} ${units[unit]}`;
}

export function toPosix(value) {
  return String(value).split(path.sep).join("/").replace(/\\/g, "/");
}

/** Recursively list files, returning paths relative to dir using forward slashes. */
export async function walkFiles(dir) {
  const results = [];
  async function visit(current, prefix) {
    let entries;
    try {
      entries = await fs.readdir(current, { withFileTypes: true });
    } catch (error) {
      if (error.code === "ENOENT") return;
      throw error;
    }
    entries.sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      if (entry.name === ".DS_Store" || entry.name === "Thumbs.db") continue;
      const rel = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        await visit(path.join(current, entry.name), rel);
      } else if (entry.isFile()) {
        results.push(rel);
      }
    }
  }
  await visit(dir, "");
  return results;
}

export async function pathExists(target) {
  try {
    await fs.access(target);
    return true;
  } catch {
    return false;
  }
}

export async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

export async function writeFileEnsured(filePath, contents) {
  await ensureDir(path.dirname(filePath));
  await fs.writeFile(filePath, contents);
}

export async function copyDir(source, destination) {
  const files = await walkFiles(source);
  for (const rel of files) {
    const target = path.join(destination, ...rel.split("/"));
    await ensureDir(path.dirname(target));
    await fs.copyFile(path.join(source, ...rel.split("/")), target);
  }
  return files.length;
}

export async function removeDir(dir) {
  await fs.rm(dir, { recursive: true, force: true, maxRetries: 3 });
}

export function isExternalUrl(value) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith("//");
}
