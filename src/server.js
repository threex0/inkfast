import { watch as watchFs } from "node:fs";
import fs from "node:fs/promises";
import http from "node:http";
import path from "node:path";
import { localConfigPath } from "./config.js";
import { normalizeBasePath, pathExists } from "./utils.js";

const MIME_TYPES = {
  ".html": "text/html; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".xml": "application/xml; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".gif": "image/gif",
  ".webp": "image/webp",
  ".avif": "image/avif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".pdf": "application/pdf",
  ".mp4": "video/mp4",
  ".webm": "video/webm",
};

export async function startDevServer({
  root,
  config,
  rebuild,
  logger = console,
  port = config.build.devPort,
  configPath,
}) {
  const distDir = path.resolve(root, config.build.outDir || "dist");
  const basePath = normalizeBasePath(config.site.basePath);
  const clients = new Set();
  const watchers = [];
  let timer = null;
  let building = false;
  let queued = false;
  let closing = false;

  const server = createHttpServer({
    distDir,
    basePath,
    clients,
    injectReload: true,
    logger,
  });

  const heartbeat = setInterval(() => {
    for (const client of clients) client.write(": ping\n\n");
  }, 25000);
  heartbeat.unref?.();

  async function runRebuild() {
    if (closing) return;
    if (building) {
      queued = true;
      return;
    }
    building = true;
    try {
      const result = await rebuild();
      logger.log?.(`Rebuilt ${result.files} files in ${result.durationMs}ms`);
      broadcast(clients, "reload", "1");
    } catch (error) {
      logger.error?.(`Build failed: ${error.message}`);
      broadcast(clients, "error", error.message.replace(/\s+/g, " "));
    } finally {
      building = false;
      if (queued) {
        queued = false;
        scheduleRebuild("queued change");
      }
    }
  }

  function scheduleRebuild(reason) {
    if (closing) return;
    clearTimeout(timer);
    timer = setTimeout(() => {
      logger.log?.(`Change detected (${reason}); rebuilding…`);
      runRebuild();
    }, 120);
  }

  async function watch(target, isDirectory) {
    try {
      const watcher = watchFs(
        target,
        isDirectory ? { recursive: true } : {},
        () => scheduleRebuild(path.basename(target)),
      );
      watcher.on("error", (error) => logger.warn?.(`Watcher error: ${error.message}`));
      watchers.push(watcher);
    } catch (error) {
      logger.warn?.(`Could not watch ${target}: ${error.message}`);
    }
  }

  const contentDir = path.resolve(root, config.build.contentDir || "content");
  const staticDir = path.resolve(root, "static");
  const assetsDir = path.resolve(root, "src", "assets");
  for (const target of [contentDir, staticDir, assetsDir]) {
    if (await pathExists(target)) await watch(target, true);
  }
  const configFile = path.resolve(root, configPath || "blog.config.json");
  const configNames = new Set(
    [configFile, localConfigPath(configFile)].map((file) =>
      path.relative(root, file).split(path.sep).join("/"),
    ),
  );
  const hasConfigFile = await Promise.all(
    [...configNames].map((name) => pathExists(path.join(root, ...name.split("/")))),
  );
  if (hasConfigFile.some(Boolean)) {
    try {
      const watcher = watchFs(root, (event, filename) => {
        const name = String(filename).split(path.sep).join("/");
        if (configNames.has(name)) scheduleRebuild(name);
      });
      watcher.on("error", (error) => logger.warn?.(`Watcher error: ${error.message}`));
      watchers.push(watcher);
    } catch (error) {
      logger.warn?.(`Could not watch config: ${error.message}`);
    }
  }

  const actualPort = await listenOn(server, port);
  const origin = `http://127.0.0.1:${actualPort}`;
  logger.log?.(`Preview: ${origin}${basePath}`);

  return {
    server,
    url: `${origin}${basePath}`,
    async close() {
      closing = true;
      clearTimeout(timer);
      clearInterval(heartbeat);
      for (const watcher of watchers) watcher.close();
      for (const client of clients) client.end();
      clients.clear();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

/**
 * Serve the existing build output as-is — no rebuilds, watcher, or reload script.
 * Useful when you want to check dist/ the way a normal web server will see it.
 */
export async function startPreviewServer({
  root,
  config,
  port = config.build.previewPort ?? 3001,
  logger = console,
}) {
  const distDir = path.resolve(root, config.build.outDir || "dist");
  if (!(await pathExists(path.join(distDir, "index.html")))) {
    throw new Error(`No built site found in ${distDir}. Run "npm run build" first.`);
  }

  const basePath = normalizeBasePath(config.site.basePath);
  const server = createHttpServer({
    distDir,
    basePath,
    clients: new Set(),
    injectReload: false,
    logger,
  });
  const actualPort = await listenOn(server, port);
  const origin = `http://127.0.0.1:${actualPort}`;
  logger.log?.(`Serving ${distDir} at ${origin}${basePath}`);

  return {
    server,
    url: `${origin}${basePath}`,
    async close() {
      server.closeAllConnections?.();
      await new Promise((resolve) => server.close(resolve));
    },
  };
}

function createHttpServer({ distDir, basePath, clients, injectReload, logger }) {
  return http.createServer((request, response) => {
    handleRequest({ request, response, distDir, basePath, clients, injectReload }).catch(
      (error) => {
        logger.error?.(error.stack || error.message);
        if (!response.headersSent) {
          response.writeHead(500, { "Content-Type": "text/plain; charset=utf-8" });
        }
        response.end("Internal server error");
      },
    );
  });
}

async function listenOn(server, port) {
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  return server.address().port;
}

async function handleRequest({
  request,
  response,
  distDir,
  basePath,
  clients,
  injectReload = true,
}) {
  if (request.method !== "GET" && request.method !== "HEAD") {
    response.writeHead(405, { Allow: "GET, HEAD" });
    response.end("Method not allowed");
    return;
  }

  const url = new URL(request.url || "/", "http://localhost");
  let pathname;
  try {
    pathname = decodeURIComponent(url.pathname);
  } catch {
    response.writeHead(400, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Bad request");
    return;
  }

  if (injectReload && pathname === `${basePath}__reload`) {
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    });
    response.write("retry: 1000\n\n");
    clients.add(response);
    request.on("close", () => clients.delete(response));
    return;
  }

  if (basePath !== "/") {
    const bare = basePath.slice(0, -1);
    if (pathname === bare) {
      response.writeHead(301, { Location: basePath });
      response.end();
      return;
    }
    if (!pathname.startsWith(basePath)) {
      response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
      response.end("Not found");
      return;
    }
    pathname = `/${pathname.slice(basePath.length)}`;
  }

  let filePath = path.resolve(distDir, `.${pathname}`);
  if (!isInside(distDir, filePath)) {
    response.writeHead(403, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Forbidden");
    return;
  }

  let stat = await statOrNull(filePath);
  if (stat?.isDirectory()) {
    if (!pathname.endsWith("/")) {
      response.writeHead(301, { Location: `${basePath === "/" ? "" : basePath.slice(0, -1)}${pathname}/` });
      response.end();
      return;
    }
    filePath = path.join(filePath, "index.html");
    stat = await statOrNull(filePath);
  } else if (!stat && !path.extname(pathname)) {
    const alternate = path.join(filePath, "index.html");
    const alternateStat = await statOrNull(alternate);
    if (alternateStat?.isFile()) {
      filePath = alternate;
      stat = alternateStat;
    }
  }

  if (!stat?.isFile()) {
    const notFound = path.join(distDir, "404.html");
    if (await pathExists(notFound)) {
      const html = await fs.readFile(notFound);
      send(response, request, html, "text/html; charset=utf-8", 404);
      return;
    }
    response.writeHead(404, { "Content-Type": "text/plain; charset=utf-8" });
    response.end("Not found");
    return;
  }

  const extension = path.extname(filePath).toLowerCase();
  const type = MIME_TYPES[extension] || "application/octet-stream";
  let body = await fs.readFile(filePath);

  if (injectReload && type.startsWith("text/html")) {
    body = Buffer.from(
      body.toString("utf8").replace("</body>", `${devReloadScript(basePath)}</body>`),
    );
  }

  send(response, request, body, type, 200);
}

function send(response, request, body, type, status) {
  response.writeHead(status, {
    "Content-Type": type,
    "Content-Length": body.length,
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
  });
  if (request.method === "HEAD") response.end();
  else response.end(body);
}

function devReloadScript(basePath) {
  const endpoint = `${basePath}__reload`;
  return `<script>(()=>{
    const source = new EventSource(${JSON.stringify(endpoint)});
    let opened = false;
    source.addEventListener("open", () => {
      if (opened) location.reload();
      opened = true;
    });
    source.addEventListener("reload", () => location.reload());
    source.addEventListener("error", (event) => {
      if (!event.data) return;
      let banner = document.getElementById("__build-error");
      if (!banner) {
        banner = document.createElement("div");
        banner.id = "__build-error";
        banner.style.cssText = "position:fixed;left:0;right:0;bottom:0;z-index:9999;background:#b42318;color:#fff;font:13px/1.45 system-ui,sans-serif;padding:10px 14px;white-space:pre-wrap";
        document.body.append(banner);
      }
      banner.textContent = "Build failed: " + event.data;
    });
  })();</script>`;
}

function broadcast(clients, event, data) {
  for (const client of clients) {
    client.write(`event: ${event}\ndata: ${data}\n\n`);
  }
}

async function statOrNull(target) {
  try {
    return await fs.stat(target);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "ENOTDIR") return null;
    throw error;
  }
}

function isInside(parent, child) {
  const relative = path.relative(parent, child);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
