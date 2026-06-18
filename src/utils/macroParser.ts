import type { NodeType } from "../types";

export type ParsedMacro = {
  valid: true;
  nodeType: NodeType;
  raw: string;
  name: string;
  primary: string | null;
  secondary: string | null;
  listValues: string[];
  tagName: string | null;
  note: string | null;
  extraFields: string[];
};

export type InvalidMacro = {
  valid: false;
  raw: string;
  reason: string;
};

export type MacroParseResult = ParsedMacro | InvalidMacro;

const ESCAPABLE = new Set(["<", ">", ";", ",", "\\"]);

export function normalizeTagName(name: string): string {
  return name.trim().toLowerCase();
}

export function splitUnescaped(raw: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = "";
  let escaped = false;

  for (const char of raw) {
    if (escaped) {
      current += char;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      current += char;
      escaped = true;
      continue;
    }
    if (char === delimiter) {
      parts.push(current);
      current = "";
      continue;
    }
    current += char;
  }

  parts.push(current);
  return parts;
}

export function unescapeMacroText(raw: string): string {
  let output = "";
  let escaped = false;

  for (const char of raw) {
    if (escaped) {
      output += ESCAPABLE.has(char) ? char : `\\${char}`;
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    output += char;
  }

  if (escaped) output += "\\";
  return output;
}

export function escapeMacroText(raw: string | null | undefined): string {
  return (raw || "").replace(/[<>;,\\]/g, (char) => `\\${char}`);
}

export function hasUnescaped(raw: string, target: string, fromIndex = 0): boolean {
  let escaped = false;
  for (let index = fromIndex; index < raw.length; index += 1) {
    const char = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === target) return true;
  }
  return false;
}

export function findUnescaped(raw: string, target: string, fromIndex = 0): number {
  let escaped = false;
  for (let index = fromIndex; index < raw.length; index += 1) {
    const char = raw[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === target) return index;
  }
  return -1;
}

export function isMacroClosed(raw: string): boolean {
  const start = findUnescaped(raw, "<");
  if (start < 0) return false;
  return findUnescaped(raw, ">", start + 1) > start;
}

export function inferNodeTypeFromSection(label: string): NodeType {
  const normalized = label.trim().toLowerCase();
  if (normalized === "tasks") return "task";
  if (normalized === "websites") return "website";
  if (normalized === "subscriptions") return "subscription";
  if (normalized === "timetable") return "action";
  if (normalized === "tags") return "tag";
  if (normalized === "locations") return "location";
  if (normalized === "identities") return "identity";
  if (normalized === "assets") return "asset";
  if (normalized.includes("sunday") || normalized.includes("monday")) return "action";
  if (normalized.includes("tuesday") || normalized.includes("wednesday")) return "action";
  if (normalized.includes("thursday") || normalized.includes("friday")) return "action";
  if (normalized.includes("saturday")) return "action";
  return "task";
}

export function parseMacro(rawInput: string, nodeType: NodeType): MacroParseResult {
  const raw = rawInput.trim();
  const start = findUnescaped(raw, "<");
  if (start !== 0) {
    return { valid: false, raw: rawInput, reason: "Macro must begin with an unescaped <." };
  }

  const end = findUnescaped(raw, ">", 1);
  if (end < 0) {
    return { valid: false, raw: rawInput, reason: "Macro is still open." };
  }

  const body = raw.slice(1, end);
  if (hasUnescaped(body, "<")) {
    return {
      valid: false,
      raw: rawInput,
      reason: "Nested item creation is not allowed."
    };
  }

  const [firstLine = "", ...noteLines] = body.split(/\r?\n/);
  const rawFirstLineFields = splitUnescaped(firstLine, ";");
  const firstLineFields = rawFirstLineFields.map((field) => unescapeMacroText(field).trim());
  const [name = "", primaryRaw = "", secondaryRaw = "", ...extraFields] = firstLineFields;
  const noteText = [...extraFields, ...noteLines.map(unescapeMacroText)]
    .map((line) => line.trimEnd())
    .filter((line, index, arr) => line.length > 0 || index < arr.length - 1)
    .join("\n")
    .trim();

  if (!name.trim()) {
    return { valid: false, raw: rawInput, reason: "Name is required." };
  }

  const resultBase = {
    valid: true as const,
    nodeType,
    raw: rawInput,
    name: name.trim(),
    primary: primaryRaw.trim() || null,
    secondary: secondaryRaw.trim() || null,
    listValues: [] as string[],
    tagName: secondaryRaw.trim() || null,
    note: noteText || null,
    extraFields
  };

  if (nodeType === "website") {
    return {
      ...resultBase,
      primary: primaryRaw.trim() || null,
      listValues: splitUnescaped(rawFirstLineFields[1] || "", ",")
        .map((value) => unescapeMacroText(value).trim())
        .filter(Boolean),
      tagName: secondaryRaw.trim() || null
    };
  }

  if (nodeType === "tag") {
    return {
      ...resultBase,
      tagName: null
    };
  }

  if (nodeType === "location") {
    return {
      ...resultBase,
      tagName: null,
      secondary: null
    };
  }

  return resultBase;
}

export function getFieldHints(nodeType: NodeType): string[] {
  switch (nodeType) {
    case "task":
      return ["name", "datetime", "tag"];
    case "subscription":
      return ["name", "rate", "tag"];
    case "website":
      return ["name", "identity1, identity2", "tag"];
    case "action":
      return ["name", "time", "tag"];
    case "tag":
      return ["name", "color"];
    case "location":
      return ["name", "address"];
    case "identity":
      return ["name", "reference website or asset", "tag"];
    case "asset":
      return ["name", "reference location", "tag"];
    default:
      return ["name"];
  }
}

export function getDraftHint(raw: string, nodeType: NodeType): string {
  const hints = getFieldHints(nodeType);
  const start = findUnescaped(raw, "<");
  const relevant = start >= 0 ? raw.slice(start + 1) : raw;
  const firstLine = relevant.split(/\r?\n/)[0] || "";
  const fieldIndex = splitUnescaped(firstLine, ";").length - 1;
  if (fieldIndex >= hints.length) return "note";
  return hints[Math.max(0, fieldIndex)] || "";
}
