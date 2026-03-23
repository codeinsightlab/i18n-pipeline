import path from "node:path";
import type { ExtractItem, ScanMatch } from "../core/types.js";
import { extractModulePrefix, generateAutoKey, parseAutoKey } from "../core/keygen.js";

export function extractEntries(
  matches: ScanMatch[],
  existingResources: Map<string, string> = new Map(),
  targetDir: string = process.cwd(),
  structure: "single" | "module-dir" = "single"
): ExtractItem[] {
  const extractableMatches = matches.filter((match) => match.extractable);
  const occurrenceByScope = new Map<string, number>();
  const scopeToText = new Map<string, string>();
  const scopeToModulePrefix = new Map<string, string>();
  const scopeToKey = new Map<string, string>();
  const usedKeys = new Set<string>();
  const prefixCounter = new Map<string, number>();
  const textToRelativeFile = new Map<string, string>();
  const globalTextToKey = new Map<string, string>();
  const moduleTextToKey = new Map<string, Map<string, string>>();

  for (const [key, text] of existingResources) {
    usedKeys.add(key);

    const parsed = parseAutoKey(key);
    if (parsed) {
      globalTextToKey.set(text, key);
      const scoped = moduleTextToKey.get(parsed.modulePrefix) ?? new Map<string, string>();
      scoped.set(text, key);
      moduleTextToKey.set(parsed.modulePrefix, scoped);
      prefixCounter.set(parsed.modulePrefix, Math.max(prefixCounter.get(parsed.modulePrefix) ?? 0, parsed.index));
      continue;
    }

    globalTextToKey.set(text, key);
  }

  for (const match of extractableMatches) {
    const modulePrefix = extractModulePrefix(match.filePath, targetDir);

    if (structure === "module-dir") {
      const scope = `${modulePrefix}\u0000${match.text}`;
      occurrenceByScope.set(scope, (occurrenceByScope.get(scope) ?? 0) + 1);
      scopeToText.set(scope, match.text);
      scopeToModulePrefix.set(scope, modulePrefix);
      continue;
    }

    occurrenceByScope.set(match.text, (occurrenceByScope.get(match.text) ?? 0) + 1);
    scopeToText.set(match.text, match.text);

    const relativeFile = path.relative(targetDir, match.filePath);
    const current = textToRelativeFile.get(match.text);

    if (!current || relativeFile.localeCompare(current) < 0) {
      textToRelativeFile.set(match.text, relativeFile);
    }
  }

  if (structure === "single") {
    for (const text of occurrenceByScope.keys()) {
      const relativeFile = textToRelativeFile.get(text);
      const modulePrefix = relativeFile
        ? extractModulePrefix(path.resolve(targetDir, relativeFile), targetDir)
        : "module";
      scopeToModulePrefix.set(text, modulePrefix);
    }
  }

  const sortedScopes = [...occurrenceByScope.keys()].sort((left, right) => {
    const leftModule = scopeToModulePrefix.get(left) ?? "";
    const rightModule = scopeToModulePrefix.get(right) ?? "";

    if (leftModule !== rightModule) {
      return leftModule.localeCompare(rightModule);
    }

    return (scopeToText.get(left) ?? "").localeCompare(scopeToText.get(right) ?? "", "zh-Hans-CN");
  });

  for (const scope of sortedScopes) {
    const text = scopeToText.get(scope) ?? "";
    const modulePrefix = scopeToModulePrefix.get(scope) ?? "module";
    const existingKey = structure === "module-dir"
      ? moduleTextToKey.get(modulePrefix)?.get(text)
      : globalTextToKey.get(text);

    if (existingKey) {
      scopeToKey.set(scope, existingKey);
      continue;
    }

    let nextIndex = (prefixCounter.get(modulePrefix) ?? 0) + 1;
    let key = generateAutoKey(modulePrefix, nextIndex);

    while (usedKeys.has(key)) {
      nextIndex += 1;
      key = generateAutoKey(modulePrefix, nextIndex);
    }

    scopeToKey.set(scope, key);
    usedKeys.add(key);
    prefixCounter.set(modulePrefix, nextIndex);
  }

  return sortedScopes.map((scope) => ({
    key: scopeToKey.get(scope) ?? generateAutoKey("module", 1),
    text: scopeToText.get(scope) ?? "",
    modulePrefix: scopeToModulePrefix.get(scope) ?? "module",
    occurrences: occurrenceByScope.get(scope) ?? 0,
    reused: existingResources.has(scopeToKey.get(scope) ?? "")
  }));
}

export function toResourceMap(entries: ExtractItem[]): Map<string, string> {
  return new Map(entries.map((entry) => [entry.key, entry.text]));
}
