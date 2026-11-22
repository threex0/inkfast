import assert from "node:assert/strict";
import { test } from "node:test";
import {
  absoluteUrl,
  escapeHtml,
  excerptFromText,
  formatDateIso,
  htmlToText,
  normalizeBasePath,
  parseDate,
  slugify,
  tagDirName,
  urlJoin,
} from "../src/utils.js";

test("slugify handles punctuation, accents, and apostrophes", () => {
  assert.equal(slugify("Hello, World!"), "hello-world");
  assert.equal(slugify("Café déjà vu"), "cafe-deja-vu");
  assert.equal(slugify("It's a test"), "its-a-test");
  assert.equal(slugify("  ---  "), "");
});

test("tag directories stay distinct for punctuation-heavy tags", () => {
  assert.equal(tagDirName("C++"), "c-plusplus");
  assert.equal(tagDirName("C#"), "c-sharp");
  assert.equal(tagDirName("node.js"), "node-js");
  assert.equal(tagDirName("Hello World"), "hello-world");
  assert.match(tagDirName("日本語"), /^tag-[0-9a-f]{6}$/);
});

test("base path helpers normalize and join URLs", () => {
  assert.equal(normalizeBasePath("/"), "/");
  assert.equal(normalizeBasePath("blog"), "/blog/");
  assert.equal(normalizeBasePath("/blog"), "/blog/");
  assert.equal(normalizeBasePath("/blog//"), "/blog/");
  assert.equal(urlJoin("/blog/", "/posts/x/"), "/blog/posts/x/");
  assert.equal(urlJoin("/", "feed.xml"), "/feed.xml");
  assert.equal(urlJoin("/blog/", "https://example.com/x"), "https://example.com/x");
  assert.equal(urlJoin("/blog/", "#section"), "#section");
  assert.equal(absoluteUrl("https://example.com/blog", "/blog/posts/x/"), "https://example.com/blog/posts/x/");
  assert.equal(absoluteUrl("", "/posts/x/"), "/posts/x/");
});

test("dates are parsed deterministically in UTC", () => {
  assert.equal(parseDate("2026-11-08").toISOString(), "2026-11-08T00:00:00.000Z");
  assert.equal(parseDate("2026-11-08T10:30").toISOString(), "2026-11-08T10:30:00.000Z");
  assert.equal(parseDate("2026-11-08T10:30:00+02:00").toISOString(), "2026-11-08T08:30:00.000Z");
  assert.equal(parseDate("2026-11-08 10:30").toISOString(), "2026-11-08T10:30:00.000Z");
  assert.equal(formatDateIso(parseDate("2026-11-08")), "2026-11-08");
  assert.throws(() => parseDate("November 8, 2026"), /must look like/);
  assert.throws(() => parseDate(""), /is required/);
});

test("HTML helpers strip markup and decode entities", () => {
  assert.equal(
    htmlToText("<p>Hello &amp; <strong>world</strong> &#8212; ok</p>"),
    "Hello & world \u2014 ok",
  );
  assert.equal(escapeHtml(`<a href="x">'&'</a>`), "&lt;a href=&quot;x&quot;&gt;&#39;&amp;&#39;&lt;/a&gt;");
  assert.equal(excerptFromText("one two three four five", 12), "one two\u2026");
});
