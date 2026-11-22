/**
 * Site behavior: instant search overlay + theme toggle.
 * The search scoring helpers are exported so they can be unit tested in Node.
 */

export function normalizeText(value) {
  return String(value ?? "")
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "");
}

export function tokenize(query) {
  return normalizeText(query)
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean);
}

/** Higher is better. Every token must match somewhere, otherwise the post is excluded. */
export function scorePost(post, tokens) {
  if (!tokens.length) return 0;
  const title = normalizeText(post.title);
  const tags = normalizeText((post.tags || []).join(" "));
  const description = normalizeText(post.description);
  const text = normalizeText(post.text);

  let score = 0;
  for (const token of tokens) {
    let points = 0;
    if (title === token) points += 40;
    else if (title.startsWith(token)) points += 24;
    else if (title.includes(token)) points += 16;
    if (tags.includes(token)) points += 10;
    if (description.includes(token)) points += 5;
    if (text.includes(token)) points += 2;
    if (points === 0) return 0;
    score += points;
  }
  return score;
}

export function searchPosts(posts, query, { limit = 20 } = {}) {
  const tokens = tokenize(query);
  if (!tokens.length) return [];
  const matches = [];
  for (const post of posts) {
    const score = scorePost(post, tokens);
    if (score > 0) matches.push({ post, score });
  }
  matches.sort(
    (a, b) =>
      b.score - a.score ||
      String(b.post.date).localeCompare(String(a.post.date)) ||
      String(a.post.title).localeCompare(String(b.post.title)),
  );
  return matches.slice(0, limit).map((match) => match.post);
}

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function highlight(text, tokens) {
  const fragment = document.createDocumentFragment();
  const value = String(text ?? "");
  if (!tokens.length) {
    fragment.append(value);
    return fragment;
  }
  const pattern = [...new Set(tokens)]
    .sort((a, b) => b.length - a.length)
    .map(escapeRegExp)
    .join("|");
  if (!pattern) {
    fragment.append(value);
    return fragment;
  }
  const regex = new RegExp(`(${pattern})`, "giu");
  let lastIndex = 0;
  let match;
  while ((match = regex.exec(value)) !== null) {
    if (match.index > lastIndex) fragment.append(value.slice(lastIndex, match.index));
    const mark = document.createElement("mark");
    mark.textContent = match[0];
    fragment.append(mark);
    lastIndex = match.index + match[0].length;
    if (match[0] === "") regex.lastIndex += 1;
  }
  if (lastIndex < value.length) fragment.append(value.slice(lastIndex));
  return fragment;
}

function makeSnippet(post, tokens) {
  const text = String(post.text || "").replace(/\s+/g, " ").trim();
  if (!tokens.length) return post.description || text.slice(0, 150);
  const lower = text.toLowerCase();
  let position = -1;
  for (const token of tokens) {
    const found = lower.indexOf(token);
    if (found !== -1 && (position === -1 || found < position)) position = found;
  }
  if (position === -1) return post.description || "";
  const start = Math.max(0, position - 55);
  const end = Math.min(text.length, position + 115);
  return `${start > 0 ? "…" : ""}${text.slice(start, end).trim()}${end < text.length ? "…" : ""}`;
}

function init() {
  const dialog = document.getElementById("search-dialog");
  const input = document.getElementById("search-input");
  const status = document.getElementById("search-status");
  const list = document.getElementById("search-results");
  if (!dialog || !input || !status || !list) return;

  const base = document.body?.dataset?.base || "/";
  const indexUrl = `${base}search-index.json`;
  let index = null;
  let loadPromise = null;
  let matches = [];
  let active = -1;
  let requestId = 0;

  input.setAttribute("role", "combobox");
  input.setAttribute("aria-autocomplete", "list");
  input.setAttribute("aria-expanded", "false");
  list.setAttribute("role", "listbox");
  list.setAttribute("aria-label", "Search results");

  function ensureIndex() {
    if (index) return Promise.resolve(index);
    if (!loadPromise) {
      loadPromise = fetch(indexUrl, { cache: "no-store" })
        .then((response) => {
          if (!response.ok) throw new Error(`Search index returned ${response.status}`);
          return response.json();
        })
        .then((data) => {
          index = data;
          return data;
        })
        .catch((error) => {
          loadPromise = null;
          throw error;
        });
    }
    return loadPromise;
  }

  function setStatus(message) {
    status.textContent = message;
  }

  function showRecent() {
    if (!index || input.value.trim()) return;
    matches = index.posts.slice(0, 6);
    active = -1;
    renderResults("");
  }

  function renderResults(query) {
    const tokens = tokenize(query);
    list.replaceChildren();

    if (!matches.length) {
      setStatus(query ? `No results for “${query}”` : "Type to search posts");
      input.removeAttribute("aria-activedescendant");
      return;
    }

    setStatus(
      query
        ? `${matches.length} ${matches.length === 1 ? "result" : "results"}`
        : "Recent posts",
    );

    matches.forEach((post, position) => {
      const item = document.createElement("li");
      const link = document.createElement("a");
      link.className = "search-result";
      link.id = `search-result-${position}`;
      link.href = post.url;
      link.setAttribute("role", "option");
      link.setAttribute("aria-selected", position === active ? "true" : "false");
      link.tabIndex = -1;

      const title = document.createElement("span");
      title.className = "result-title";
      title.append(highlight(post.title, tokens));

      const meta = document.createElement("span");
      meta.className = "result-meta";
      const tags = (post.tags || []).slice(0, 3).map((tag) => `#${tag}`).join(" ");
      meta.textContent = [post.dateDisplay, tags].filter(Boolean).join(" · ");

      const snippet = document.createElement("span");
      snippet.className = "result-snippet";
      snippet.append(highlight(makeSnippet(post, tokens), tokens));

      link.append(title, meta, snippet);
      item.append(link);
      list.append(item);
    });

    updateActive();
  }

  function updateActive() {
    const options = list.querySelectorAll(".search-result");
    options.forEach((option, position) => {
      const selected = position === active;
      option.setAttribute("aria-selected", selected ? "true" : "false");
      if (selected) {
        input.setAttribute("aria-activedescendant", option.id);
        option.scrollIntoView({ block: "nearest" });
      }
    });
    if (active < 0) input.removeAttribute("aria-activedescendant");
  }

  function move(delta) {
    if (!matches.length) return;
    active = active < 0 ? 0 : (active + delta + matches.length) % matches.length;
    updateActive();
  }

  async function runSearch(query) {
    const trimmed = query.trim();
    const current = ++requestId;

    if (!trimmed) {
      if (index) showRecent();
      else setStatus("Type to search posts");
      return;
    }

    setStatus("Searching…");
    try {
      const data = await ensureIndex();
      if (current !== requestId) return;
      matches = searchPosts(data.posts, trimmed, { limit: 20 });
      active = matches.length ? 0 : -1;
      renderResults(trimmed);
    } catch (error) {
      if (current !== requestId) return;
      matches = [];
      active = -1;
      list.replaceChildren();
      setStatus("Search index could not be loaded.");
      console.error(error);
    }
  }

  function reset() {
    requestId += 1;
    input.value = "";
    matches = [];
    active = -1;
    list.replaceChildren();
    status.textContent = "";
    input.removeAttribute("aria-activedescendant");
    input.setAttribute("aria-expanded", "false");
  }

  function open() {
    if (dialog.open) {
      input.focus();
      return;
    }
    dialog.showModal();
    reset();
    input.setAttribute("aria-expanded", "true");
    setStatus("Loading search index…");
    input.focus();
    ensureIndex()
      .then(() => {
        if (dialog.open && !input.value.trim()) showRecent();
      })
      .catch((error) => {
        if (!dialog.open) return;
        setStatus("Search index could not be loaded.");
        console.error(error);
      });
  }

  function prefetch() {
    ensureIndex().catch(() => {});
  }

  document.querySelectorAll("[data-search-open]").forEach((button) => {
    button.addEventListener("click", open);
    button.addEventListener("pointerenter", prefetch, { passive: true });
    button.addEventListener("focus", prefetch);
  });

  document.querySelectorAll("[data-search-close]").forEach((button) => {
    button.addEventListener("click", () => dialog.close());
  });

  dialog.addEventListener("close", reset);
  dialog.addEventListener("click", (event) => {
    if (event.target === dialog) dialog.close();
  });

  input.addEventListener("input", () => runSearch(input.value));
  input.addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown") {
      event.preventDefault();
      move(1);
    } else if (event.key === "ArrowUp") {
      event.preventDefault();
      move(-1);
    } else if (event.key === "Home" && matches.length) {
      event.preventDefault();
      active = 0;
      updateActive();
    } else if (event.key === "End" && matches.length) {
      event.preventDefault();
      active = matches.length - 1;
      updateActive();
    } else if (event.key === "Enter") {
      const post = matches[active >= 0 ? active : 0];
      if (post) {
        event.preventDefault();
        window.location.assign(post.url);
      }
    }
  });

  document.addEventListener("keydown", (event) => {
    const target = event.target;
    const typing =
      target instanceof HTMLElement &&
      (target.tagName === "INPUT" || target.tagName === "TEXTAREA" || target.isContentEditable);
    const isShortcut =
      (event.key === "/" && !typing) ||
      ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k");
    if (isShortcut) {
      event.preventDefault();
      open();
    }
  });

  const themeToggle = document.querySelector("[data-theme-toggle]");
  if (themeToggle) {
    themeToggle.addEventListener("click", () => {
      const root = document.documentElement;
      const current =
        root.dataset.theme ||
        (window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light");
      const next = current === "dark" ? "light" : "dark";
      root.dataset.theme = next;
      try {
        localStorage.setItem("theme", next);
      } catch {
        /* private mode */
      }
    });
  }
}

if (typeof document !== "undefined" && typeof window !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init, { once: true });
  } else {
    init();
  }
}
