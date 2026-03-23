import path from "node:path";
import type { ExtractItem, ScanMatch } from "../core/types.js";
import { extractModulePrefix, generateAutoKey, parseAutoKey } from "../core/keygen.js";

export function extractEntries(
  matches: ScanMatch[],
  existingZh: Record<string, string> = {},
  targetDir: string = process.cwd()
): ExtractItem[] {
  const occurrenceByText = new Map<string, number>();
  const textToKey = new Map<string, string>();
  const usedKeys = new Set<string>();
  const textToRelativeFile = new Map<string, string>();
  const prefixCounter = new Map<string, number>();

  for (const [key, text] of Object.entries(existingZh)) {
    textToKey.set(text, key);
    usedKeys.add(key);

    const parsed = parseAutoKey(key);
    if (parsed) {
      prefixCounter.set(parsed.modulePrefix, Math.max(prefixCounter.get(parsed.modulePrefix) ?? 0, parsed.index));
    }
  }

  for (const match of matches) {
    occurrenceByText.set(match.text, (occurrenceByText.get(match.text) ?? 0) + 1);

    const relativeFile = path.relative(targetDir, match.filePath);
    const current = textToRelativeFile.get(match.text);

    if (!current || relativeFile.localeCompare(current) < 0) {
      textToRelativeFile.set(match.text, relativeFile);
    }
  }

  const sortedTexts = [...occurrenceByText.keys()].sort((left, right) => left.localeCompare(right, "zh-Hans-CN"));

  for (const text of sortedTexts) {
    if (textToKey.has(text)) {
      continue;
    }

    const relativeFile = textToRelativeFile.get(text);
    const modulePrefix = relativeFile
      ? extractModulePrefix(path.resolve(targetDir, relativeFile), targetDir)
      : "module";
    let nextIndex = (prefixCounter.get(modulePrefix) ?? 0) + 1;
    let key = generateAutoKey(modulePrefix, nextIndex);

    while (usedKeys.has(key)) {
      nextIndex += 1;
      key = generateAutoKey(modulePrefix, nextIndex);
    }

    textToKey.set(text, key);
    usedKeys.add(key);
    prefixCounter.set(modulePrefix, nextIndex);
  }

  return sortedTexts.map((text) => ({
    key: textToKey.get(text) ?? generateAutoKey("module", 1),
    text,
    occurrences: occurrenceByText.get(text) ?? 0,
    reused: Object.prototype.hasOwnProperty.call(existingZh, textToKey.get(text) ?? "")
  }));
}

export function toZhJson(entries: ExtractItem[]): Record<string, string> {
  return Object.fromEntries(entries.map((entry) => [entry.key, entry.text]));
}
