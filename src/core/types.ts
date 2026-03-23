export type SupportedFileExtension = ".js" | ".ts" | ".jsx" | ".tsx" | ".vue";

export interface ScanMatch {
  filePath: string;
  line: number;
  column: number;
  text: string;
  quote: "'" | '"';
  raw: string;
  contextType: ContextType;
  matchedRule: MatchedRule;
  extractable: boolean;
  replaceable: boolean;
  skipReason?: SkipReason;
}

export type ContextType =
  | "js_string"
  | "template_attr_static"
  | "template_text_static"
  | "template_expr"
  | "template_string"
  | "unsafe_skip";

export type SkipReason =
  | "already_i18n"
  | "comment"
  | "console_call"
  | "object_key"
  | "script_unsupported"
  | "template_string"
  | "template_unsupported";

export type MatchedRule =
  | "already_i18n"
  | "console_call"
  | "modal_confirm_concat"
  | "modal_msg_success"
  | "modal_msg_success_ternary"
  | "object_key"
  | "template_string"
  | "template_interpolation"
  | "template_label_attr"
  | "template_placeholder_attr"
  | "template_el_table_column_label"
  | "template_el_button_text"
  | "template_unsupported_attr_alt"
  | "template_unsupported_attr_other"
  | "template_unsupported_attr_title"
  | "template_unsupported_text"
  | "script_rules_message"
  | "script_this_title"
  | "script_unsupported_confirm_concat"
  | "script_unsupported_generic";

export type ScriptPatternType =
  | "string_literal"
  | "ternary_string"
  | "concat_string_var_string";

export interface ScriptTemplateArg {
  index: number;
  pattern: ScriptPatternType;
}

export interface ScriptTemplate {
  id: "modal_msg_success" | "modal_msg_success_ternary" | "modal_confirm_concat";
  callee: string;
  args: [ScriptTemplateArg];
}

export interface ExtractItem {
  key: string;
  text: string;
  modulePrefix: string;
  occurrences: number;
  reused: boolean;
}

export interface ReplaceChange {
  filePath: string;
  line: number;
  original: string;
  replacement: string;
  contextType: ContextType;
  matchedRule: MatchedRule;
  extractable: boolean;
  replaceable: boolean;
}

export interface ReplaceSkip {
  filePath: string;
  line: number;
  raw: string;
  reason: SkipReason;
  contextType: ContextType;
  matchedRule: MatchedRule;
  extractable: boolean;
  replaceable: boolean;
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
  writeResources?: boolean;
  resourceStructure: "single" | "module-dir";
  extractMode: "overwrite" | "merge" | "clean";
  gitCheck: "warn" | "strict" | "off";
  explicitConfig?: {
    resourceStructure: boolean;
    extractMode: boolean;
    gitCheck: boolean;
  };
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
  extractable_count: number;
  replaceable_count: number;
  policy_skipped_count: number;
  script_unsupported_count: number;
  matched_rule_distribution: Partial<Record<MatchedRule, number>>;
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
  extractable_count: number;
  replaceable_count: number;
  policy_skipped_count: number;
  matched_rule_distribution: Partial<Record<MatchedRule, number>>;
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
  context_type?: ContextType;
  matched_rule?: MatchedRule;
  extractable?: boolean;
  replaceable?: boolean;
  skip_reason?: SkipReason;
}
