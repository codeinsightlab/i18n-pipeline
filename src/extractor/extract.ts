import fs from "node:fs";
import path from "node:path";
import type {
  ExtractConflictDiagnostic,
  ExtractEntriesResult,
  ExtractItem,
  KeyDecisionRecord,
  ExtractScopeDiagnostic,
  ScanMatch
} from "../core/types.js";
import { extractModulePrefix, generateAutoKey, parseAutoKey, parseModuleScopedKey } from "../core/keygen.js";

export function extractEntries(
  matches: ScanMatch[],
  existingResources: Map<string, string> = new Map(),
  targetDir: string = process.cwd(),
  structure: "single" | "module-dir" = "single"
): ExtractItem[] {
  return buildExtractionResult(matches, existingResources, targetDir, structure).entries;
}

export function extractEntriesWithDiagnostics(
  matches: ScanMatch[],
  existingResources: Map<string, string> = new Map(),
  targetDir: string = process.cwd(),
  structure: "single" | "module-dir" = "single"
): ExtractEntriesResult {
  return buildExtractionResult(matches, existingResources, targetDir, structure);
}

function buildExtractionResult(
  matches: ScanMatch[],
  existingResources: Map<string, string>,
  targetDir: string,
  structure: "single" | "module-dir"
): ExtractEntriesResult {
  const extractableMatches = matches.filter((match) => match.extractable);
  const occurrenceByScope = new Map<string, number>();
  const scopeToText = new Map<string, string>();
  const scopeToModulePrefix = new Map<string, string>();
  const scopeToKey = new Map<string, string>();
  const scopeToPreferredKey = new Map<string, string>();
  const scopeToPreferredSuffix = new Map<string, string>();
  const scopeToSourceMatches = new Map<string, ScanMatch[]>();
  const usedKeys = new Set<string>();
  const prefixCounter = new Map<string, number>();
  const textToRelativeFile = new Map<string, string>();
  const globalTextToKey = new Map<string, string>();
  const moduleTextToKey = new Map<string, Map<string, string>>();
  const fileContentCache = new Map<string, string>();
  const conflicts: ExtractConflictDiagnostic[] = [];
  const scopes: ExtractScopeDiagnostic[] = [];
  const keyDecisions: KeyDecisionRecord[] = [];

  for (const [key, text] of existingResources) {
    usedKeys.add(key);

    const parsedScoped = parseModuleScopedKey(key);
    if (parsedScoped) {
      const scoped = moduleTextToKey.get(parsedScoped.modulePrefix) ?? new Map<string, string>();
      scoped.set(text, key);
      moduleTextToKey.set(parsedScoped.modulePrefix, scoped);
    }

    globalTextToKey.set(text, key);

    const parsedAuto = parseAutoKey(key);
    if (parsedAuto) {
      prefixCounter.set(parsedAuto.modulePrefix, Math.max(prefixCounter.get(parsedAuto.modulePrefix) ?? 0, parsedAuto.index));
    }
  }

  for (const match of extractableMatches) {
    const modulePrefix = extractModulePrefix(match.filePath, targetDir);
    const preferred = structure === "module-dir"
      ? resolvePreferredKeyForModuleDir(match, modulePrefix, fileContentCache)
      : null;
    const preferredKey = preferred?.key ?? null;
    const preferredSuffix = preferred?.suffix ?? null;

    if (structure === "module-dir") {
      const scope = preferredKey
        ? `${modulePrefix}\u0000${preferredKey}\u0000${match.text}`
        : `${modulePrefix}\u0000${match.text}`;
      occurrenceByScope.set(scope, (occurrenceByScope.get(scope) ?? 0) + 1);
      scopeToText.set(scope, match.text);
      scopeToModulePrefix.set(scope, modulePrefix);
      const sources = scopeToSourceMatches.get(scope) ?? [];
      sources.push(match);
      scopeToSourceMatches.set(scope, sources);
      if (preferredKey && !scopeToPreferredKey.has(scope)) {
        scopeToPreferredKey.set(scope, preferredKey);
      }
      if (preferredSuffix && !scopeToPreferredSuffix.has(scope)) {
        scopeToPreferredSuffix.set(scope, preferredSuffix);
      }
      continue;
    }

    occurrenceByScope.set(match.text, (occurrenceByScope.get(match.text) ?? 0) + 1);
    scopeToText.set(match.text, match.text);
    const sources = scopeToSourceMatches.get(match.text) ?? [];
    sources.push(match);
    scopeToSourceMatches.set(match.text, sources);
    if (preferredKey && !scopeToPreferredKey.has(match.text)) {
      scopeToPreferredKey.set(match.text, preferredKey);
    }
    if (preferredSuffix && !scopeToPreferredSuffix.has(match.text)) {
      scopeToPreferredSuffix.set(match.text, preferredSuffix);
    }

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

  const preferredKeyToDistinctText = new Map<string, Set<string>>();
  for (const scope of sortedScopes) {
    const preferredKey = scopeToPreferredKey.get(scope);
    if (!preferredKey) {
      continue;
    }
    const set = preferredKeyToDistinctText.get(preferredKey) ?? new Set<string>();
    set.add(scopeToText.get(scope) ?? "");
    preferredKeyToDistinctText.set(preferredKey, set);
  }

  for (const scope of sortedScopes) {
    const text = scopeToText.get(scope) ?? "";
    const modulePrefix = scopeToModulePrefix.get(scope) ?? "module";
    const preferredKey = scopeToPreferredKey.get(scope);
    const existingKey = structure === "module-dir"
      ? moduleTextToKey.get(modulePrefix)?.get(text)
      : globalTextToKey.get(text);
    const preferredSuffix = scopeToPreferredSuffix.get(scope);
    const pendingConflicts: Array<{ candidateKey: string; reason: string }> = [];

    if (structure === "module-dir" && preferredKey) {
      const directFormPlaceholderKey = preferredSuffix === "placeholder_combo" && preferredKey.includes(".form.")
        ? buildConflictSuffixKey(preferredKey, preferredSuffix)
        : null;

      if (directFormPlaceholderKey) {
        const directExistingText = existingResources.get(directFormPlaceholderKey);
        if (directExistingText === text) {
          scopeToKey.set(scope, directFormPlaceholderKey);
        } else if (!usedKeys.has(directFormPlaceholderKey)) {
          scopeToKey.set(scope, directFormPlaceholderKey);
          usedKeys.add(directFormPlaceholderKey);
        } else {
          pendingConflicts.push({
            candidateKey: directFormPlaceholderKey,
            reason: directExistingText && directExistingText !== text
              ? "same_key_different_message"
              : "candidate_key_taken"
          });
        }
      }

      if (!scopeToKey.has(scope)) {
        const preferredExistingText = existingResources.get(preferredKey);
        if (preferredExistingText === text) {
          scopeToKey.set(scope, preferredKey);
        } else if (!usedKeys.has(preferredKey)) {
          scopeToKey.set(scope, preferredKey);
          usedKeys.add(preferredKey);
        } else {
          pendingConflicts.push({
            candidateKey: preferredKey,
            reason: preferredExistingText && preferredExistingText !== text
              ? "same_key_different_message"
              : "candidate_key_taken"
          });
        }
      }

      if (!scopeToKey.has(scope)) {
        const withSuffix = preferredSuffix ? buildConflictSuffixKey(preferredKey, preferredSuffix) : null;
        if (withSuffix) {
          const suffixedExistingText = existingResources.get(withSuffix);
          if (suffixedExistingText === text) {
            scopeToKey.set(scope, withSuffix);
          } else if (!usedKeys.has(withSuffix)) {
            scopeToKey.set(scope, withSuffix);
            usedKeys.add(withSuffix);
          } else {
            pendingConflicts.push({
              candidateKey: withSuffix,
              reason: suffixedExistingText && suffixedExistingText !== text
                ? "same_key_different_message"
                : "candidate_key_taken"
            });
          }
        }
      }
    }

    const initialCandidateKey = preferredKey ?? existingKey;

    if (!scopeToKey.has(scope) && existingKey) {
      scopeToKey.set(scope, existingKey);
    }

    if (!scopeToKey.has(scope) && preferredKey && !usedKeys.has(preferredKey)) {
      scopeToKey.set(scope, preferredKey);
      usedKeys.add(preferredKey);
    }
    if (!scopeToKey.has(scope) && preferredKey) {
      const withSuffix = preferredSuffix ? buildConflictSuffixKey(preferredKey, preferredSuffix) : null;
      if (withSuffix && !usedKeys.has(withSuffix)) {
        scopeToKey.set(scope, withSuffix);
        usedKeys.add(withSuffix);
      }
    }

    if (!scopeToKey.has(scope)) {
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

    const finalKey = scopeToKey.get(scope) ?? generateAutoKey("module", 1);
    const isAuto = Boolean(parseAutoKey(finalKey));
    const sourceMatches = scopeToSourceMatches.get(scope) ?? [];
    const sourceFiles = uniqueSorted(sourceMatches.map((item) => item.filePath));
    const sourceFileCounts = countByFile(sourceMatches);
    const group = deriveScopeGroup(finalKey, preferredKey);

    for (const conflict of pendingConflicts) {
      conflicts.push({
        candidate_key: conflict.candidateKey,
        text,
        module_prefix: modulePrefix,
        group,
        reason: conflict.reason,
        source_files: sourceFiles,
        source_rules: uniqueSorted(sourceMatches.map((item) => item.matchedRule)),
        final_key: finalKey,
        fallback_to_auto: isAuto
      });
    }

    scopes.push({
      key: finalKey,
      text,
      module_prefix: modulePrefix,
      occurrences: occurrenceByScope.get(scope) ?? 0,
      reused: existingResources.has(finalKey),
      group,
      preferred_key: preferredKey,
      preferred_suffix: preferredSuffix,
      auto_reason: isAuto ? classifyAutoReason(preferredKey, pendingConflicts, preferredKeyToDistinctText, text) : undefined,
      source_files: sourceFiles,
      source_file_counts: sourceFileCounts,
      source_samples: sourceMatches.slice(0, 8).map((item) => ({
        file_path: item.filePath,
        line: item.line,
        matched_rule: item.matchedRule,
        context_type: item.contextType
      }))
    });

    const decisionStatus = resolveDecisionStatus(initialCandidateKey, finalKey, existingKey, pendingConflicts);
    const decisionReason = resolveDecisionReason(initialCandidateKey, finalKey, existingKey, pendingConflicts, preferredKey, isAuto);
    const candidateKey = initialCandidateKey ?? pendingConflicts[0]?.candidateKey;
    const sortedMatches = [...sourceMatches].sort((left, right) => {
      const byFile = left.filePath.localeCompare(right.filePath);
      if (byFile !== 0) {
        return byFile;
      }
      const byLine = left.line - right.line;
      if (byLine !== 0) {
        return byLine;
      }
      const byColumn = left.column - right.column;
      if (byColumn !== 0) {
        return byColumn;
      }
      const byRule = left.matchedRule.localeCompare(right.matchedRule);
      if (byRule !== 0) {
        return byRule;
      }
      return left.raw.localeCompare(right.raw);
    });

    sortedMatches.forEach((item, index) => {
      keyDecisions.push({
        occurrence_id: buildOccurrenceId(item, index),
        file_path: item.filePath,
        text: item.text,
        rule_type: item.matchedRule,
        candidate_key: candidateKey,
        final_key: finalKey,
        decision_reason: decisionReason,
        status: decisionStatus,
        loc: {
          line: item.line,
          column: item.column
        }
      });
    });
  }

  const entries = sortedScopes.map((scope) => ({
    key: scopeToKey.get(scope) ?? generateAutoKey("module", 1),
    text: scopeToText.get(scope) ?? "",
    modulePrefix: scopeToModulePrefix.get(scope) ?? "module",
    occurrences: occurrenceByScope.get(scope) ?? 0,
    reused: existingResources.has(scopeToKey.get(scope) ?? "")
  }));

  return {
    entries,
    diagnostics: {
      scopes: scopes.sort((left, right) => left.key.localeCompare(right.key)),
      key_decisions: keyDecisions.sort((left, right) => left.occurrence_id.localeCompare(right.occurrence_id)),
      conflicts: conflicts.sort((left, right) => {
        const byKey = left.candidate_key.localeCompare(right.candidate_key);
        if (byKey !== 0) {
          return byKey;
        }
        return left.text.localeCompare(right.text, "zh-Hans-CN");
      })
    }
  };
}

export function toResourceMap(entries: ExtractItem[]): Map<string, string> {
  return new Map(entries.map((entry) => [entry.key, entry.text]));
}

function classifyAutoReason(
  preferredKey: string | undefined,
  conflicts: Array<{ candidateKey: string; reason: string }>,
  preferredKeyToDistinctText: Map<string, Set<string>>,
  text: string
): string {
  if (!preferredKey) {
    return "no_stable_structured_key";
  }

  if (conflicts.some((item) => item.reason === "same_key_different_message")) {
    return "same_key_different_message";
  }

  const textSet = preferredKeyToDistinctText.get(preferredKey);
  if (textSet && textSet.size > 1 && textSet.has(text)) {
    return "multi_message_downgrade";
  }

  return "conservative_fallback";
}

function resolveDecisionStatus(
  candidateKey: string | undefined,
  finalKey: string,
  existingKey: string | undefined,
  conflicts: Array<{ candidateKey: string; reason: string }>
): "reused" | "generated" | "conflict-resolved" {
  if (conflicts.length > 0 || (candidateKey && candidateKey !== finalKey)) {
    return "conflict-resolved";
  }

  if (existingKey && finalKey === existingKey) {
    return "reused";
  }

  return "generated";
}

function resolveDecisionReason(
  candidateKey: string | undefined,
  finalKey: string,
  existingKey: string | undefined,
  conflicts: Array<{ candidateKey: string; reason: string }>,
  preferredKey: string | undefined,
  isAuto: boolean
): string {
  if (candidateKey && candidateKey !== finalKey) {
    if (existingKey && finalKey === existingKey) {
      return "reused_existing_stable_key";
    }
    if (isAuto) {
      return "fallback_auto_after_conflict";
    }
    return "candidate_key_rewritten";
  }

  if (conflicts.length > 0) {
    return conflicts[0]?.reason ?? "conflict_resolved";
  }

  if (existingKey && finalKey === existingKey) {
    return "reused_existing_key";
  }

  if (preferredKey && finalKey === preferredKey) {
    return "preferred_key_selected";
  }

  return isAuto ? "generated_auto_key" : "generated_structured_key";
}

function buildOccurrenceId(match: ScanMatch, index: number): string {
  return [
    normalizeOccurrenceField(match.filePath),
    match.line,
    match.column,
    normalizeOccurrenceField(match.matchedRule),
    normalizeOccurrenceField(match.contextType),
    normalizeOccurrenceField(match.text),
    index
  ].join("::");
}

function normalizeOccurrenceField(value: string | undefined): string {
  return (value ?? "").replace(/\s+/g, " ").trim();
}

function deriveScopeGroup(
  key: string,
  preferredKey: string | undefined
): "form" | "table" | "rules" | "query" | "auto" | "other" {
  const keyToInspect = preferredKey && parseAutoKey(key) ? preferredKey : key;

  if (parseAutoKey(keyToInspect)) {
    return "auto";
  }

  const structured = keyToInspect.match(/^[a-z0-9_.]+\.(form|table|rules|query)\./);
  if (structured) {
    return structured[1] as "form" | "table" | "rules" | "query";
  }

  return "other";
}

function uniqueSorted(items: string[]): string[] {
  return [...new Set(items)].sort((left, right) => left.localeCompare(right));
}

function countByFile(matches: ScanMatch[]): Array<{ file_path: string; count: number }> {
  const counts = new Map<string, number>();

  for (const match of matches) {
    counts.set(match.filePath, (counts.get(match.filePath) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([filePath, count]) => ({ file_path: filePath, count }))
    .sort((left, right) => {
      const byCount = right.count - left.count;
      if (byCount !== 0) {
        return byCount;
      }
      return left.file_path.localeCompare(right.file_path);
    });
}

const QUERY_GROUP_ROOTS = new Set(["query", "queryparams"]);
const FORM_GROUP_ROOTS = new Set(["form", "ruleform", "formdata"]);

interface PreferredKeyCandidate {
  key: string;
  suffix?: string;
}

function resolvePreferredKeyForModuleDir(
  match: ScanMatch,
  modulePrefix: string,
  cache: Map<string, string>
): PreferredKeyCandidate | null {
  const content = readFileContent(cache, match.filePath);
  if (!content) {
    return null;
  }

  const startIndex = calculateIndexFromLineColumn(content, match.line, match.column);
  if (startIndex < 0) {
    return null;
  }

  if (match.contextType === "js_string" && match.matchedRule === "script_rules_message") {
    const field = resolveRulesMessageField(content, startIndex);
    return field ? { key: `${modulePrefix}.rules.${field}` } : null;
  }

  if (match.contextType !== "template_attr_static") {
    return null;
  }

  const tagContext = resolveOpenTagContext(content, startIndex);
  if (!tagContext) {
    return null;
  }

  if (match.matchedRule === "template_el_table_column_label" && tagContext.tagName === "el-table-column") {
    const field = extractStableFieldName(readStaticAttributeValue(tagContext.source, "prop"));
    return field ? { key: `${modulePrefix}.table.${field}` } : null;
  }

  if (match.matchedRule === "template_label_attr" && tagContext.tagName === "el-form-item") {
    const propField = extractStableFieldName(readStaticAttributeValue(tagContext.source, "prop"));
    if (propField) {
      return { key: `${modulePrefix}.form.${propField}` };
    }
  }

  if (!isFormVModelFallbackMatch(match)) {
    return null;
  }

  const sameTagModel = extractModelPathInfo(readVModelAttributeValue(tagContext.source));
  if (sameTagModel) {
    const group = resolveFormGroup(sameTagModel.root);
    const parentFormItemProp = resolveParentFormItemProp(content, startIndex);
    const isStableFormComboPlaceholder =
      match.matchedRule === "template_placeholder_attr" &&
      group === "form" &&
      parentFormItemProp === sameTagModel.field;

    return {
      key: `${modulePrefix}.${group}.${sameTagModel.field}`,
      suffix: isStableFormComboPlaceholder ? "placeholder_combo" : resolveUsageSuffix(match.matchedRule)
    };
  }

  if (tagContext.tagName === "el-form-item") {
    const childModel = findFirstChildVModelPathInfo(content, tagContext);
    if (childModel) {
      return {
        key: `${modulePrefix}.${resolveFormGroup(childModel.root)}.${childModel.field}`,
        suffix: resolveUsageSuffix(match.matchedRule)
      };
    }
  }

  return null;
}

function isFormVModelFallbackMatch(match: ScanMatch): boolean {
  return match.matchedRule === "template_placeholder_attr" || match.matchedRule === "template_label_attr";
}

function readFileContent(cache: Map<string, string>, filePath: string): string {
  const cached = cache.get(filePath);
  if (cached !== undefined) {
    return cached;
  }

  try {
    const content = fs.readFileSync(filePath, "utf8");
    cache.set(filePath, content);
    return content;
  } catch {
    cache.set(filePath, "");
    return "";
  }
}

function calculateIndexFromLineColumn(content: string, line: number, column: number): number {
  if (line < 1 || column < 1) {
    return -1;
  }

  let index = 0;
  let currentLine = 1;

  while (currentLine < line) {
    const nextBreak = content.indexOf("\n", index);
    if (nextBreak < 0) {
      return -1;
    }
    index = nextBreak + 1;
    currentLine += 1;
  }

  return Math.min(index + column - 1, content.length);
}

interface OpenTagContext {
  tagName: string;
  source: string;
  start: number;
  end: number;
}

function resolveOpenTagContext(content: string, index: number): OpenTagContext | null {
  let cursor = content.lastIndexOf("<", index);

  while (cursor >= 0) {
    const nextChar = content[cursor + 1];
    if (nextChar === "/" || nextChar === "!" || nextChar === "?") {
      cursor = content.lastIndexOf("<", cursor - 1);
      continue;
    }

    const end = content.indexOf(">", cursor + 1);
    if (end < 0) {
      return null;
    }

    if (end < index) {
      cursor = content.lastIndexOf("<", cursor - 1);
      continue;
    }

    const source = content.slice(cursor, end + 1);
    const tagNameMatch = source.match(/^<\s*([A-Za-z][\w-]*)\b/);
    if (!tagNameMatch) {
      cursor = content.lastIndexOf("<", cursor - 1);
      continue;
    }

    return {
      tagName: tagNameMatch[1].toLowerCase(),
      source,
      start: cursor,
      end
    };
  }

  return null;
}

function readStaticAttributeValue(tagSource: string, attrName: string): string | null {
  const escapedName = escapeRegExp(attrName);
  const pattern = new RegExp(`(?:^|\\s)${escapedName}\\s*=\\s*(['"])([^"'\\n]+)\\1`, "i");
  const matched = tagSource.match(pattern);
  return matched?.[2]?.trim() || null;
}

function readVModelAttributeValue(tagSource: string): string | null {
  const matched = tagSource.match(/(?:^|\s)v-model(?:\.[\w-]+)*(?::[\w-]+)?\s*=\s*(['"])([^"'\n]+)\1/i);
  return matched?.[2]?.trim() || null;
}

function findFirstChildVModelPathInfo(content: string, tagContext: OpenTagContext): ModelPathInfo | null {
  const closePattern = /<\/\s*el-form-item\s*>/gi;
  closePattern.lastIndex = tagContext.end + 1;
  const closeMatch = closePattern.exec(content);
  if (!closeMatch) {
    return null;
  }

  const inner = content.slice(tagContext.end + 1, closeMatch.index);
  const vModelMatch = inner.match(/(?:^|\s)v-model(?:\.[\w-]+)*(?::[\w-]+)?\s*=\s*(['"])([^"'\n]+)\1/i);
  if (!vModelMatch?.[2]) {
    return null;
  }

  return extractModelPathInfo(vModelMatch[2]);
}

function extractStableFieldName(expression: string | null): string | null {
  const model = extractModelPathInfo(expression);
  return model?.field ?? null;
}

interface ModelPathInfo {
  root: string;
  field: string;
}

function extractModelPathInfo(expression: string | null): ModelPathInfo | null {
  if (!expression) {
    return null;
  }

  const normalized = expression.trim();
  if (!normalized) {
    return null;
  }

  if (!/^[A-Za-z_$][\w$]*(?:\s*(?:\.[A-Za-z_$][\w$]*|\[['"][A-Za-z_$][\w$]*['"]\]|\[\d+\]))*$/.test(normalized)) {
    return null;
  }

  const identifiers = normalized.match(/[A-Za-z_$][\w$]*/g);
  if (!identifiers || identifiers.length === 0) {
    return null;
  }

  const root = identifiers[0];
  const field = identifiers[identifiers.length - 1];

  if (!root || !field) {
    return null;
  }

  return { root, field };
}

function resolveFormGroup(root: string): "query" | "form" {
  const normalizedRoot = root.toLowerCase();

  if (QUERY_GROUP_ROOTS.has(normalizedRoot)) {
    return "query";
  }

  if (FORM_GROUP_ROOTS.has(normalizedRoot)) {
    return "form";
  }

  return "form";
}

function resolveUsageSuffix(matchedRule: ScanMatch["matchedRule"]): string | undefined {
  if (matchedRule === "template_placeholder_attr") {
    return "placeholder";
  }

  return undefined;
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function buildConflictSuffixKey(preferredKey: string, suffix: string): string {
  if (suffix === "placeholder" || suffix === "placeholder_combo") {
    const formFieldMatch = preferredKey.match(/^(.*\.form\.[A-Za-z_$][\w$]*)$/);
    if (formFieldMatch && suffix === "placeholder_combo") {
      return `${formFieldMatch[1]}Placeholder`;
    }
  }

  return `${preferredKey}.${suffix}`;
}

function resolveParentFormItemProp(content: string, index: number): string | null {
  const openIndex = content.lastIndexOf("<el-form-item", index);
  if (openIndex < 0) {
    return null;
  }

  const closeIndex = content.lastIndexOf("</el-form-item>", index);
  if (closeIndex > openIndex) {
    return null;
  }

  const tagEnd = content.indexOf(">", openIndex);
  if (tagEnd < 0 || tagEnd > index) {
    return null;
  }

  const tagSource = content.slice(openIndex, tagEnd + 1);
  return extractStableFieldName(readStaticAttributeValue(tagSource, "prop"));
}

function resolveRulesMessageField(content: string, literalStart: number): string | null {
  const beforeLiteral = content.slice(Math.max(0, literalStart - 160), literalStart);
  if (!/\bmessage\s*:\s*$/.test(beforeLiteral)) {
    return null;
  }

  const windowStart = Math.max(0, literalStart - 1600);
  const windowContent = content.slice(windowStart, literalStart);
  const rulesAnchorIndex = windowContent.lastIndexOf("rules");
  if (rulesAnchorIndex < 0) {
    return null;
  }

  const rulesScope = windowContent.slice(rulesAnchorIndex);
  const fieldPattern = /([A-Za-z_$][\w$]*)\s*:\s*(\[\s*|\{)/g;
  let candidate: { field: string; index: number } | null = null;

  for (const matched of rulesScope.matchAll(fieldPattern)) {
    const field = matched[1];
    if (!field || field === "message") {
      continue;
    }

    const index = matched.index ?? -1;
    if (index < 0) {
      continue;
    }

    candidate = { field, index };
  }

  if (!candidate) {
    return null;
  }

  const sliceAfterCandidate = rulesScope.slice(candidate.index);
  if (!/\bmessage\s*:/.test(sliceAfterCandidate)) {
    return null;
  }

  return candidate.field;
}
