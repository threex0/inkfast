import fs from "node:fs/promises";
import path from "node:path";
import posix from "node:path/posix";
import { normalizeBasePath, parseBoolean } from "./utils.js";

export const DEFAULT_CONFIG = {
  site: {
    title: "My Blog",
    description: "",
    url: "",
    author: "",
    lang: "en",
    basePath: "/",
    homePage: "",
    nav: [
      { label: "Archive", href: "/archive/" },
      { label: "Tags", href: "/tags/" },
    ],
  },
  build: {
    contentDir: "content",
    outDir: "dist",
    postsPerPage: 20,
    feedLimit: 20,
    includeFuture: false,
    devPort: 3000,
    previewPort: 3001,
    searchTextLimit: 12000,
  },
  deploy: {
    host: "",
    port: 21,
    user: "",
    password: "",
    secure: false,
    remoteDir: "/",
    timeout: 30000,
    verbose: false,
  },
};

export async function loadConfig({ root = process.cwd(), configPath } = {}) {
  loadDotEnv(root);

  const filePath = path.resolve(root, configPath || "blog.config.json");
  const localPath = localConfigPath(filePath);

  // Precedence: defaults < the committed config < the gitignored local config < environment.
  const config = mergeConfig(
    mergeConfig(
      structuredClone(DEFAULT_CONFIG),
      await readJsonFile(filePath),
    ),
    await readJsonFile(localPath),
  );
  applyEnvOverrides(config);
  validateConfig(config);

  return { config, root, configPath: filePath };
}

export function applyEnvOverrides(config) {
  const env = process.env;
  const pick = (...names) => {
    for (const name of names) {
      if (env[name] != null && env[name] !== "") return env[name];
    }
    return undefined;
  };

  const siteUrl = pick("BLOG_SITE_URL");
  if (siteUrl) config.site.url = siteUrl;
  const basePath = pick("BLOG_BASE_PATH");
  if (basePath) config.site.basePath = basePath;

  const host = pick("BLOG_FTP_HOST", "FTP_HOST");
  if (host) config.deploy.host = host;
  const port = pick("BLOG_FTP_PORT", "FTP_PORT");
  if (port) config.deploy.port = Number(port);
  const user = pick("BLOG_FTP_USER", "FTP_USER");
  if (user) config.deploy.user = user;
  const password = pick("BLOG_FTP_PASSWORD", "FTP_PASSWORD");
  if (password) config.deploy.password = password;
  const secure = pick("BLOG_FTP_SECURE", "FTP_SECURE");
  if (secure) config.deploy.secure = parseSecure(secure);
  const remoteDir = pick("BLOG_FTP_REMOTE_DIR", "FTP_REMOTE_DIR");
  if (remoteDir) config.deploy.remoteDir = remoteDir;
  const timeout = pick("BLOG_FTP_TIMEOUT", "FTP_TIMEOUT");
  if (timeout) config.deploy.timeout = Number(timeout);
  const verbose = pick("BLOG_FTP_VERBOSE", "FTP_VERBOSE");
  if (verbose) config.deploy.verbose = parseBoolean(verbose, "BLOG_FTP_VERBOSE");

  return config;
}

export function validateConfig(config) {
  if (!config.site.title || typeof config.site.title !== "string") {
    throw new Error("site.title must be a non-empty string");
  }
  config.site.basePath = normalizeBasePath(config.site.basePath);
  config.site.lang = String(config.site.lang || "en");
  config.site.homePage = normalizeHomePage(config.site.homePage);

  const perPage = Number(config.build.postsPerPage);
  if (!Number.isInteger(perPage) || perPage < 1) {
    throw new Error("build.postsPerPage must be a positive integer");
  }
  config.build.postsPerPage = perPage;

  const feedLimit = Number(config.build.feedLimit);
  if (!Number.isInteger(feedLimit) || feedLimit < 1) {
    throw new Error("build.feedLimit must be a positive integer");
  }
  config.build.feedLimit = feedLimit;

  const searchTextLimit = Number(config.build.searchTextLimit);
  if (!Number.isInteger(searchTextLimit) || searchTextLimit < 100) {
    throw new Error("build.searchTextLimit must be an integer of at least 100");
  }
  config.build.searchTextLimit = searchTextLimit;

  if (config.site.url && !/^https?:\/\//i.test(config.site.url)) {
    throw new Error("site.url must start with http:// or https:// (or be empty)");
  }
  if (config.site.basePath.includes("..")) {
    throw new Error("site.basePath may not contain ..");
  }

  config.build.includeFuture = parseBoolean(config.build.includeFuture, "build.includeFuture");

  const devPort = Number(config.build.devPort);
  if (!Number.isInteger(devPort) || devPort < 1 || devPort > 65535) {
    throw new Error("build.devPort must be a port number");
  }
  config.build.devPort = devPort;

  const previewPort = Number(config.build.previewPort);
  if (!Number.isInteger(previewPort) || previewPort < 1 || previewPort > 65535) {
    throw new Error("build.previewPort must be a port number");
  }
  config.build.previewPort = previewPort;

  config.deploy.port = Number(config.deploy.port);
  if (!Number.isInteger(config.deploy.port) || config.deploy.port < 1 || config.deploy.port > 65535) {
    throw new Error("deploy.port must be a port number");
  }
  config.deploy.timeout = Number(config.deploy.timeout);
  if (!Number.isFinite(config.deploy.timeout) || config.deploy.timeout < 1000) {
    throw new Error("deploy.timeout must be at least 1000ms");
  }
  config.deploy.secure = parseSecure(config.deploy.secure);
  config.deploy.remoteDir = normalizeRemoteDir(config.deploy.remoteDir);
  return config;
}

/**
 * A page slug used as the home page. Accepts "about", "/about/", or "/about".
 * Empty or missing means the blog listing is the home page.
 */
export function normalizeHomePage(value) {
  return String(value ?? "")
    .trim()
    .replace(/^\/+|\/+$/g, "")
    .toLowerCase();
}

export function parseSecure(value) {
  if (value === true || value === false) return value;
  const normalized = String(value ?? "").trim().toLowerCase();
  if (["implicit"].includes(normalized)) return "implicit";
  if (["true", "yes", "on", "1", "explicit", "tls", "ftps"].includes(normalized)) return true;
  if (["false", "no", "off", "0", "none", ""].includes(normalized)) return false;
  throw new Error(`deploy.secure must be false, true, or "implicit" (got "${value}")`);
}

export function normalizeRemoteDir(value) {
  const raw = String(value || "/").replace(/\\/g, "/").trim();
  if (raw.split("/").includes("..")) {
    throw new Error("deploy.remoteDir may not contain ..");
  }
  let dir = raw.startsWith("/") ? raw : `/${raw}`;
  dir = posix.normalize(dir).replace(/\/+$/, "");
  return dir || "/";
}

function mergeConfig(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override || {})) {
    if (
      value &&
      typeof value === "object" &&
      !Array.isArray(value) &&
      base[key] &&
      typeof base[key] === "object" &&
      !Array.isArray(base[key])
    ) {
      result[key] = mergeConfig(base[key], value);
    } else {
      result[key] = value;
    }
  }
  return result;
}

async function readJsonFile(filePath) {
  try {
    const raw = await fs.readFile(filePath, "utf8");
    return JSON.parse(raw);
  } catch (error) {
    if (error.code === "ENOENT") return {};
    if (error instanceof SyntaxError) {
      throw new Error(`Could not parse ${filePath}: ${error.message}`);
    }
    throw error;
  }
}

/** blog.config.json -> blog.config.local.json (custom.json -> custom.local.json). */
export function localConfigPath(filePath) {
  const { dir, name, ext } = path.parse(filePath);
  return path.join(dir, `${name}.local${ext || ".json"}`);
}

function loadDotEnv(root) {
  const envPath = path.join(root, ".env");
  try {
    process.loadEnvFile(envPath);
  } catch (error) {
    if (error.code !== "ENOENT") {
      // A malformed .env should be loud rather than silently ignored.
      throw new Error(`Could not read ${envPath}: ${error.message}`);
    }
  }
}
