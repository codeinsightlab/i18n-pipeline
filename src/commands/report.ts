import fs from "node:fs";
import path from "node:path";
import { collectSourceFiles, ensureParentDir } from "../core/files.js";
import { toDisplayPath } from "../core/display-path.js";
import { extractModulePrefix, parseAutoKey, parseModuleScopedKey } from "../core/keygen.js";
import type { CommandOptions, ExtractConflictDiagnostic, ExtractScopeDiagnostic, ScanMatch } from "../core/types.js";
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
  count: number;
  ratio: number;
}

interface HumanReadableReport {
  generated_at: string;
  target_dir: string;
  resource_file: string;
  structure: CommandOptions["resourceStructure"];
  summary: {
    files_scanned: number;
    hits_total: number;
    apply_preview_replaced_count: number;
    structured_keys: number;
    auto_keys: number;
    auto_ratio: number;
    conflicts: number;
    skipped: number;
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
    source_files: string[];
    apply_files: string[];
    apply_occurrences: number;
    source_rules: string[];
    group: string;
    trigger_reason: string;
    anchor_key: string;
    anchor_suffix: string;
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

  if (options.reportSourceFile) {
    return runReportFromSource(options, logger, htmlFile, jsonFile);
  }

  logger.debug(
    `report targetDir=${options.targetDir} output=${options.outputFile} structure=${options.resourceStructure} html=${htmlFile}`
  );

  const scriptRules = resolveScriptRules(options, logger);
  const matches = scanProject(options.targetDir, scriptRules);
  const scannedFiles = collectSourceFiles(options.targetDir);
  const previousResources = loadResourceMap(options.outputFile, options.resourceStructure);
  const expectedResourcesAfterExtract = buildExpectedResourcesForApply(matches, scannedFiles, previousResources, options);
  const extraction = extractEntriesWithDiagnostics(matches, expectedResourcesAfterExtract, options.targetDir, options.resourceStructure);

  const entries = extraction.entries;
  const diagnostics = extraction.diagnostics;
  const replacePreview = replaceProject(options.targetDir, entries, true, scriptRules);
  const autoApplyUsage = collectAutoApplyUsage(replacePreview.changes);
  const replacementKeyUsage = collectReplacementKeyUsage(replacePreview.changes);
  const autoScopes = diagnostics.scopes.filter((scope) => Boolean(parseAutoKey(scope.key)));
  const autoAppliedCount = [...replacementKeyUsage.keys()].filter((key) => Boolean(parseAutoKey(key))).length;
  const structuredAppliedCount = replacementKeyUsage.size - autoAppliedCount;
  const keyTotal = autoAppliedCount + structuredAppliedCount;

  const summary = {
    files_scanned: scannedFiles.length,
    hits_total: matches.length,
    apply_preview_replaced_count: replacePreview.changes.length,
    structured_keys: structuredAppliedCount,
    auto_keys: autoAppliedCount,
    auto_ratio: safeRatio(autoAppliedCount, keyTotal),
    conflicts: diagnostics.conflicts.length,
    skipped: replacePreview.skipped.length
  };

  const groupCounts = new Map<string, number>([
    ["form", 0],
    ["table", 0],
    ["rules", 0],
    ["auto", 0]
  ]);

  for (const scope of diagnostics.scopes) {
    const normalized = normalizeGroup(scope);
    if (groupCounts.has(normalized)) {
      groupCounts.set(normalized, (groupCounts.get(normalized) ?? 0) + 1);
    }
  }

  const groups = [...groupCounts.entries()].map(([group, count]) => ({
    group,
    count,
    ratio: safeRatio(count, entries.length)
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

  const autos = autoScopes.map((scope) => ({
    auto_key: scope.key,
    text: scope.text,
    source_files: (autoApplyUsage.get(scope.key)?.files ?? scope.source_files).map(toRelative),
    apply_files: (autoApplyUsage.get(scope.key)?.files ?? []).map(toRelative),
    apply_occurrences: autoApplyUsage.get(scope.key)?.occurrences ?? 0,
    source_rules: unique(scope.source_samples.map((item) => item.matched_rule)),
    group: normalizeGroup(scope),
    trigger_reason: mapAutoReason(scope.auto_reason),
    anchor_key: scope.preferred_key ?? "unknown",
    anchor_suffix: scope.preferred_suffix ?? ""
  })).filter((item) => item.apply_occurrences > 0);

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
    rankings: {
      auto_top_files: autoTopFiles,
      conflict_top_files: conflictTopFiles,
      hit_top_files: hitTopFiles
    }
  };

  ensureParentDir(htmlFile);
  ensureParentDir(jsonFile);
  fs.writeFileSync(jsonFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  fs.writeFileSync(htmlFile, renderHtml(report), "utf8");

  logger.info(`Report generated: ${toDisplayPath(htmlFile)}`);
  logger.info(`Summary JSON: ${toDisplayPath(jsonFile)}`);
  return 0;
}

function runReportFromSource(options: CommandOptions, logger: Logger, htmlFile: string, jsonFile: string): number {
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
  ensureParentDir(jsonFile);
  fs.writeFileSync(jsonFile, `${JSON.stringify(persistedJson, null, 2)}\n`, "utf8");
  fs.writeFileSync(htmlFile, html, "utf8");
  logger.info(`Report generated from source: ${toDisplayPath(htmlFile)}`);
  logger.info(`Source JSON copied to: ${toDisplayPath(jsonFile)}`);
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
  changes: Array<{ replacement: string; filePath: string }>
): Map<string, { occurrences: number; files: string[] }> {
  const byKey = new Map<string, { occurrences: number; fileSet: Set<string> }>();

  for (const change of changes) {
    const key = extractI18nKey(change.replacement);
    if (!key || !parseAutoKey(key)) {
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

function countAutosByFileFromApplyUsage(usage: Map<string, { occurrences: number; files: string[] }>): Map<string, number> {
  const counts = new Map<string, number>();

  for (const [key, value] of usage) {
    if (!parseAutoKey(key)) {
      continue;
    }
    for (const filePath of value.files) {
      counts.set(filePath, (counts.get(filePath) ?? 0) + value.occurrences);
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
    ["命中的文案总数", report.summary.hits_total],
    ["apply 预览替换数", report.summary.apply_preview_replaced_count],
    ["结构化 key 数", report.summary.structured_keys],
    ["auto key 数", report.summary.auto_keys],
    ["auto 占比", percent(report.summary.auto_ratio)],
    ["冲突数", report.summary.conflicts],
    ["跳过数", report.summary.skipped]
  ];

  const groupRows = report.groups.map((item) => [item.group, item.count, percent(item.ratio)]);
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
    item.source_files.join("\n"),
    item.apply_files.join("\n"),
    item.apply_occurrences,
    item.source_rules.join("\n"),
    item.group,
    item.trigger_reason,
    item.anchor_key,
    item.anchor_suffix
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
        <thead><tr><th>分组</th><th>数量</th><th>占比</th></tr></thead>
        <tbody>${renderRows(groupRows)}</tbody>
      </table>
      <p class="muted">固定展示 form / table / rules / auto。</p>
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
        <thead><tr><th>auto key</th><th>文案</th><th>来源文件</th><th>apply 预览文件</th><th>apply 预览次数</th><th>命中规则</th><th>场景分组</th><th>触发原因</th><th>候选锚点</th><th>锚点后缀</th></tr></thead>
        <tbody>${autoRows.length > 0 ? renderRows(autoRows) : "<tr><td colspan=\"10\">无 auto</td></tr>"}</tbody>
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
          <h3>auto 最多文件 Top ${TOP_N}</h3>
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
  </main>
</body>
</html>
`;
}
