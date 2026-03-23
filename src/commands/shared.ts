import fs from "node:fs";
import path from "node:path";
import { collectSourceFiles, ensureParentDir } from "../core/files.js";
import type {
  BaseReport,
  CommandOptions,
  FileReportDetail,
  FileReportSamples,
  ReplaceReport,
  ReportSample,
  ScanMatch
} from "../core/types.js";

const MAX_SAMPLES_PER_TYPE = 3;

export function readZhJson(filePath: string): Record<string, string> {
  if (!fs.existsSync(filePath)) {
    return {};
  }

  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, string>;
  } catch {
    return {};
  }
}

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
      target_dir: options.targetDir,
      output_file: command === "scan" ? undefined : options.outputFile,
      report_file: options.reportFile,
      dry_run: options.dryRun,
      files_scanned: summary.filesScanned,
      candidates_found: summary.candidatesFound,
      replaced_count: summary.replacedCount,
      skipped_count: summary.skippedCount,
      skipped_reasons: summary.skippedReasons,
      changed_files: summary.changedFiles.map((item) => path.relative(process.cwd(), item)),
      unchanged_files: summary.unchangedFiles.map((item) => path.relative(process.cwd(), item)),
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
    pushSample(detail, "replaced", {
      reason: "replaced",
      text: extractSampleText(change.original),
      line: change.line,
      snippet: toSnippet(change.original)
    });
    byFile.set(change.filePath, detail);
  }

  for (const skip of report.skipped) {
    const detail = byFile.get(skip.filePath) ?? createEmptyFileDetail(skip.filePath);
    detail.skipped_count += 1;
    detail.skipped_reasons[skip.reason] = (detail.skipped_reasons[skip.reason] ?? 0) + 1;
    pushSample(detail, "skipped", {
      reason: skip.reason,
      text: extractSampleText(skip.raw),
      line: skip.line,
      snippet: toSnippet(skip.raw)
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
    file: path.relative(process.cwd(), filePath),
    candidates_found: 0,
    replaced_count: 0,
    skipped_count: 0,
    skipped_reasons: {},
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

function extractSampleText(raw: string): string {
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
