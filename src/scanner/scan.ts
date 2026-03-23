import fs from "node:fs";
import path from "node:path";
import { collectSourceFiles } from "../core/files.js";
import { CHINESE_STRING_LITERAL_RE, SIMPLE_VUE_INTERPOLATION_RE, classifyJsLiteral } from "../core/rules.js";
import type { ScanMatch } from "../core/types.js";

export function scanProject(targetDir: string): ScanMatch[] {
  const files = collectSourceFiles(targetDir);
  const matches: ScanMatch[] = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf8");
    if (path.extname(filePath) === ".vue") {
      const template = extractVueTemplate(content);

      if (template) {
        matches.push(...scanVueTemplate(filePath, template.content, template.startLine));
      }

      continue;
    }

    matches.push(...scanContentForLiterals(filePath, content, 0));
  }

  return matches;
}

export function scanContentForLiterals(filePath: string, content: string, lineOffset: number): ScanMatch[] {
  const matches: ScanMatch[] = [];

  for (const match of content.matchAll(CHINESE_STRING_LITERAL_RE)) {
    const raw = match[0];
    const text = match[2];
    const start = match.index ?? 0;

    if (classifyJsLiteral(content, start, raw)) {
      continue;
    }

    const location = calculateLocation(content, start);

    matches.push({
      filePath,
      line: location.line + lineOffset,
      column: location.column,
      text,
      quote: raw[0] as "'" | '"',
      raw
    });
  }

  return matches;
}

function scanVueTemplate(filePath: string, content: string, lineOffset: number): ScanMatch[] {
  const matches: ScanMatch[] = [];

  for (const match of content.matchAll(SIMPLE_VUE_INTERPOLATION_RE)) {
    const raw = match[0];
    const text = match[2];
    const start = match.index ?? 0;
    const location = calculateLocation(content, start);

    matches.push({
      filePath,
      line: location.line + lineOffset,
      column: location.column,
      text,
      quote: raw.includes("'") ? "'" : '"',
      raw
    });
  }

  return matches;
}

function extractVueTemplate(content: string): { content: string; startLine: number } | null {
  const templateMatch = content.match(/<template\b[^>]*>([\s\S]*?)<\/template>/i);

  if (!templateMatch || templateMatch.index === undefined) {
    return null;
  }

  const prefix = content.slice(0, templateMatch.index);
  const startLine = prefix.split("\n").length - 1;

  return {
    content: templateMatch[1],
    startLine
  };
}

function calculateLocation(content: string, index: number): { line: number; column: number } {
  const prefix = content.slice(0, index);
  const lines = prefix.split("\n");

  return {
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1
  };
}
