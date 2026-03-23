import fs from "node:fs";
import path from "node:path";
import { collectSourceFiles } from "../core/files.js";
import {
  CHINESE_STRING_LITERAL_RE,
  SIMPLE_VUE_INTERPOLATION_RE,
  VUE_ALREADY_I18N_RE,
  VUE_ATTRIBUTE_LITERAL_RE,
  VUE_TEXT_NODE_RE,
  classifyJsLiteral
} from "../core/rules.js";
import type { ExtractItem, ReplaceChange, ReplaceReport, ReplaceSkip, SkipReason } from "../core/types.js";

export function replaceProject(targetDir: string, entries: ExtractItem[], dryRun: boolean): ReplaceReport {
  const files = collectSourceFiles(targetDir);
  const textToKey = new Map(entries.map((entry) => [entry.text, entry.key]));
  const changes: ReplaceChange[] = [];
  const skipped: ReplaceSkip[] = [];
  const unchangedFiles: string[] = [];

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, "utf8");
    const result = path.extname(filePath) === ".vue"
      ? replaceVueTemplate(filePath, source, textToKey, changes, skipped)
      : replaceJsLikeFile(filePath, source, textToKey, changes, skipped);

    if (!dryRun && result.changed) {
      fs.writeFileSync(filePath, result.content, "utf8");
    }

    if (!result.changed) {
      unchangedFiles.push(filePath);
    }
  }

  return {
    changes,
    skipped,
    skippedByReason: groupSkippedByReason(skipped),
    unchangedFiles
  };
}

function replaceJsLikeFile(
  filePath: string,
  content: string,
  textToKey: Map<string, string>,
  changes: ReplaceChange[],
  skipped: ReplaceSkip[]
): { content: string; changed: boolean } {
  let changed = false;
  let cursor = 0;
  let nextContent = "";

  for (const match of content.matchAll(/`(?:\\.|[^`])*?[\u4e00-\u9fff]+(?:\\.|[^`])*?`/g)) {
    skipped.push(buildSkip(filePath, content, match.index ?? 0, match[0], "template_string"));
  }

  for (const match of content.matchAll(CHINESE_STRING_LITERAL_RE)) {
    const raw = match[0];
    const text = match[2];
    const start = match.index ?? 0;
    const end = start + raw.length;
    const skipReason = classifyJsLiteral(content, start, raw);

    nextContent += content.slice(cursor, start);
    cursor = end;

    if (skipReason) {
      nextContent += raw;
      skipped.push(buildSkip(filePath, content, start, raw, skipReason));
      continue;
    }

    const key = textToKey.get(text);

    if (!key) {
      nextContent += raw;
      continue;
    }

    changed = true;
    const replacement = `t("${key}")`;
    changes.push(buildChange(filePath, content, start, raw, replacement));
    nextContent += replacement;
  }

  nextContent += content.slice(cursor);

  return { content: nextContent, changed };
}

function replaceVueTemplate(
  filePath: string,
  content: string,
  textToKey: Map<string, string>,
  changes: ReplaceChange[],
  skipped: ReplaceSkip[]
): { content: string; changed: boolean } {
  const templateRe = /<template\b[^>]*>([\s\S]*?)<\/template>/i;
  const templateMatch = content.match(templateRe);

  if (!templateMatch || templateMatch.index === undefined) {
    return { content, changed: false };
  }

  const originalTemplate = templateMatch[1];
  let changed = false;
  const templateStart = content.indexOf(originalTemplate, templateMatch.index ?? 0);

  for (const match of originalTemplate.matchAll(VUE_ALREADY_I18N_RE)) {
    skipped.push(buildSkip(filePath, content, templateStart + (match.index ?? 0), match[0], "already_i18n"));
  }

  for (const match of originalTemplate.matchAll(VUE_ATTRIBUTE_LITERAL_RE)) {
    skipped.push(buildSkip(filePath, content, templateStart + (match.index ?? 0), match[0], "template_unsupported"));
  }

  const strippedTemplate = originalTemplate.replace(/{{[\s\S]*?}}/g, "");
  for (const match of strippedTemplate.matchAll(VUE_TEXT_NODE_RE)) {
    const text = match[2].trim();

    if (!text) {
      continue;
    }

    const start = strippedTemplate.indexOf(match[2], match.index ?? 0);
    if (start !== -1) {
      skipped.push(buildSkip(filePath, content, templateStart + start, text, "template_unsupported"));
    }
  }

  const replacedTemplate = originalTemplate.replace(SIMPLE_VUE_INTERPOLATION_RE, (raw, _quote: string, text: string, offset: number) => {
    const key = textToKey.get(text);

    if (!key) {
      return raw;
    }

    changed = true;
    const absoluteOffset = (templateMatch.index ?? 0) + offset;
    const replacement = `{{ $t("${key}") }}`;
    changes.push(buildChange(filePath, content, absoluteOffset, raw, replacement));
    return replacement;
  });

  if (!changed) {
    return { content, changed: false };
  }

  const nextContent = content.replace(originalTemplate, replacedTemplate);
  return { content: nextContent, changed: true };
}

function buildChange(
  filePath: string,
  content: string,
  offset: number,
  original: string,
  replacement: string
): ReplaceChange {
  const prefix = content.slice(0, offset);
  const lines = prefix.split("\n");

  return {
    filePath,
    line: lines.length,
    original,
    replacement
  };
}

function buildSkip(
  filePath: string,
  content: string,
  offset: number,
  raw: string,
  reason: SkipReason
): ReplaceSkip {
  const prefix = content.slice(0, offset);
  const lines = prefix.split("\n");

  return {
    filePath,
    line: lines.length,
    raw,
    reason
  };
}

function groupSkippedByReason(skipped: ReplaceSkip[]): Partial<Record<SkipReason, number>> {
  const counts: Partial<Record<SkipReason, number>> = {};

  for (const item of skipped) {
    counts[item.reason] = (counts[item.reason] ?? 0) + 1;
  }

  return counts;
}
