export type SupportedFileExtension = ".js" | ".ts" | ".jsx" | ".tsx" | ".vue";

export interface ScanMatch {
  filePath: string;
  line: number;
  column: number;
  text: string;
  quote: "'" | '"';
  raw: string;
}

export type SkipReason =
  | "already_i18n"
  | "comment"
  | "console_call"
  | "object_key"
  | "template_string"
  | "template_unsupported";

export interface ExtractItem {
  key: string;
  text: string;
  occurrences: number;
  reused: boolean;
}

export interface ReplaceChange {
  filePath: string;
  line: number;
  original: string;
  replacement: string;
}

export interface ReplaceSkip {
  filePath: string;
  line: number;
  raw: string;
  reason: SkipReason;
}

export interface ReplaceReport {
  changes: ReplaceChange[];
  skipped: ReplaceSkip[];
  skippedByReason: Partial<Record<SkipReason, number>>;
  unchangedFiles: string[];
}

export interface CommandOptions {
  targetDir: string;
  outputFile: string;
  dryRun: boolean;
  debug: boolean;
  extractMode: "overwrite" | "merge" | "clean";
  reportFile?: string;
}

export interface BaseReport {
  summary: ReportSummary;
  details: FileReportDetail[];
}

export interface ReportSummary {
  command: "scan" | "extract" | "replace";
  target_dir: string;
  output_file?: string;
  report_file?: string;
  dry_run: boolean;
  files_scanned: number;
  candidates_found: number;
  replaced_count: number;
  skipped_count: number;
  skipped_reasons: Partial<Record<SkipReason, number>>;
  changed_files: string[];
  unchanged_files: string[];
  key_reused_count: number;
  key_created_count: number;
}

export interface FileReportDetail {
  file: string;
  candidates_found: number;
  replaced_count: number;
  skipped_count: number;
  skipped_reasons: Partial<Record<SkipReason, number>>;
  review_priority: "high" | "medium" | "low";
  review_notes?: string;
  samples?: FileReportSamples;
}

export interface FileReportSamples {
  replaced: ReportSample[];
  skipped: ReportSample[];
}

export interface ReportSample {
  reason: SkipReason | "replaced";
  text: string;
  line?: number;
  snippet?: string;
}
