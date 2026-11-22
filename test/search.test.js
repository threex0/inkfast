import assert from "node:assert/strict";
import { test } from "node:test";
import { normalizeText, scorePost, searchPosts, tokenize } from "../src/assets/app.js";

const posts = [
  {
    title: "Static sites that stay fast",
    tags: ["web", "performance"],
    description: "Pre-rendering and small pages.",
    text: "A static site removes a category of excuses. Keep the critical path boring.",
    date: "2026-10-24",
  },
  {
    title: "Search without a server",
    tags: ["search", "javascript"],
    description: "A JSON index and a little JavaScript.",
    text: "The browser downloads an index and matches locally. Title matches rank higher.",
    date: "2026-09-12",
  },
  {
    title: "Notes on café data",
    tags: ["data"],
    description: "Accents and normalisation.",
    text: "Café names should match cafe queries.",
    date: "2026-01-01",
  },
];

test("tokenize normalises case, punctuation, and accents", () => {
  assert.deepEqual(tokenize("Hello, WORLD!"), ["hello", "world"]);
  assert.deepEqual(tokenize("café déjà-vu"), ["cafe", "deja", "vu"]);
  assert.deepEqual(tokenize("   "), []);
  assert.equal(normalizeText("CAFÉ"), "cafe");
});

test("titles outrank body matches", () => {
  const titleScore = scorePost(posts[1], ["search"]);
  const bodyScore = scorePost(posts[1], ["locally"]);
  assert.ok(titleScore > bodyScore);
  assert.ok(titleScore > 0);
  assert.equal(scorePost(posts[0], ["nonexistent"]), 0);
});

test("every token must match", () => {
  assert.ok(scorePost(posts[0], ["static", "boring"]) > 0);
  assert.equal(scorePost(posts[0], ["static", "zzz"]), 0);
  assert.equal(searchPosts(posts, "static zzz").length, 0);
});

test("search sorts by score, then date, and honours limits", () => {
  const results = searchPosts(posts, "javascript");
  assert.equal(results[0].title, "Search without a server");

  const staticResults = searchPosts(posts, "static");
  assert.equal(staticResults[0].title, "Static sites that stay fast");

  assert.equal(searchPosts(posts, "cafe")[0].title, "Notes on café data");
  assert.equal(searchPosts(posts, "a", { limit: 1 }).length, 1);
  assert.deepEqual(searchPosts(posts, ""), []);
});
