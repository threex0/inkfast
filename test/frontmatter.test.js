import assert from "node:assert/strict";
import { test } from "node:test";
import { parseValue, splitFrontmatter } from "../src/frontmatter.js";

test("parses scalars, inline arrays, and preserves hash characters in values", () => {
  const { data, body, hasFrontmatter } = splitFrontmatter(`---
title: Hello
date: 2026-11-08
tags: [one, "two words", 3]
draft: true
description: "A # not a comment"
url: https://example.com/a#b
---

Body text.`);

  assert.equal(hasFrontmatter, true);
  assert.equal(data.title, "Hello");
  assert.equal(data.date, "2026-11-08");
  assert.deepEqual(data.tags, ["one", "two words", 3]);
  assert.equal(data.draft, true);
  assert.equal(data.description, "A # not a comment");
  assert.equal(data.url, "https://example.com/a#b");
  assert.equal(body, "Body text.");
});

test("parses indented lists", () => {
  const { data } = splitFrontmatter(`---
title: List test
tags:
  - alpha
  - "beta gamma"
  - 42
---
`);
  assert.deepEqual(data.tags, ["alpha", "beta gamma", 42]);
});

test("parses literal and folded block scalars", () => {
  const literal = splitFrontmatter(`---
description: |
  Line one.
  Line two.
title: X
---
`).data;
  assert.equal(literal.description, "Line one.\nLine two.\n");
  assert.equal(literal.title, "X");

  const folded = splitFrontmatter(`---
description: >
  one
  two

  three
title: Y
---
`).data;
  assert.equal(folded.description, "one two\nthree\n");
});

test("keeps quoted strings and single-quote escapes", () => {
  assert.equal(parseValue(`"a \\"quoted\\" value"`), 'a "quoted" value');
  assert.equal(parseValue("'it''s fine'"), "it's fine");
  assert.equal(parseValue('"2026-11-08"'), "2026-11-08");
});

test("handles CRLF input and files without frontmatter", () => {
  const crlf = splitFrontmatter("---\r\ntitle: Windows\r\n---\r\n\r\nBody\r\n");
  assert.equal(crlf.data.title, "Windows");
  assert.equal(crlf.body, "Body\n");

  const plain = splitFrontmatter("# Just markdown\n");
  assert.deepEqual(plain.data, {});
  assert.equal(plain.hasFrontmatter, false);
  assert.equal(plain.body, "# Just markdown\n");
});

test("reports malformed frontmatter with a line number", () => {
  assert.throws(
    () => splitFrontmatter("---\ntitle: no end\n"),
    /Unterminated frontmatter/,
  );
  assert.throws(
    () => splitFrontmatter("---\n  nested: value\n---\n"),
    /line 1: unexpected indentation/,
  );
  assert.throws(
    () => splitFrontmatter("---\nnot a pair\n---\n"),
    /line 1: expected "key: value"/,
  );
});
