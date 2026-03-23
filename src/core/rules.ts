import type { SkipReason } from "./types.js";

export const CHINESE_STRING_LITERAL_RE = /(['"])((?:\\.|(?!\1).)*?[\u4e00-\u9fff]+(?:\\.|(?!\1).)*?)\1/g;
export const SIMPLE_VUE_INTERPOLATION_RE = /{{\s*(['"])([^'"\\\n]*[\u4e00-\u9fff]+[^'"\\\n]*)\1\s*}}/g;
export const VUE_ALREADY_I18N_RE = /{{\s*\$?t\(\s*(['"])([^'"\\\n]*[\u4e00-\u9fff]+[^'"\\\n]*)\1\s*\)\s*}}/g;
export const VUE_ATTRIBUTE_LITERAL_RE = /\b[\w:-]+\s*=\s*(['"])([^'"\\\n]*[\u4e00-\u9fff]+[^'"\\\n]*)\1/g;
export const VUE_TEXT_NODE_RE = /(^|>)([^<>{}\n]*[\u4e00-\u9fff]+[^<>{}\n]*)(?=<|$)/g;

export function classifyJsLiteral(content: string, start: number, raw: string): SkipReason | null {
  if (raw.includes("${")) {
    return "template_string";
  }

  if (isInsideLineComment(content, start) || isInsideBlockComment(content, start)) {
    return "comment";
  }

  if (hasI18nPrefix(content, start)) {
    return "already_i18n";
  }

  if (isConsoleCall(content, start)) {
    return "console_call";
  }

  if (isObjectKey(content, start, raw.length)) {
    return "object_key";
  }

  return null;
}

export function hasI18nPrefix(content: string, start: number): boolean {
  const before = content.slice(Math.max(0, start - 30), start);
  return /(?:^|[^\w$])\$?t\s*\(\s*$/.test(before);
}

function isInsideLineComment(content: string, start: number): boolean {
  const lineStart = content.lastIndexOf("\n", start - 1) + 1;
  const linePrefix = content.slice(lineStart, start);
  return linePrefix.trimStart().startsWith("//");
}

function isInsideBlockComment(content: string, start: number): boolean {
  const before = content.slice(0, start);
  const openIndex = before.lastIndexOf("/*");
  const closeIndex = before.lastIndexOf("*/");
  return openIndex > closeIndex;
}

function isConsoleCall(content: string, start: number): boolean {
  const lineStart = content.lastIndexOf("\n", start - 1) + 1;
  const linePrefix = content.slice(lineStart, start).trimStart();
  return /^console\./.test(linePrefix);
}

function isObjectKey(content: string, start: number, rawLength: number): boolean {
  const suffix = content.slice(start + rawLength).trimStart();
  return suffix.startsWith(":");
}
