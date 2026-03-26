import fs from "node:fs";
import { collectSourceFiles, ensureParentDir } from "../core/files.js";
import { toDisplayPath } from "../core/display-path.js";
import type {
  BaseReport,
  CommandOptions,
  FileReportDetail,
  FileReportSamples,
  MatchedRule,
  ReplaceReport,
  ReportSample,
  ScanMatch
} from "../core/types.js";

const MAX_SAMPLES_PER_TYPE = 3;

export function writeReport(report: BaseReport, reportFile?: string): void {
  if (!reportFile) {
    return;
  }

  ensureParentDir(reportFile);
  fs.writeFileSync(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
}

export function createBaseReport(
  command: BaseReport["summary"]["command"],
  options: CommandOptions,
  summary: {
    filesScanned: number;
    candidatesFound: number;
    replacedCount: number;
    skippedCount: number;
    skippedReasons: BaseReport["summary"]["skipped_reasons"];
    extractableCount: number;
    replaceableCount: number;
    policySkippedCount: number;
    scriptUnsupportedCount: number;
    matchedRuleDistribution: BaseReport["summary"]["matched_rule_distribution"];
    changedFiles: string[];
    unchangedFiles: string[];
    keyReusedCount: number;
    keyCreatedCount: number;
  },
  details: FileReportDetail[]
): BaseReport {
  return {
    summary: {
      command,
      target_dir: toDisplayPath(options.targetDir),
      output_file: command === "scan" ? undefined : toDisplayPath(options.outputFile),
      report_file: options.reportFile ? toDisplayPath(options.reportFile) : undefined,
      dry_run: options.dryRun,
      files_scanned: summary.filesScanned,
      candidates_found: summary.candidatesFound,
      replaced_count: summary.replacedCount,
      skipped_count: summary.skippedCount,
      skipped_reasons: summary.skippedReasons,
      // extractable_count: 可提取总量（策略允许进入资源）。
      extractable_count: summary.extractableCount,
      // replaceable_count: 可直接替换总量（extractable 的子集/同集，取决于策略）。
      replaceable_count: summary.replaceableCount,
      // policy_skipped_count: 被策略故意跳过（非 bug）的候选数量。
      policy_skipped_count: summary.policySkippedCount,
      // script_unsupported_count: script 侧因白名单外被跳过的数量。
      script_unsupported_count: summary.scriptUnsupportedCount,
      // script_rules_enabled: 当前命令是否显式启用了外部 script 业务规则。
      script_rules_enabled: Boolean(options.scriptRulesFile),
      matched_rule_distribution: summary.matchedRuleDistribution,
      changed_files: summary.changedFiles.map((item) => toDisplayPath(item)),
      unchanged_files: summary.unchangedFiles.map((item) => toDisplayPath(item)),
      key_reused_count: summary.keyReusedCount,
      key_created_count: summary.keyCreatedCount
    },
    details
  };
}

export function countSourceFiles(targetDir: string): number {
  return collectSourceFiles(targetDir).length;
}

export function buildScanDetails(files: string[], matches: ScanMatch[]): FileReportDetail[] {
  const byFile = new Map<string, FileReportDetail>();

  for (const file of files) {
    byFile.set(file, createEmptyFileDetail(file));
  }

  for (const match of matches) {
    const detail = byFile.get(match.filePath) ?? createEmptyFileDetail(match.filePath);
    detail.candidates_found += 1;
    detail.matched_rule_distribution[match.matchedRule] = (detail.matched_rule_distribution[match.matchedRule] ?? 0) + 1;
    if (match.extractable) {
      detail.extractable_count += 1;
    }
    if (match.replaceable) {
      detail.replaceable_count += 1;
    } else {
      // 扫描阶段直接把不可替换计入策略跳过，便于评估“当前边界外工作量”。
      detail.policy_skipped_count += 1;
    }
    pushSample(detail, match.extractable && match.replaceable ? "replaced" : "skipped", {
      reason: match.skipReason ?? "replaced",
      text: match.text,
      line: match.line,
      snippet: toSnippet(match.raw),
      context_type: match.contextType,
      matched_rule: match.matchedRule,
      extractable: match.extractable,
      replaceable: match.replaceable,
      skip_reason: match.skipReason
    });
    byFile.set(match.filePath, detail);
  }

  for (const detail of byFile.values()) {
    applyReviewPriority(detail, "scan");
  }

  return [...byFile.values()].sort((left, right) => left.file.localeCompare(right.file));
}

export function buildReplaceDetails(files: string[], matches: ScanMatch[], report: ReplaceReport): FileReportDetail[] {
  const byFile = new Map<string, FileReportDetail>();

  for (const file of files) {
    byFile.set(file, createEmptyFileDetail(file));
  }

  for (const match of matches) {
    const detail = byFile.get(match.filePath) ?? createEmptyFileDetail(match.filePath);
    detail.candidates_found += 1;
    byFile.set(match.filePath, detail);
  }

  for (const change of report.changes) {
    const detail = byFile.get(change.filePath) ?? createEmptyFileDetail(change.filePath);
    detail.replaced_count += 1;
    // replace 明细按真实变更回填，确保 replaced_count 与明细样本可互相验证。
    detail.extractable_count += 1;
    detail.replaceable_count += 1;
    detail.matched_rule_distribution[change.matchedRule] = (detail.matched_rule_distribution[change.matchedRule] ?? 0) + 1;
    pushSample(detail, "replaced", {
      reason: "replaced",
      text: extractSampleText(change.original),
      line: change.line,
      snippet: toSnippet(change.original),
      context_type: change.contextType,
      matched_rule: change.matchedRule,
      extractable: change.extractable,
      replaceable: change.replaceable
    });
    byFile.set(change.filePath, detail);
  }

  for (const skip of report.skipped) {
    const detail = byFile.get(skip.filePath) ?? createEmptyFileDetail(skip.filePath);
    detail.skipped_count += 1;
    // replace 阶段 skip 统一视为策略跳过，不把它当作执行异常。
    detail.policy_skipped_count += 1;
    detail.skipped_reasons[skip.reason] = (detail.skipped_reasons[skip.reason] ?? 0) + 1;
    detail.matched_rule_distribution[skip.matchedRule] = (detail.matched_rule_distribution[skip.matchedRule] ?? 0) + 1;
    pushSample(detail, "skipped", {
      reason: skip.reason,
      text: extractSampleText(skip.raw),
      line: skip.line,
      snippet: toSnippet(skip.raw),
      context_type: skip.contextType,
      matched_rule: skip.matchedRule,
      extractable: skip.extractable,
      replaceable: skip.replaceable,
      skip_reason: skip.reason
    });
    byFile.set(skip.filePath, detail);
  }

  for (const detail of byFile.values()) {
    applyReviewPriority(detail, "replace");
  }

  return [...byFile.values()].sort((left, right) => left.file.localeCompare(right.file));
}

export function uniqueStrings(items: string[]): string[] {
  return [...new Set(items)].sort();
}

function createEmptyFileDetail(filePath: string): FileReportDetail {
  return {
    file: toDisplayPath(filePath),
    candidates_found: 0,
    replaced_count: 0,
    skipped_count: 0,
    skipped_reasons: {},
    extractable_count: 0,
    replaceable_count: 0,
    policy_skipped_count: 0,
    matched_rule_distribution: {},
    review_priority: "low"
  };
}

function pushSample(detail: FileReportDetail, type: keyof FileReportSamples, sample: ReportSample): void {
  if (!detail.samples) {
    detail.samples = {
      replaced: [],
      skipped: []
    };
  }

  if (detail.samples[type].length >= MAX_SAMPLES_PER_TYPE) {
    return;
  }

  detail.samples[type].push(sample);
}

export function countExtractableMatches(matches: ScanMatch[]): number {
  return matches.filter((match) => match.extractable).length;
}

export function countReplaceableMatches(matches: ScanMatch[]): number {
  return matches.filter((match) => match.replaceable).length;
}

export function countPolicySkippedMatches(matches: ScanMatch[]): number {
  return matches.filter((match) => !match.replaceable).length;
}

export function countScriptUnsupportedMatches(matches: ScanMatch[]): number {
  return matches.filter((match) => match.skipReason === "script_unsupported").length;
}

export function buildMatchedRuleDistribution(matches: ScanMatch[]): Partial<Record<MatchedRule, number>> {
  const counts: Partial<Record<MatchedRule, number>> = {};

  for (const match of matches) {
    counts[match.matchedRule] = (counts[match.matchedRule] ?? 0) + 1;
  }

  return sortRecord(counts);
}

function extractSampleText(raw: string): string {
  // 样本文本用于人工快速审查：尽量去掉包装语法，保留“人类可读文案核心”。
  return raw
    .replace(/^{{\s*/, "")
    .replace(/\s*}}$/, "")
    .replace(/^\$?t\(\s*/, "")
    .replace(/\s*\)$/, "")
    .replace(/^['"]|['"]$/g, "")
    .trim();
}

function toSnippet(raw: string): string {
  return raw.replace(/\s+/g, " ").trim().slice(0, 120);
}

function sortRecord<T extends string>(input: Partial<Record<T, number>>): Partial<Record<T, number>> {
  return Object.fromEntries(Object.entries(input).sort(([left], [right]) => left.localeCompare(right))) as Partial<Record<T, number>>;
}

function applyReviewPriority(detail: FileReportDetail, mode: "scan" | "replace"): void {
  if (mode === "scan") {
    if (detail.candidates_found >= 3) {
      detail.review_priority = "medium";
      detail.review_notes = "Multiple candidates found; confirm with replace --dry-run before review.";
      return;
    }

    detail.review_priority = "low";
    detail.review_notes = detail.candidates_found > 0
      ? "Few candidates found; wait for replace --dry-run before prioritizing."
      : "No candidates found under current rules.";
    return;
  }

  const unsupportedCount = detail.skipped_reasons.template_unsupported ?? 0;

  if (detail.replaced_count >= 3 && detail.skipped_count <= 1) {
    detail.review_priority = "high";
    detail.review_notes = "Replaceable items dominate and skip count is low.";
    return;
  }

  if (detail.replaced_count === 0) {
    detail.review_priority = "low";
    detail.review_notes = "No replaceable items under current rules.";
    return;
  }

  if (unsupportedCount > 0 && unsupportedCount >= detail.skipped_count - unsupportedCount + 1) {
    detail.review_priority = "low";
    detail.review_notes = "Unsupported template cases dominate; adapter work likely comes first.";
    return;
  }

  if (detail.skipped_count > detail.replaced_count) {
    detail.review_priority = "low";
    detail.review_notes = "Skipped items outweigh replaceable items.";
    return;
  }

  detail.review_priority = "medium";
  detail.review_notes = "Replaceable and skipped items are mixed; review manually before rollout.";
}
