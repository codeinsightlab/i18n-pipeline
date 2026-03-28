import fs from "node:fs";
import path from "node:path";
import { collectSourceFiles, ensureParentDir } from "../core/files.js";
import { toDisplayPath } from "../core/display-path.js";
import { extractModulePrefix, parseAutoKey, parseModuleScopedKey } from "../core/keygen.js";
import type { CommandOptions, ExtractConflictDiagnostic, ExtractScopeDiagnostic, KeyDecisionRecord, ScanMatch } from "../core/types.js";
import type { Logger } from "../cli/logger.js";
import { loadResourceMap } from "../core/resources.js";
import { extractEntriesWithDiagnostics, toResourceMap } from "../extractor/extract.js";
import { replaceProject } from "../replacer/replace.js";
import { scanProject } from "../scanner/scan.js";
import { resolveScriptRules } from "./script-rules.js";

const TOP_N = 10;

interface ReportRow {
  file: string;
  count: number;
}

interface GroupSummary {
  group: string;
  key_unique_count: number;
  extract_hit_occurrences: number;
  apply_preview_replacement_occurrences: number;
  // legacy alias: keep for backward compatibility.
  count: number;
  ratio: number;
}

interface HumanReadableReport {
  generated_at: string;
  target_dir: string;
  resource_file: string;
  structure: CommandOptions["resourceStructure"];
  summary: {
    // legacy fields
    files_scanned: number;
    hits_total: number;
    apply_preview_replaced_count: number;
    structured_keys: number;
    auto_keys: number;
    auto_ratio: number;
    conflicts: number;
    skipped: number;
    // explicit fields
    hits_total_scan_occurrences: number;
    extractable_hits_total: number;
    extracted_key_unique_total: number;
    apply_preview_replacement_occurrences: number;
    apply_preview_key_unique_total: number;
    apply_preview_structured_key_unique_count: number;
    apply_preview_auto_key_unique_count: number;
    apply_preview_auto_replacement_occurrences: number;
    auto_ratio_applied_keys: number;
  };
  groups: GroupSummary[];
  matched_rules: Array<{ rule: string; count: number; ratio: number }>;
  conflicts: Array<{
    candidate_key: string;
    text: string;
    source_files: string[];
    source_rules: string[];
    group: string;
    reason: string;
    final_result: string;
  }>;
  autos: Array<{
    auto_key: string;
    text: string;
    source_hit_occurrences: number;
    source_files: string[];
    apply_files: string[];
    apply_occurrences: number;
    apply_file_occurrences: Array<{ file: string; count: number }>;
    apply_preview_samples: string[];
    source_rules: string[];
    groups: string[];
    trigger_reasons: string[];
    anchor_keys: string[];
    anchor_suffixes: string[];
  }>;
  key_transitions: Array<{
    text: string;
    rule_type: string;
    candidate_key: string;
    final_key: string;
    candidate_group: string;
    final_group: string;
    rewritten: boolean;
    status: string;
    resolution_reason: string;
    // legacy alias
    reason: string;
    occurrences: number;
    apply_preview_occurrences: number;
    source_files: string[];
    source_samples: string[];
  }>;
  rankings: {
    auto_top_files: ReportRow[];
    conflict_top_files: ReportRow[];
    hit_top_files: ReportRow[];
  };
}

export function runReportCommand(options: CommandOptions, logger: Logger): number {
  const htmlFile = options.reportFile ?? path.resolve(process.cwd(), "i18n-report.html");
  const jsonFile = replaceExtension(htmlFile, ".json");
  const shouldWriteJson = options.keepReportJson !== false;

  if (options.reportSourceFile) {
    return runReportFromSource(options, logger, htmlFile, jsonFile, shouldWriteJson);
  }

  logger.debug(
    `report targetDir=${options.targetDir} output=${options.outputFile} structure=${options.resourceStructure} html=${htmlFile}`
  );

  const scriptRules = resolveScriptRules(options, logger);
  const matches = scanProject(options.targetDir, scriptRules);
  const scannedFiles = collectSourceFiles(options.targetDir);
  const previousResources = loadResourceMap(options.outputFile, options.resourceStructure);
  const expectedResourcesAfterExtract = buildExpectedResourcesForApply(matches, scannedFiles, previousResources, options);
  const extraction = extractEntriesWithDiagnostics(matches, sortResourceMap(expectedResourcesAfterExtract), options.targetDir, options.resourceStructure);

  const entries = extraction.entries;
  const diagnostics = extraction.diagnostics;
  const replacePreview = replaceProject(options.targetDir, entries, true, scriptRules);
  const autoApplyUsage = collectAutoApplyUsage(replacePreview.changes);
  const replacementKeyUsage = collectReplacementKeyUsage(replacePreview.changes);
  const autoScopes = diagnostics.scopes.filter((scope) => Boolean(parseAutoKey(scope.key)));
  const autoAppliedCount = [...replacementKeyUsage.keys()].filter((key) => Boolean(parseAutoKey(key))).length;
  const autoAppliedOccurrences = [...replacementKeyUsage.entries()]
    .filter(([key]) => Boolean(parseAutoKey(key)))
    .reduce((sum, [, item]) => sum + item.occurrences, 0);
  const structuredAppliedCount = replacementKeyUsage.size - autoAppliedCount;
  const keyTotal = autoAppliedCount + structuredAppliedCount;
  const extractableHitsTotal = matches.filter((item) => item.extractable).length;

  const summary = {
    // legacy fields
    files_scanned: scannedFiles.length,
    hits_total: matches.length,
    apply_preview_replaced_count: replacePreview.changes.length,
    structured_keys: structuredAppliedCount,
    auto_keys: autoAppliedCount,
    auto_ratio: safeRatio(autoAppliedCount, keyTotal),
    conflicts: diagnostics.conflicts.length,
    skipped: replacePreview.skipped.length,
    // explicit fields
    hits_total_scan_occurrences: matches.length,
    extractable_hits_total: extractableHitsTotal,
    extracted_key_unique_total: entries.length,
    apply_preview_replacement_occurrences: replacePreview.changes.length,
    apply_preview_key_unique_total: replacementKeyUsage.size,
    apply_preview_structured_key_unique_count: structuredAppliedCount,
    apply_preview_auto_key_unique_count: autoAppliedCount,
    apply_preview_auto_replacement_occurrences: autoAppliedOccurrences,
    auto_ratio_applied_keys: safeRatio(autoAppliedCount, keyTotal)
  };

  const groupOrder = ["form", "table", "rules", "query", "auto", "other"];
  const groupStats = new Map<string, { key_unique_count: number; extract_hit_occurrences: number; apply_preview_replacement_occurrences: number }>();
  for (const group of groupOrder) {
    groupStats.set(group, {
      key_unique_count: 0,
      extract_hit_occurrences: 0,
      apply_preview_replacement_occurrences: 0
    });
  }

  const keyToGroup = new Map<string, string>();
  for (const scope of diagnostics.scopes) {
    const group = normalizeGroup(scope);
    const current = groupStats.get(group) ?? {
      key_unique_count: 0,
      extract_hit_occurrences: 0,
      apply_preview_replacement_occurrences: 0
    };
    current.key_unique_count += 1;
    current.extract_hit_occurrences += scope.occurrences;
    groupStats.set(group, current);
    if (!keyToGroup.has(scope.key)) {
      keyToGroup.set(scope.key, group);
    }
  }

  for (const change of replacePreview.changes) {
    const key = extractI18nKey(change.replacement);
    if (!key) {
      continue;
    }
    const group = keyToGroup.get(key) ?? inferGroupFromKey(key);
    const current = groupStats.get(group) ?? {
      key_unique_count: 0,
      extract_hit_occurrences: 0,
      apply_preview_replacement_occurrences: 0
    };
    current.apply_preview_replacement_occurrences += 1;
    groupStats.set(group, current);
  }

  const groups = [...groupStats.entries()].map(([group, item]) => ({
    group,
    key_unique_count: item.key_unique_count,
    extract_hit_occurrences: item.extract_hit_occurrences,
    apply_preview_replacement_occurrences: item.apply_preview_replacement_occurrences,
    count: item.key_unique_count,
    ratio: safeRatio(item.key_unique_count, entries.length)
  }));

  const matchedRules = topRules(matches);

  const conflicts = diagnostics.conflicts.map((item) => ({
    candidate_key: item.candidate_key,
    text: item.text,
    source_files: item.source_files.map(toRelative),
    source_rules: item.source_rules,
    group: item.group,
    reason: mapConflictReason(item),
    final_result: item.fallback_to_auto ? `fallback_auto -> ${item.final_key}` : item.final_key
  }));
  const keyTransitions = buildKeyTransitionsFromDecisions(
    diagnostics.key_decisions ?? [],
    replacementKeyUsage
  );

  const autoScopeMap = new Map<string, {
    textSet: Set<string>;
    sourceHitOccurrences: number;
    sourceFiles: Set<string>;
    sourceRules: Set<string>;
    groups: Set<string>;
    triggerReasons: Set<string>;
    anchorKeys: Set<string>;
    anchorSuffixes: Set<string>;
  }>();
  for (const scope of autoScopes) {
    const current = autoScopeMap.get(scope.key) ?? {
      textSet: new Set<string>(),
      sourceHitOccurrences: 0,
      sourceFiles: new Set<string>(),
      sourceRules: new Set<string>(),
      groups: new Set<string>(),
      triggerReasons: new Set<string>(),
      anchorKeys: new Set<string>(),
      anchorSuffixes: new Set<string>()
    };
    current.textSet.add(scope.text);
    current.sourceHitOccurrences += scope.occurrences;
    for (const sourceFile of scope.source_files) {
      current.sourceFiles.add(sourceFile);
    }
    for (const sourceRule of unique(scope.source_samples.map((item) => item.matched_rule))) {
      current.sourceRules.add(sourceRule);
    }
    current.groups.add(normalizeGroup(scope));
    current.triggerReasons.add(mapAutoReason(scope.auto_reason));
    current.anchorKeys.add(scope.preferred_key ?? "unknown");
    current.anchorSuffixes.add(scope.preferred_suffix ?? "");
    autoScopeMap.set(scope.key, current);
  }

  const autos = [...autoScopeMap.entries()].map(([autoKey, meta]) => {
    const usage = autoApplyUsage.get(autoKey);
    return {
      auto_key: autoKey,
      text: [...meta.textSet].sort((left, right) => left.localeCompare(right, "zh-Hans-CN")).join("\n"),
      source_hit_occurrences: meta.sourceHitOccurrences,
      source_files: [...meta.sourceFiles].sort((left, right) => left.localeCompare(right)).map(toRelative),
      apply_files: (usage?.files ?? []).map(toRelative),
      apply_occurrences: usage?.occurrences ?? 0,
      apply_file_occurrences: usage?.file_occurrences.map((item) => ({ file: toRelative(item.file), count: item.count })) ?? [],
      apply_preview_samples: usage?.samples.map((item) => `${toRelative(item.file)}:${item.line} | ${compactText(item.original)}`) ?? [],
      source_rules: [...meta.sourceRules].sort((left, right) => left.localeCompare(right)),
      groups: [...meta.groups].sort((left, right) => left.localeCompare(right)),
      trigger_reasons: [...meta.triggerReasons].sort((left, right) => left.localeCompare(right)),
      anchor_keys: [...meta.anchorKeys].sort((left, right) => left.localeCompare(right)),
      anchor_suffixes: [...meta.anchorSuffixes].sort((left, right) => left.localeCompare(right))
    };
  }).filter((item) => item.apply_occurrences > 0);

  const hitTopFiles = topNByCount(countHitsByFile(matches.map((item) => item.filePath)), TOP_N).map(withRelativeFile);
  const conflictTopFiles = topNByCount(countConflictsByFile(diagnostics.conflicts), TOP_N).map(withRelativeFile);
  const autoTopFiles = topNByCount(countAutosByFileFromApplyUsage(autoApplyUsage), TOP_N).map(withRelativeFile);

  const report: HumanReadableReport = {
    generated_at: new Date().toISOString(),
    target_dir: toDisplayPath(options.targetDir),
    resource_file: toDisplayPath(options.outputFile),
    structure: options.resourceStructure,
    summary,
    groups,
    matched_rules: matchedRules,
    conflicts,
    autos,
    key_transitions: keyTransitions,
    rankings: {
      auto_top_files: autoTopFiles,
      conflict_top_files: conflictTopFiles,
      hit_top_files: hitTopFiles
    }
  };

  ensureParentDir(htmlFile);
  if (shouldWriteJson) {
    ensureParentDir(jsonFile);
    fs.writeFileSync(jsonFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  }
  fs.writeFileSync(htmlFile, renderHtml(report), "utf8");

  logger.info(`Report generated: ${toDisplayPath(htmlFile)}`);
  if (shouldWriteJson) {
    logger.info(`Summary JSON: ${toDisplayPath(jsonFile)}`);
  }
  return 0;
}

function runReportFromSource(options: CommandOptions, logger: Logger, htmlFile: string, jsonFile: string, shouldWriteJson: boolean): number {
  if (!options.reportSourceFile) {
    return 1;
  }

  const source = JSON.parse(fs.readFileSync(options.reportSourceFile, "utf8")) as unknown;
  let html = "";
  let persistedJson: unknown = source;

  if (isQualityReport(source)) {
    html = renderHtml(source);
  } else if (isCompositeReport(source)) {
    html = renderCompositeHtml(source);
  } else if (isStepReport(source)) {
    html = renderStepHtml(source);
  } else {
    throw new Error(`Unsupported report source format: ${options.reportSourceFile}`);
  }

  ensureParentDir(htmlFile);
  if (shouldWriteJson) {
    ensureParentDir(jsonFile);
    fs.writeFileSync(jsonFile, `${JSON.stringify(persistedJson, null, 2)}\n`, "utf8");
  }
  fs.writeFileSync(htmlFile, html, "utf8");
  logger.info(`Report generated from source: ${toDisplayPath(htmlFile)}`);
  if (shouldWriteJson) {
    logger.info(`Source JSON copied to: ${toDisplayPath(jsonFile)}`);
  }
  return 0;
}

function isQualityReport(input: unknown): input is HumanReadableReport {
  return Boolean(
    input &&
    typeof input === "object" &&
    "generated_at" in input &&
    "autos" in input &&
    "conflicts" in input
  );
}

function isCompositeReport(input: unknown): input is {
  config: Record<string, unknown>;
  summary: Record<string, unknown>;
  details: Record<string, unknown>;
} {
  return Boolean(
    input &&
    typeof input === "object" &&
    "config" in input &&
    "summary" in input &&
    "details" in input
  );
}

function isStepReport(input: unknown): input is {
  summary: Record<string, unknown>;
  details: Array<Record<string, unknown>>;
} {
  return Boolean(
    input &&
    typeof input === "object" &&
    "summary" in input &&
    "details" in input
  );
}

function renderCompositeHtml(report: {
  config: Record<string, unknown>;
  summary: Record<string, unknown>;
  details: Record<string, unknown>;
}): string {
  const configRows = Object.entries(report.config).map(([key, value]) => [key, String(value ?? "")]);
  const summaryRows = Object.entries(report.summary).map(([key, value]) => [key, stringifyForTable(value)]);
  const detailRows = Object.entries(report.details).map(([key, value]) => [key, Array.isArray(value) ? value.length : 0]);

  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>i18n Report (Source)</title>${baseStyle()}</head>
<body><main>
  <h1>i18n 执行日志报告（source）</h1>
  <section><h2>配置</h2><table><tbody>${renderRows(configRows)}</tbody></table></section>
  <section><h2>摘要</h2><table><tbody>${renderRows(summaryRows)}</tbody></table></section>
  <section><h2>明细条目数</h2><table><tbody>${renderRows(detailRows)}</tbody></table></section>
</main></body></html>`;
}

function renderStepHtml(report: {
  summary: Record<string, unknown>;
  details: Array<Record<string, unknown>>;
}): string {
  const summaryRows = Object.entries(report.summary).map(([key, value]) => [key, stringifyForTable(value)]);
  const detailRows = report.details.slice(0, 50).map((item) => [
    String(item.file ?? "unknown"),
    Number(item.candidates_found ?? 0),
    Number(item.replaced_count ?? 0),
    Number(item.skipped_count ?? 0)
  ]);

  return `<!doctype html>
<html lang="zh-CN">
<head><meta charset="utf-8" /><meta name="viewport" content="width=device-width, initial-scale=1" /><title>i18n Step Report (Source)</title>${baseStyle()}</head>
<body><main>
  <h1>i18n 步骤日志报告（source）</h1>
  <section><h2>摘要</h2><table><tbody>${renderRows(summaryRows)}</tbody></table></section>
  <section><h2>文件明细（最多 50 条）</h2><table><thead><tr><th>file</th><th>candidates</th><th>replaced</th><th>skipped</th></tr></thead><tbody>${detailRows.length > 0 ? renderRows(detailRows) : "<tr><td colspan=\"4\">无数据</td></tr>"}</tbody></table></section>
</main></body></html>`;
}

function stringifyForTable(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  if (typeof value === "object") {
    return JSON.stringify(value);
  }

  return String(value);
}

function baseStyle(): string {
  return `<style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f8fb; color: #1f2937; }
    main { max-width: 1200px; margin: 0 auto; padding: 24px 16px 48px; }
    h1, h2 { margin: 0 0 12px; }
    section { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; vertical-align: top; word-break: break-word; white-space: pre-wrap; }
    th { background: #f3f4f6; font-weight: 600; }
  </style>`;
}

function buildExpectedResourcesForApply(
  matches: ScanMatch[],
  scannedFiles: string[],
  previousResources: Map<string, string>,
  options: CommandOptions
): Map<string, string> {
  const effectiveMode = normalizeExtractMode(options.extractMode);
  const reusableResources = effectiveMode === "clean" ? new Map<string, string>() : previousResources;
  const extractEntries = extractEntriesWithDiagnostics(matches, reusableResources, options.targetDir, options.resourceStructure).entries;
  const currentResources = toResourceMap(extractEntries);
  const touchedModulePrefixes = collectTouchedModulePrefixes(scannedFiles, options.targetDir);

  if (effectiveMode === "clean") {
    if (options.resourceStructure === "single") {
      return currentResources;
    }

    const touchedModules = new Set(touchedModulePrefixes);
    const nextResources = new Map<string, string>();

    for (const [key, text] of previousResources) {
      const parsed = parseModuleScopedKey(key);
      if (!parsed || !touchedModules.has(parsed.modulePrefix)) {
        nextResources.set(key, text);
      }
    }

    for (const [key, text] of currentResources) {
      nextResources.set(key, text);
    }

    return nextResources;
  }

  const merged = new Map(previousResources);
  for (const [key, text] of currentResources) {
    merged.set(key, text);
  }

  return merged;
}

function collectTouchedModulePrefixes(files: string[], targetDir: string): string[] {
  const touched = new Set<string>();

  for (const filePath of files) {
    touched.add(extractModulePrefix(filePath, targetDir));
  }

  return [...touched].sort();
}

function normalizeExtractMode(mode: CommandOptions["extractMode"]): CommandOptions["extractMode"] {
  if (mode === "clean") {
    return "clean";
  }

  return "merge";
}

function mapConflictReason(conflict: ExtractConflictDiagnostic): string {
  if (conflict.reason === "same_key_different_message") {
    return "同 key 不同文案";
  }

  if (conflict.fallback_to_auto) {
    return "候选 key 被占用，回退 auto";
  }

  return "候选 key 被占用";
}

function mapAutoReason(reason: string | undefined): string {
  if (!reason) {
    return "unknown";
  }

  if (reason === "no_stable_structured_key") {
    return "无法稳定生成结构化 key";
  }

  if (reason === "multi_message_downgrade") {
    return "多 message 导致降级";
  }

  if (reason === "same_key_different_message") {
    return "同 key 不同文案";
  }

  return "其他保守回退";
}

function normalizeGroup(scope: ExtractScopeDiagnostic): string {
  if (scope.group === "other") {
    return parseAutoKey(scope.key) ? "auto" : "other";
  }

  return scope.group;
}

function inferGroupFromKey(key: string): string {
  if (parseAutoKey(key)) {
    return "auto";
  }
  const structured = key.match(/^[a-z0-9_.]+\.(form|table|rules|query)\./);
  if (structured) {
    return structured[1] ?? "other";
  }
  return "other";
}

function sortResourceMap(resources: Map<string, string>): Map<string, string> {
  return new Map([...resources.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function buildKeyTransitionsFromDecisions(
  decisions: KeyDecisionRecord[],
  replacementKeyUsage: Map<string, { occurrences: number; files: string[] }>
): Array<{
  text: string;
  rule_type: string;
  candidate_key: string;
  final_key: string;
  candidate_group: string;
  final_group: string;
  rewritten: boolean;
  status: string;
  resolution_reason: string;
  reason: string;
  occurrences: number;
  apply_preview_occurrences: number;
  source_files: string[];
  source_samples: string[];
}> {
  const grouped = new Map<string, {
    text: string;
    rule_type: string;
    candidate_key: string;
    final_key: string;
    resolution_reason: string;
    status: string;
    source_files: Set<string>;
    source_samples: Set<string>;
    occurrences: number;
  }>();

  for (const decision of decisions) {
    const candidateKey = decision.candidate_key ?? decision.final_key;
    const resolutionReason = decision.decision_reason ?? "unchanged";
    const decisionStatus = decision.status ?? "generated";
    const groupKey = [
      decision.text,
      decision.rule_type,
      candidateKey,
      decision.final_key,
      resolutionReason,
      decisionStatus
    ].join("\u0000");

    const current = grouped.get(groupKey) ?? {
      text: decision.text,
      rule_type: decision.rule_type,
      candidate_key: candidateKey,
      final_key: decision.final_key,
      resolution_reason: resolutionReason,
      status: decisionStatus,
      source_files: new Set<string>(),
      source_samples: new Set<string>(),
      occurrences: 0
    };
    current.occurrences += 1;
    current.source_files.add(toRelative(decision.file_path));
    if (decision.loc?.line) {
      current.source_samples.add(`${toRelative(decision.file_path)}:${decision.loc.line} [${decision.rule_type}]`);
    }
    grouped.set(groupKey, current);
  }

  return [...grouped.values()]
    .map((item) => {
      const applyOccurrences = replacementKeyUsage.get(item.final_key)?.occurrences ?? 0;
      const rewritten = item.candidate_key !== item.final_key;
      const status = applyOccurrences <= 0 ? "skipped" : (rewritten ? "conflict-resolved" : item.status);
      return {
        text: item.text,
        rule_type: item.rule_type,
        candidate_key: item.candidate_key,
        final_key: item.final_key,
        candidate_group: inferGroupFromKey(item.candidate_key),
        final_group: inferGroupFromKey(item.final_key),
        rewritten,
        status,
        resolution_reason: item.resolution_reason,
        reason: item.resolution_reason,
        occurrences: item.occurrences,
        apply_preview_occurrences: applyOccurrences,
        source_files: [...item.source_files].sort((left, right) => left.localeCompare(right)),
        source_samples: [...item.source_samples].sort((left, right) => left.localeCompare(right))
      };
    })
    .sort((left, right) => {
      if (left.rewritten !== right.rewritten) {
        return left.rewritten ? -1 : 1;
      }
      const byFinalKey = left.final_key.localeCompare(right.final_key);
      if (byFinalKey !== 0) {
        return byFinalKey;
      }
      return left.text.localeCompare(right.text, "zh-Hans-CN");
    });
}

function safeRatio(numerator: number, denominator: number): number {
  if (denominator <= 0) {
    return 0;
  }

  return Number((numerator / denominator).toFixed(4));
}

function topRules(matches: Array<{ matchedRule: string }>): Array<{ rule: string; count: number; ratio: number }> {
  const counts = new Map<string, number>();

  for (const match of matches) {
    counts.set(match.matchedRule, (counts.get(match.matchedRule) ?? 0) + 1);
  }

  return [...counts.entries()]
    .map(([rule, count]) => ({ rule, count, ratio: safeRatio(count, matches.length) }))
    .sort((left, right) => {
      const byCount = right.count - left.count;
      if (byCount !== 0) {
        return byCount;
      }
      return left.rule.localeCompare(right.rule);
    });
}

function collectAutoApplyUsage(
  changes: Array<{ replacement: string; filePath: string; line: number; original: string }>
): Map<string, { occurrences: number; files: string[]; file_occurrences: Array<{ file: string; count: number }>; samples: Array<{ file: string; line: number; original: string }> }> {
  const byKey = new Map<string, {
    occurrences: number;
    fileCount: Map<string, number>;
    samples: Array<{ file: string; line: number; original: string }>;
  }>();

  for (const change of changes) {
    const key = extractI18nKey(change.replacement);
    if (!key || !parseAutoKey(key)) {
      continue;
    }

    const current = byKey.get(key) ?? { occurrences: 0, fileCount: new Map<string, number>(), samples: [] };
    current.occurrences += 1;
    current.fileCount.set(change.filePath, (current.fileCount.get(change.filePath) ?? 0) + 1);
    if (current.samples.length < 5) {
      current.samples.push({
        file: change.filePath,
        line: change.line,
        original: change.original
      });
    }
    byKey.set(key, current);
  }

  const normalized = new Map<string, {
    occurrences: number;
    files: string[];
    file_occurrences: Array<{ file: string; count: number }>;
    samples: Array<{ file: string; line: number; original: string }>;
  }>();
  for (const [key, value] of byKey) {
    const fileOccurrences = [...value.fileCount.entries()]
      .map(([file, count]) => ({ file, count }))
      .sort((left, right) => {
        const byCount = right.count - left.count;
        if (byCount !== 0) {
          return byCount;
        }
        return left.file.localeCompare(right.file);
      });
    normalized.set(key, {
      occurrences: value.occurrences,
      files: fileOccurrences.map((item) => item.file),
      file_occurrences: fileOccurrences,
      samples: value.samples
    });
  }

  return normalized;
}

function collectReplacementKeyUsage(
  changes: Array<{ replacement: string; filePath: string }>
): Map<string, { occurrences: number; files: string[] }> {
  const byKey = new Map<string, { occurrences: number; fileSet: Set<string> }>();

  for (const change of changes) {
    const key = extractI18nKey(change.replacement);
    if (!key) {
      continue;
    }

    const current = byKey.get(key) ?? { occurrences: 0, fileSet: new Set<string>() };
    current.occurrences += 1;
    current.fileSet.add(change.filePath);
    byKey.set(key, current);
  }

  const normalized = new Map<string, { occurrences: number; files: string[] }>();
  for (const [key, value] of byKey) {
    normalized.set(key, {
      occurrences: value.occurrences,
      files: [...value.fileSet].sort((left, right) => left.localeCompare(right))
    });
  }

  return normalized;
}

function extractI18nKey(replacement: string): string | null {
  const match = replacement.match(/\$?t\((['"])([^'"]+)\1\)/);
  return match?.[2] ?? null;
}

function countHitsByFile(files: string[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const file of files) {
    counts.set(file, (counts.get(file) ?? 0) + 1);
  }

  return counts;
}

function countConflictsByFile(conflicts: ExtractConflictDiagnostic[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const conflict of conflicts) {
    for (const filePath of conflict.source_files) {
      counts.set(filePath, (counts.get(filePath) ?? 0) + 1);
    }
  }

  return counts;
}

function countAutosByFile(scopes: ExtractScopeDiagnostic[]): Map<string, number> {
  const counts = new Map<string, number>();

  for (const scope of scopes) {
    for (const item of scope.source_file_counts) {
      counts.set(item.file_path, (counts.get(item.file_path) ?? 0) + item.count);
    }
  }

  return counts;
}

function countAutosByFileFromApplyUsage(
  usage: Map<string, { occurrences: number; files: string[]; file_occurrences: Array<{ file: string; count: number }> }>
): Map<string, number> {
  const counts = new Map<string, number>();

  for (const [key, value] of usage) {
    if (!parseAutoKey(key)) {
      continue;
    }
    for (const item of value.file_occurrences) {
      counts.set(item.file, (counts.get(item.file) ?? 0) + item.count);
    }
  }

  return counts;
}

function topNByCount(counts: Map<string, number>, topN: number): ReportRow[] {
  return [...counts.entries()]
    .map(([file, count]) => ({ file, count }))
    .sort((left, right) => {
      const byCount = right.count - left.count;
      if (byCount !== 0) {
        return byCount;
      }
      return left.file.localeCompare(right.file);
    })
    .slice(0, topN);
}

function withRelativeFile(item: ReportRow): ReportRow {
  return {
    file: toRelative(item.file),
    count: item.count
  };
}

function toRelative(filePath: string): string {
  return toDisplayPath(filePath);
}

function replaceExtension(filePath: string, extension: string): string {
  const parsed = path.parse(filePath);
  return path.join(parsed.dir, `${parsed.name}${extension}`);
}

function percent(value: number): string {
  return `${(value * 100).toFixed(1)}%`;
}

function htmlEscape(input: string): string {
  return input
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function compactText(input: string): string {
  return input.replace(/\s+/g, " ").trim();
}

function renderRows(rows: Array<Array<string | number>>): string {
  return rows
    .map((columns) => `<tr>${columns.map((column) => `<td>${htmlEscape(String(column))}</td>`).join("")}</tr>`)
    .join("\n");
}

function unique(items: string[]): string[] {
  return [...new Set(items)];
}

function renderHtml(report: HumanReadableReport): string {
  const summaryRows = [
    ["扫描文件数", report.summary.files_scanned],
    ["命中的文案总数（scan 命中次数）", report.summary.hits_total_scan_occurrences],
    ["可提取命中总数（extractable hit 次数）", report.summary.extractable_hits_total],
    ["提取后唯一 key 数（extract）", report.summary.extracted_key_unique_total],
    ["apply 预览替换数（replace --dry-run 次数）", report.summary.apply_preview_replacement_occurrences],
    ["apply 预览唯一 key 数", report.summary.apply_preview_key_unique_total],
    ["apply 预览结构化 key 唯一数", report.summary.apply_preview_structured_key_unique_count],
    ["apply 预览 auto key 唯一数", report.summary.apply_preview_auto_key_unique_count],
    ["apply 预览 auto 替换次数", report.summary.apply_preview_auto_replacement_occurrences],
    ["auto 占比（按 apply 预览唯一 key）", percent(report.summary.auto_ratio_applied_keys)],
    ["冲突数", report.summary.conflicts],
    ["跳过数", report.summary.skipped]
  ];

  const groupRows = report.groups.map((item) => [
    item.group,
    item.key_unique_count,
    item.extract_hit_occurrences,
    item.apply_preview_replacement_occurrences,
    percent(item.ratio)
  ]);
  const conflictRows = report.conflicts.map((item) => [
    item.candidate_key,
    item.text,
    item.source_files.join("\n"),
    item.source_rules.join("\n"),
    item.group,
    item.reason,
    item.final_result
  ]);
  const autoRows = report.autos.map((item) => [
    item.auto_key,
    item.text,
    item.source_hit_occurrences,
    item.source_files.join("\n"),
    item.apply_files.join("\n"),
    item.apply_occurrences,
    item.apply_file_occurrences.map((entry) => `${entry.file}: ${entry.count}`).join("\n"),
    item.apply_preview_samples.join("\n"),
    item.source_rules.join("\n"),
    item.groups.join("\n"),
    item.trigger_reasons.join("\n"),
    item.anchor_keys.join("\n"),
    item.anchor_suffixes.join("\n")
  ]);
  const rewrittenTransitions = report.key_transitions.filter((item) => item.rewritten);
  const unchangedTransitionCount = report.key_transitions.length - rewrittenTransitions.length;
  const keyTransitionRows = rewrittenTransitions.map((item) => [
    item.text,
    item.rule_type,
    item.final_key,
    item.candidate_key,
    item.status,
    item.resolution_reason,
    item.apply_preview_occurrences,
    item.occurrences,
    item.source_files.join("\n"),
    item.source_samples.join("\n")
  ]);
  const ruleRows = report.matched_rules.map((item) => [item.rule, item.count, percent(item.ratio)]);
  const autoTopRows = report.rankings.auto_top_files.map((item) => [item.file, item.count]);
  const conflictTopRows = report.rankings.conflict_top_files.map((item) => [item.file, item.count]);
  const hitTopRows = report.rankings.hit_top_files.map((item) => [item.file, item.count]);

  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>i18n Report</title>
  <style>
    :root { color-scheme: light; }
    body { margin: 0; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; background: #f6f8fb; color: #1f2937; }
    main { max-width: 1200px; margin: 0 auto; padding: 24px 16px 48px; }
    h1, h2, h3 { margin: 0 0 12px; }
    p { margin: 0 0 12px; color: #4b5563; }
    section { background: #fff; border: 1px solid #e5e7eb; border-radius: 12px; padding: 16px; margin-bottom: 16px; }
    table { width: 100%; border-collapse: collapse; table-layout: fixed; }
    th, td { border: 1px solid #e5e7eb; padding: 8px; text-align: left; vertical-align: top; word-break: break-word; white-space: pre-wrap; }
    th { background: #f3f4f6; font-weight: 600; }
    .muted { color: #6b7280; font-size: 12px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(260px, 1fr)); gap: 12px; }
  </style>
</head>
<body>
  <main>
    <h1>i18n 最小可用质量报告</h1>
    <p>生成时间: ${htmlEscape(report.generated_at)} | 目录: ${htmlEscape(report.target_dir)} | 资源: ${htmlEscape(report.resource_file)} | 结构: ${htmlEscape(report.structure)}</p>

    <section>
      <h2>1. 总览摘要</h2>
      <table><tbody>${renderRows(summaryRows)}</tbody></table>
    </section>

    <section>
      <h2>2. 分组统计</h2>
      <table>
        <thead><tr><th>分组</th><th>唯一 key 数（extract）</th><th>extract 命中次数</th><th>apply 预览替换次数</th><th>唯一 key 占比</th></tr></thead>
        <tbody>${renderRows(groupRows)}</tbody>
      </table>
      <p class="muted">固定展示 form / table / rules / query / auto / other。唯一 key 数、命中次数、替换次数口径不同，不可直接相加比较。</p>
    </section>

    <section>
      <h2>3. 冲突明细</h2>
      <table>
        <thead><tr><th>候选 key</th><th>文案</th><th>来源文件</th><th>命中规则</th><th>分组</th><th>冲突原因</th><th>最终结果</th></tr></thead>
        <tbody>${conflictRows.length > 0 ? renderRows(conflictRows) : "<tr><td colspan=\"7\">无冲突</td></tr>"}</tbody>
      </table>
    </section>

    <section>
      <h2>4. Auto 明细</h2>
      <table>
        <thead><tr><th>auto key</th><th>文案</th><th>来源命中次数</th><th>来源文件</th><th>apply 预览文件</th><th>apply 预览次数</th><th>apply 文件分布</th><th>apply 预览样本</th><th>命中规则</th><th>场景分组</th><th>触发原因</th><th>候选锚点</th><th>锚点后缀</th></tr></thead>
        <tbody>${autoRows.length > 0 ? renderRows(autoRows) : "<tr><td colspan=\"13\">无 auto</td></tr>"}</tbody>
      </table>
      <p class="muted">apply 预览口径来自 replace --dry-run 结果，和 apply 替换行为保持一致。</p>
    </section>

    <section>
      <h2>5. 规则命中分布</h2>
      <table>
        <thead><tr><th>matched_rule</th><th>数量</th><th>占比</th></tr></thead>
        <tbody>${ruleRows.length > 0 ? renderRows(ruleRows) : "<tr><td colspan=\"3\">无数据</td></tr>"}</tbody>
      </table>
    </section>

    <section>
      <h2>6. 文件维度排行</h2>
      <div class="grid">
        <div>
          <h3>auto 替换次数最多文件 Top ${TOP_N}（apply 预览）</h3>
          <table><thead><tr><th>文件</th><th>数量</th></tr></thead><tbody>${autoTopRows.length > 0 ? renderRows(autoTopRows) : "<tr><td colspan=\"2\">无数据</td></tr>"}</tbody></table>
        </div>
        <div>
          <h3>冲突最多文件 Top ${TOP_N}</h3>
          <table><thead><tr><th>文件</th><th>数量</th></tr></thead><tbody>${conflictTopRows.length > 0 ? renderRows(conflictTopRows) : "<tr><td colspan=\"2\">无数据</td></tr>"}</tbody></table>
        </div>
        <div>
          <h3>命中最多文件 Top ${TOP_N}</h3>
          <table><thead><tr><th>文件</th><th>数量</th></tr></thead><tbody>${hitTopRows.length > 0 ? renderRows(hitTopRows) : "<tr><td colspan=\"2\">无数据</td></tr>"}</tbody></table>
        </div>
      </div>
    </section>

    <section>
      <h2>7. Key 对齐（候选 -> 最终）</h2>
      <table>
        <thead><tr><th>文案</th><th>命中规则</th><th>最终落地 key</th><th>原始候选 key</th><th>状态</th><th>改写原因</th><th>apply 预览次数</th><th>来源命中次数</th><th>来源文件</th><th>来源样本</th></tr></thead>
        <tbody>${keyTransitionRows.length > 0 ? renderRows(keyTransitionRows) : "<tr><td colspan=\"10\">无 key 改写</td></tr>"}</tbody>
      </table>
      <p class="muted">默认仅展示发生 key 改写的记录。未改写记录数：${unchangedTransitionCount}（可在 JSON 的 key_transitions 查看全量）。</p>
    </section>

    <section>
      <h2>8. 口径说明</h2>
      <table>
        <thead><tr><th>指标</th><th>阶段</th><th>口径</th><th>说明</th></tr></thead>
        <tbody>
          ${renderRows([
            ["命中的文案总数（scan 命中次数）", "scan", "命中次数", "来自 scan matches，总是按命中次数统计，包含后续可能跳过的命中。"],
            ["可提取命中总数", "extract", "命中次数", "来自 extractable matches，表示可进入资源提取的命中次数。"],
            ["提取后唯一 key 数", "extract", "唯一 key 数", "来自 extract entries，表示提取后 key 去重数量。"],
            ["apply 预览替换数", "replace --dry-run", "实际替换次数", "来自 replace --dry-run changes，等价于 apply 预计替换次数。"],
            ["apply 预览唯一 key 数", "replace --dry-run", "唯一 key 数", "来自预览替换结果里的 key 去重数量。"],
            ["auto 替换次数最多文件 TopN", "replace --dry-run", "文件内出现次数", "按每个文件中 auto key 的预览替换次数排序。"],
            ["规则命中分布", "scan", "命中次数", "按 matched_rule 聚合 scan 命中次数；不可与唯一 key 数直接相加比较。"],
            ["Key 对齐（候选 -> 最终）", "extract(key_decisions) + replace --dry-run", "按命中位点聚合", "final key 直接来自 extract 产出的统一决策记录；report 不再做二次反推。"]
          ])}
        </tbody>
      </table>
    </section>
  </main>
</body>
</html>
`;
}
