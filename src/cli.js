#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { assertSafeOutDir, buildSite } from "./build.js";
import { loadConfig } from "./config.js";
import { deployDist } from "./deploy.js";
import { startDevServer, startPreviewServer } from "./server.js";
import { formatDateIso, parseDate, slugify } from "./utils.js";

const VERSION = "0.1.0";
const BOOLEAN_FLAGS = new Set([
  "drafts",
  "future",
  "dry-run",
  "force",
  "verbose",
  "no-build",
  "help",
  "version",
]);
const VALUE_FLAGS = new Set(["config", "out", "port", "tags", "date"]);

async function main() {
  const { command, args, rest } = parseArgs(process.argv.slice(2));

  if (args.help || command === "help") {
    printUsage();
    return;
  }
  if (args.version) {
    console.log(VERSION);
    return;
  }
  if (!command) {
    printUsage();
    process.exitCode = 1;
    return;
  }

  const { config, root } = await loadConfig({ root: process.cwd(), configPath: args.config });
  if (args.out) config.build.outDir = String(args.out);
  if (args.port) {
    const portNumber = Number(args.port);
    if (!Number.isInteger(portNumber) || portNumber < 1 || portNumber > 65535) {
      throw new Error("--port must be a port number");
    }
    config.build.devPort = portNumber;
    config.build.previewPort = portNumber;
  }

  const buildOptions = {
    drafts: Boolean(args.drafts),
    future: Boolean(args.future),
  };
  const publishBuildOptions = {
    drafts: Boolean(args.drafts),
    future: Boolean(args.future),
  };

  switch (command) {
    case "build": {
      const result = await buildSite({ root, config, options: buildOptions });
      printBuildResult(result);
      break;
    }
    case "dev": {
      const initial = await buildSite({ root, config, options: buildOptions });
      printBuildResult(initial);
      let liveConfig = config;
      const dev = await startDevServer({
        root,
        config,
        configPath: args.config,
        rebuild: async () => {
          let fresh;
          try {
            fresh = await loadConfig({ root, configPath: args.config });
          } catch (error) {
            throw new Error(`Configuration error: ${error.message}`);
          }
          if (
            fresh.config.build.outDir !== config.build.outDir ||
            fresh.config.site.basePath !== config.site.basePath
          ) {
            console.warn("warning: outDir/basePath changes need a dev-server restart.");
          }
          fresh.config.build.outDir = config.build.outDir;
          fresh.config.site.basePath = config.site.basePath;
          liveConfig = fresh.config;
          const result = await buildSite({ root, config: liveConfig, options: buildOptions });
          for (const warning of result.warnings) console.warn(`warning: ${warning}`);
          return result;
        },
      });
      console.log("Watching content/, static/, src/assets/, and blog.config.json. Press Ctrl+C to stop.");
      const shutdown = async () => {
        await dev.close();
        process.exit(0);
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
      break;
    }
    case "preview": {
      const preview = await startPreviewServer({ root, config });
      console.log("Press Ctrl+C to stop.");
      const shutdown = async () => {
        await preview.close();
        process.exit(0);
      };
      process.once("SIGINT", shutdown);
      process.once("SIGTERM", shutdown);
      break;
    }
    case "publish": {
      if (!args["no-build"]) {
        if (args.drafts) {
          console.warn("warning: --drafts is set, so draft posts will be published.");
        }
        const result = await buildSite({ root, config, options: publishBuildOptions });
        printBuildResult(result);
      }
      await deployDist({
        root,
        config,
        options: {
          dryRun: Boolean(args["dry-run"]),
          force: Boolean(args.force),
          verbose: Boolean(args.verbose),
        },
      });
      break;
    }
    case "new": {
      await createPost({ root, config, args, rest });
      break;
    }
    case "clean": {
      const outDir = path.resolve(root, config.build.outDir || "dist");
      assertSafeOutDir(root, outDir, config);
      await fs.rm(outDir, { recursive: true, force: true });
      console.log(`Removed ${outDir}`);
      break;
    }
    default:
      throw new Error(`Unknown command "${command}". Run "blog --help".`);
  }
}

function parseArgs(argv) {
  const args = {};
  const rest = [];
  let command = null;
  for (let index = 0; index < argv.length; index += 1) {
    const value = argv[index];
    if (value === "--") {
      rest.push(...argv.slice(index + 1));
      break;
    }
    if (value === "-h") {
      args.help = true;
      continue;
    }
    if (value.startsWith("--")) {
      const [rawName, inlineValue] = value.slice(2).split("=");
      const name = rawName;
      if (BOOLEAN_FLAGS.has(name)) {
        args[name] = true;
      } else if (VALUE_FLAGS.has(name)) {
        if (inlineValue != null) {
          args[name] = inlineValue;
        } else {
          const next = argv[index + 1];
          if (next == null || next.startsWith("--")) {
            throw new Error(`--${name} needs a value`);
          }
          args[name] = next;
          index += 1;
        }
      } else {
        throw new Error(`Unknown option "--${name}"`);
      }
      continue;
    }
    if (!command) command = value;
    else rest.push(value);
  }
  return { command, args, rest };
}

async function createPost({ root, config, args, rest }) {
  const title = rest.join(" ").trim();
  if (!title) {
    throw new Error('Usage: blog new "Post title" [--tags a,b] [--date YYYY-MM-DD]');
  }

  const now = new Date();
  const localToday = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
  let date = localToday;
  if (args.date) {
    date = formatDateIso(parseDate(args.date, "--date"));
  }

  const slug = slugify(title);
  if (!slug) throw new Error("Could not make a slug from that title; use Latin letters or add a slug later.");

  const tags = args.tags
    ? String(args.tags)
        .split(",")
        .map((tag) => tag.trim())
        .filter(Boolean)
    : [];

  const postsDir = path.resolve(root, config.build.contentDir || "content", "posts");
  await fs.mkdir(postsDir, { recursive: true });
  const file = path.join(postsDir, `${date}-${slug}.md`);

  const lines = [
    "---",
    `title: ${JSON.stringify(title)}`,
    `date: ${date}`,
    ...(tags.length ? [`tags: ${JSON.stringify(tags)}`] : []),
    "draft: true",
    "---",
    "",
    "Write your post here.",
    "",
  ];

  try {
    await fs.writeFile(file, lines.join("\n"), { flag: "wx" });
  } catch (error) {
    if (error.code === "EEXIST") {
      throw new Error(`Post already exists: ${path.relative(root, file)}`);
    }
    throw error;
  }

  console.log(`Created ${path.relative(root, file)} (draft: true)`);
  console.log("Remove the draft line (or build with --drafts) when you are ready to publish.");
}

function printBuildResult(result) {
  console.log(
    `Built ${plural(result.posts.length, "post")}, ${plural(result.pages.length, "page")}, ${plural(result.tags.length, "tag")} -> ${plural(result.files, "file")}, ${result.bytesDisplay} in ${result.durationMs}ms`,
  );
  console.log(`Output: ${result.outDir}`);
  for (const warning of result.warnings) console.warn(`warning: ${warning}`);
}

function plural(count, word) {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function pad(value) {
  return String(value).padStart(2, "0");
}

function printUsage() {
  console.log(`inkfast ${VERSION}

Usage:
  inkfast build   [--drafts] [--future] [--out <dir>] [--config <file>]
  inkfast dev     [--port <port>] [--drafts] [--future]
  inkfast preview [--port <port>]
  inkfast publish [--dry-run] [--force] [--no-build] [--verbose] [--drafts] [--future]
  inkfast new     "Post title" [--tags a,b] [--date YYYY-MM-DD]
  inkfast clean

npm aliases:
  npm run build | npm run dev | npm run preview | npm run publish | npm run new -- "Post title"

preview serves the existing dist/ folder over HTTP without rebuilding.
Do not open dist/index.html directly: its links are root-relative and need a web server.

FTP settings come from .env or blog.config.json:
  BLOG_FTP_HOST, BLOG_FTP_PORT, BLOG_FTP_USER, BLOG_FTP_PASSWORD,
  BLOG_FTP_SECURE (false | true | implicit), BLOG_FTP_REMOTE_DIR

Build and deploy are incremental: only files whose contents changed are uploaded.`);
}

main().catch((error) => {
  console.error(`error: ${error.message}`);
  if (process.env.BLOG_DEBUG) console.error(error.stack);
  process.exitCode = 1;
});
