import { normalizeEol } from "./utils.js";

/**
 * Split a Markdown file into frontmatter data and body.
 * Supports a pragmatic subset of YAML: scalars, quoted strings, inline arrays,
 * indented lists, and literal/folded block scalars.
 */
export function splitFrontmatter(raw) {
  const text = normalizeEol(raw).replace(/^\uFEFF/, "");
  const lines = text.split("\n");
  if (lines[0].trim() !== "---") {
    return { data: {}, body: text, hasFrontmatter: false };
  }
  let end = -1;
  for (let i = 1; i < lines.length; i += 1) {
    if (/^(---|\.\.\.)\s*$/.test(lines[i])) {
      end = i;
      break;
    }
  }
  if (end === -1) {
    throw new Error("Unterminated frontmatter: add a closing --- line");
  }
  return {
    data: parseFrontmatterYaml(lines.slice(1, end).join("\n")),
    body: lines.slice(end + 1).join("\n").replace(/^\n+/, ""),
    hasFrontmatter: true,
  };
}

export function parseFrontmatterYaml(yaml, label = "frontmatter") {
  const data = {};
  const lines = normalizeEol(yaml).split("\n");
  let i = 0;

  const fail = (lineIndex, message) => {
    throw new Error(`${label} line ${lineIndex + 1}: ${message}`);
  };

  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim() || isCommentLine(line)) {
      i += 1;
      continue;
    }
    if (/^\s/.test(line)) {
      fail(i, "unexpected indentation (nested mappings are not supported)");
    }
    const match = /^([A-Za-z0-9_.-]+)\s*:\s*(.*)$/.exec(line);
    if (!match) {
      fail(i, 'expected "key: value"');
    }
    const key = match[1];
    const rest = stripComment(match[2]).trim();

    if (rest === "") {
      const nextIndex = nextNonBlank(lines, i + 1);
      if (nextIndex !== -1 && /^\s+-\s*/.test(lines[nextIndex])) {
        const items = [];
        let j = i + 1;
        while (j < lines.length) {
          if (!lines[j].trim() || isCommentLine(lines[j])) {
            j += 1;
            continue;
          }
          const itemMatch = /^\s+-\s*(.*)$/.exec(lines[j]);
          if (!itemMatch) break;
          try {
            items.push(parseValue(itemMatch[1]));
          } catch (error) {
            fail(j, error.message);
          }
          j += 1;
        }
        data[key] = items;
        i = j;
        continue;
      }
      if (nextIndex !== -1 && /^\s/.test(lines[nextIndex])) {
        fail(nextIndex, `nested value for "${key}" is not supported (only lists and block scalars)`);
      }
      data[key] = null;
      i += 1;
      continue;
    }

    if (/^[|>][+-]?$/.test(rest)) {
      const { text, next } = collectBlockScalar(lines, i + 1, rest);
      data[key] = text;
      i = next;
      continue;
    }

    try {
      data[key] = parseValue(rest);
    } catch (error) {
      fail(i, error.message);
    }
    i += 1;
  }

  return data;
}

export function parseValue(raw) {
  const value = stripComment(String(raw)).trim();
  if (value === "") return "";
  if (value === "[]") return [];
  if (value.startsWith("[") && value.endsWith("]")) {
    return splitInlineList(value.slice(1, -1)).map((item) => parseValue(item));
  }
  if (value.length >= 2 && value.startsWith('"') && value.endsWith('"')) {
    try {
      return JSON.parse(value);
    } catch {
      return value
        .slice(1, -1)
        .replace(/\\"/g, '"')
        .replace(/\\n/g, "\n")
        .replace(/\\t/g, "\t")
        .replace(/\\\\/g, "\\");
    }
  }
  if (value.length >= 2 && value.startsWith("'") && value.endsWith("'")) {
    return value.slice(1, -1).replace(/''/g, "'");
  }
  if (/^(true|yes|on)$/i.test(value)) return true;
  if (/^(false|no|off)$/i.test(value)) return false;
  if (/^(null|~)$/i.test(value)) return null;
  if (/^-?\d+(?:\.\d+)?$/.test(value)) return Number(value);
  return value;
}

function splitInlineList(inner) {
  const parts = [];
  let buffer = "";
  let quote = null;
  for (let i = 0; i < inner.length; i += 1) {
    const char = inner[i];
    if (quote) {
      buffer += char;
      if (char === "\\" && quote === '"') {
        i += 1;
        buffer += inner[i] ?? "";
      } else if (char === quote) {
        quote = null;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
      buffer += char;
    } else if (char === ",") {
      if (buffer.trim()) parts.push(buffer.trim());
      buffer = "";
    } else {
      buffer += char;
    }
  }
  if (buffer.trim()) parts.push(buffer.trim());
  return parts;
}

function collectBlockScalar(lines, start, style) {
  let end = start;
  while (end < lines.length && (lines[end].trim() === "" || /^\s/.test(lines[end]))) {
    end += 1;
  }
  const rawLines = lines.slice(start, end);
  let indent = Infinity;
  for (const line of rawLines) {
    if (line.trim()) indent = Math.min(indent, line.match(/^\s*/)[0].length);
  }
  if (!Number.isFinite(indent)) indent = 0;
  const content = rawLines.map((line) => (line.trim() ? line.slice(indent) : ""));
  let text = style.startsWith(">") ? foldLines(content) : content.join("\n");
  const chomp = style.slice(1);
  if (chomp === "-") text = text.replace(/\n+$/, "");
  else if (chomp === "+") text = `${text.replace(/\n*$/, "")}\n`;
  else text = `${text.replace(/\n*$/, "")}\n`;
  return { text, next: end };
}

function foldLines(lines) {
  let out = "";
  for (const line of lines) {
    if (line === "") {
      out += "\n";
      continue;
    }
    out += `${out && !out.endsWith("\n") ? " " : ""}${line}`;
  }
  return out;
}

function stripComment(text) {
  let quote = null;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quote) {
      if (char === "\\" && quote === '"') {
        i += 1;
      } else if (char === quote) {
        quote = null;
      }
    } else if (char === '"' || char === "'") {
      quote = char;
    } else if (char === "#" && (i === 0 || /\s/.test(text[i - 1]))) {
      return text.slice(0, i);
    }
  }
  return text;
}

function isCommentLine(line) {
  return /^\s*#/.test(line);
}

function nextNonBlank(lines, start) {
  for (let i = start; i < lines.length; i += 1) {
    if (lines[i].trim() && !isCommentLine(lines[i])) return i;
  }
  return -1;
}
