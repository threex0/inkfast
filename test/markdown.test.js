import assert from "node:assert/strict";
import { test } from "node:test";
import { markdownToText, renderMarkdown } from "../src/markdown.js";

test("adds unique heading ids and hover anchors", () => {
  const html = renderMarkdown("# Hello World\n\n## Hello World\n\n### Hello World\n");
  assert.match(html, /<h1 id="hello-world">/);
  assert.match(html, /<h2 id="hello-world-2">/);
  assert.match(html, /<h3 id="hello-world-3">/);
  assert.match(html, /class="heading-anchor" href="#hello-world"/);
});

test("prefixes root-relative links and images with the base path", () => {
  const html = renderMarkdown(
    "[About](/about/)\n\n![Diagram](/images/flow.svg)\n\n[External](https://example.com/)",
    { basePath: "/blog/" },
  );
  assert.match(html, /href="\/blog\/about\/"/);
  assert.match(html, /src="\/blog\/images\/flow.svg"/);
  assert.match(html, /href="https:\/\/example.com\/"/);
  assert.doesNotMatch(html, /href="\/blog\/https:/);
});

test("leaves root paths alone when the site is at the root", () => {
  const html = renderMarkdown("[About](/about/)", { basePath: "/" });
  assert.match(html, /href="\/about\/"/);
});

test("renders GFM tables, code fences, and lazy images", () => {
  const html = renderMarkdown(
    [
      "| A | B |",
      "| - | - |",
      "| 1 | 2 |",
      "",
      "```js",
      "const x = 1;",
      "```",
      "",
      "![alt](/images/x.png)",
    ].join("\n"),
  );
  assert.match(html, /<table>/);
  assert.match(html, /<code class="language-js">/);
  assert.match(html, /<img loading="lazy" decoding="async" src="\/images\/x.png"/);
});

test("markdownToText returns readable text without markup or anchors", () => {
  const text = markdownToText("# Heading\n\nSome **bold** text with [a link](/x/).\n\n```js\nconst x = 1;\n```");
  assert.equal(text, "Heading Some bold text with a link . const x = 1;");
  assert.doesNotMatch(text, /#|<\/|\*\*/);
});
