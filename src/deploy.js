import fs from "node:fs/promises";
import path from "node:path";
import posix from "node:path/posix";
import { Client } from "basic-ftp";
import { assertSafeOutDir } from "./build.js";
import {
  ensureDir,
  formatBytes,
  pathExists,
  sha256,
  walkFiles,
  writeFileEnsured,
} from "./utils.js";

const MANIFEST_VERSION = 1;

export async function deployDist({ root, config, options = {}, logger = console }) {
  const { host, port, user, password, secure, remoteDir, timeout } = config.deploy;
  const missing = [];
  if (!host) missing.push("host (BLOG_FTP_HOST)");
  if (!user) missing.push("user (BLOG_FTP_USER)");
  if (!password) missing.push("password (BLOG_FTP_PASSWORD)");
  if (missing.length && !options.dryRun) {
    throw new Error(
      `Missing FTP settings: ${missing.join(", ")}. Put them in .env or blog.config.json. See .env.example.`,
    );
  }

  const distDir = path.resolve(root, config.build.outDir || "dist");
  assertSafeOutDir(root, distDir, config);
  if (!(await pathExists(distDir))) {
    throw new Error(`Build output not found at ${distDir}. Run "npm run build" first.`);
  }

  const files = await collectFiles(distDir);
  const target = targetKey(config);
  let manifest = await loadManifest(root);
  if (manifest && manifest.target !== target) {
    logger.warn?.(
      `Deploy target changed since the last publish; uploading every file and keeping no stale-file history.`,
    );
    manifest = null;
  }
  if (!manifest) {
    manifest = {
      version: MANIFEST_VERSION,
      target,
      host,
      port,
      secure,
      remoteDir,
      files: {},
    };
  }

  const { uploads, deletes } = diffDeployment(files, manifest, { force: options.force });
  const uploadBytes = uploads.reduce((sum, rel) => sum + (files.get(rel)?.size || 0), 0);

  logger.log?.(
    host
      ? `Target: ${schemeFor(secure)}://${user}@${host}:${port}${remoteDir === "/" ? "/" : `${remoteDir}/`}`
      : "Target: FTP settings are not configured (dry run only)",
  );
  logger.log?.(
    `${uploads.length} file${uploads.length === 1 ? "" : "s"} to upload (${formatBytes(uploadBytes)}), ${deletes.length} to delete.`,
  );

  if (options.dryRun) {
    for (const rel of uploads) logger.log?.(`  + ${rel}`);
    for (const rel of deletes) logger.log?.(`  - ${rel}`);
    logger.log?.("Dry run: nothing was changed.");
    return {
      dryRun: true,
      uploads: uploads.length,
      deletes: deletes.length,
      bytes: uploadBytes,
    };
  }

  if (!uploads.length && !deletes.length) {
    logger.log?.("Already up to date.");
    return { uploads: 0, deletes: 0, bytes: 0 };
  }

  const client = options.clientFactory ? options.clientFactory(timeout) : new Client(timeout);
  client.ftp.verbose = Boolean(options.verbose ?? config.deploy.verbose);
  let uploaded = 0;
  let deleted = 0;
  let bytesUploaded = 0;
  let lastEnsuredDir = null;

  try {
    try {
      await client.access({ host, port, user, password, secure });
    } catch (error) {
      throw new Error(
        `Could not log in to ${host}:${port}: ${error.message}${loginHint(error, config.deploy)}`,
      );
    }

    if (remoteDir === "/") {
      await client.cd("/");
    } else {
      await client.ensureDir(remoteDir);
    }

    for (const rel of uploads) {
      const remotePath = remoteJoin(remoteDir, rel);
      const parent = posix.dirname(remotePath);
      if (parent !== lastEnsuredDir) {
        await client.ensureDir(parent);
        lastEnsuredDir = parent;
      }
      const localPath = path.join(distDir, ...rel.split("/"));
      const info = files.get(rel);
      logger.log?.(`  ↑ ${rel} (${formatBytes(info?.size || 0)})`);
      await client.uploadFrom(localPath, remotePath);
      manifest.files[rel] = info.hash;
      uploaded += 1;
      bytesUploaded += info?.size || 0;
    }

    for (const rel of deletes) {
      const remotePath = remoteJoin(remoteDir, rel);
      logger.log?.(`  - ${rel}`);
      try {
        await client.remove(remotePath);
      } catch (error) {
        if (error.code !== 550) throw error;
        logger.warn?.(`  ! ${rel} was already gone on the server`);
      }
      delete manifest.files[rel];
      deleted += 1;
    }
  } finally {
    await saveManifest(root, manifest).catch((error) => {
      logger.warn?.(`Could not save deploy manifest: ${error.message}`);
    });
    client.close();
  }

  logger.log?.(
    `Done: uploaded ${uploaded} file${uploaded === 1 ? "" : "s"} (${formatBytes(bytesUploaded)}), deleted ${deleted}.`,
  );
  return { uploads: uploaded, deletes: deleted, bytes: bytesUploaded };
}

export async function collectFiles(distDir) {
  const files = new Map();
  for (const rel of await walkFiles(distDir)) {
    const buffer = await fs.readFile(path.join(distDir, ...rel.split("/")));
    files.set(rel, { hash: sha256(buffer), size: buffer.length });
  }
  return files;
}

/**
 * Compare the current build against the previous manifest.
 * Only files recorded in the manifest are ever deleted; files uploaded by
 * something else are left alone.
 */
export function diffDeployment(files, manifest, { force = false } = {}) {
  const previous = manifest?.files ?? {};
  const uploads = [];
  const deletes = [];

  for (const [rel, info] of files) {
    const hash = typeof info === "string" ? info : info?.hash;
    if (force || previous[rel] !== hash) uploads.push(rel);
  }
  for (const rel of Object.keys(previous)) {
    if (!files.has(rel)) deletes.push(rel);
  }

  uploads.sort();
  deletes.sort();
  return { uploads, deletes };
}

export function remoteJoin(remoteDir, relativePath) {
  const rel = String(relativePath).replace(/\\/g, "/").replace(/^\/+/, "");
  if (rel.split("/").includes("..")) {
    throw new Error(`Refusing to deploy suspicious path: ${relativePath}`);
  }
  const base = remoteDir === "/" ? "" : String(remoteDir).replace(/\/+$/, "");
  return `${base}/${rel}`;
}

export function targetKey(config) {
  return `${config.deploy.host}:${config.deploy.port}|${config.deploy.secure}|${config.deploy.remoteDir}`;
}

export async function loadManifest(root) {
  const file = manifestPath(root);
  try {
    const manifest = JSON.parse(await fs.readFile(file, "utf8"));
    if (!manifest || typeof manifest !== "object" || typeof manifest.files !== "object") {
      return null;
    }
    return manifest;
  } catch (error) {
    if (error.code === "ENOENT" || error instanceof SyntaxError) return null;
    throw error;
  }
}

export async function saveManifest(root, manifest) {
  manifest.updatedAt = new Date().toISOString();
  const file = manifestPath(root);
  await ensureDir(path.dirname(file));
  await writeFileEnsured(file, `${JSON.stringify(manifest, null, 2)}\n`);
}

export function manifestPath(root) {
  return path.join(root, ".blog-cache", "deploy-manifest.json");
}

function schemeFor(secure) {
  if (secure === "implicit") return "ftpsi";
  return secure ? "ftps" : "ftp";
}

function loginHint(error, deploy) {
  const code = error.code;
  if (code === 530) return " (the server rejected the username/password)";
  if (code === 421 || code === 425) return " (the server may require passive mode or FTPS)";
  if (error.code === "ENOTFOUND") return " (host name could not be resolved)";
  if (error.code === "ECONNREFUSED") return ` (nothing is listening on port ${deploy.port})`;
  if (error.code === "ETIMEDOUT") return " (connection timed out; check the port and firewall)";
  if (deploy.secure === false) return ' (if the server requires TLS, set deploy.secure to true)';
  return "";
}
