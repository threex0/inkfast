import { marked, Renderer } from "marked";
import { escapeHtml, htmlToText, slugify } from "./utils.js";

/**
 * Render trusted Markdown to HTML.
 * - Adds stable, unique heading IDs with hover anchors.
 * - Prefixes root-relative links/images with the configured base path.
 * - Lazy-loads images.
 */
export function renderMarkdown(markdown, { basePath = "/" } = {}) {
  const headingCounts = new Map();
  const renderer = new Renderer();

  renderer.heading = function heading({ tokens, depth }) {
    const inner = this.parser.parseInline(tokens);
    const plain = htmlToText(inner);
    const base = slugify(plain) || "section";
    const count = (headingCounts.get(base) ?? 0) + 1;
    headingCounts.set(base, count);
    const id = count === 1 ? base : `${base}-${count}`;
    return `<h${depth} id="${escapeHtml(id)}">${inner}<a class="heading-anchor" href="#${escapeHtml(id)}" aria-hidden="true" tabindex="-1">#</a></h${depth}>\n`;
  };

  let html = marked.parse(markdown, {
    gfm: true,
    async: false,
    renderer,
  });

  html = rewriteRootUrls(html, basePath);
  html = lazyLoadImages(html);
  return html;
}

/** Plain text for search indexes and excerpts. */
export function markdownToText(markdown) {
  const html = marked.parse(markdown, { gfm: true, async: false });
  return htmlToText(html);
}

export function rewriteRootUrls(html, basePath) {
  const base = String(basePath || "/");
  if (base === "/") return html;
  const prefix = base.replace(/\/+$/, "");
  return html.replace(/(\s(?:href|src)=")\/(?!\/)/g, `$1${prefix}/`);
}

export function lazyLoadImages(html) {
  return html.replace(/<img\b(?![^>]*\bloading=)/gi, '<img loading="lazy" decoding="async"');
}
