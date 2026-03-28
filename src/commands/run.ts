import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import type { CommandOptions } from "../core/types.js";
import type { Logger } from "../cli/logger.js";
import { extractModulePrefix } from "../core/keygen.js";
import { toDisplayPath } from "../core/display-path.js";
import { ensureParentDir } from "../core/files.js";
import { runExtractCommand } from "./extract.js";
import { runReportCommand } from "./report.js";
import { runReplaceCommand } from "./replace.js";
import { runScanCommand } from "./scan.js";

export function runRunCommand(options: CommandOptions, logger: Logger): number {
  logger.debug("run pipeline: scan -> extract -> replace --dry-run");
  // run 是“评估模式”：始终 dry-run replace，用于先看覆盖率与风险，不改源码。
  printConfigSummary("run", options, logger);
  const reportPlan = resolveCompositeReportPlan("run", options);

  const scanOptions = withStepReport({ ...options, reportFile: reportPlan.compositeJsonPath }, "scan");
  const extractOptions = withStepReport({ ...options, writeResources: false, reportFile: reportPlan.compositeJsonPath }, "extract");
  const replaceOptions = withStepReport({ ...options, dryRun: true, reportFile: reportPlan.compositeJsonPath }, "replace");
  const scanExitCode = runScanCommand(scanOptions, logger);
  if (scanExitCode !== 0) {
    return scanExitCode;
  }

  const extractExitCode = runExtractCommand(extractOptions, logger);
  if (extractExitCode !== 0) {
    return extractExitCode;
  }

  const replaceExitCode = runReplaceCommand(replaceOptions, logger);
  if (replaceExitCode !== 0) {
    return replaceExitCode;
  }

  writeCompositeReport("run", { ...options, reportFile: reportPlan.compositeJsonPath }, {
    scan: scanOptions.reportFile,
    extract: extractOptions.reportFile,
    replace: replaceOptions.reportFile
  }, logger);
  finalizeCompositeReport("run", reportPlan, options, logger);

  return 0;
}

export function runApplyCommand(options: CommandOptions, logger: Logger): number {
  logger.debug("apply pipeline: extract -> replace");
  // apply 是“落地模式”：先做 git 工作区检查，再执行真实写入。
  printConfigSummary("apply", options, logger);
  const reportPlan = resolveCompositeReportPlan("apply", options);
  const extractOptions = withStepReport({ ...options, reportFile: reportPlan.compositeJsonPath }, "extract");
  const replaceOptions = withStepReport({ ...options, reportFile: reportPlan.compositeJsonPath }, "replace");
  const gitCheckExitCode = handleGitWorkspaceCheck(options.targetDir, options.gitCheck, logger);
  if (gitCheckExitCode !== 0) {
    return gitCheckExitCode;
  }

  const extractExitCode = runExtractCommand(extractOptions, logger);
  if (extractExitCode !== 0) {
    return extractExitCode;
  }

  const replaceExitCode = runReplaceCommand(replaceOptions, logger);
  if (replaceExitCode !== 0) {
    return replaceExitCode;
  }

  writeCompositeReport("apply", { ...options, reportFile: reportPlan.compositeJsonPath }, {
    extract: extractOptions.reportFile,
    replace: replaceOptions.reportFile
  }, logger);
  finalizeCompositeReport("apply", reportPlan, options, logger);

  return 0;
}

function withStepReport(options: CommandOptions, step: "scan" | "extract" | "replace"): CommandOptions {
  if (!options.reportFile) {
    return options;
  }

  return {
    ...options,
    reportFile: deriveStepReportFile(options.reportFile, step)
  };
}

interface CompositeReportPlan {
  compositeJsonPath?: string;
  htmlPath?: string;
  keepJson: boolean;
  temporaryJson: boolean;
}

function resolveCompositeReportPlan(command: "run" | "apply", options: CommandOptions): CompositeReportPlan {
  // Legacy mode: --report <json> for run/apply keeps old JSON-only behavior.
  if (!options.reportHtmlFile && options.reportFile) {
    return {
      compositeJsonPath: options.reportFile,
      keepJson: true,
      temporaryJson: false
    };
  }

  if (options.reportHtmlFile) {
    if (options.reportFile) {
      return {
        compositeJsonPath: options.reportFile,
        htmlPath: options.reportHtmlFile,
        keepJson: Boolean(options.keepReportJson),
        temporaryJson: false
      };
    }

    const stamp = `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    const tempJson = path.join(os.tmpdir(), `i18n-${command}-${stamp}.json`);
    return {
      compositeJsonPath: tempJson,
      htmlPath: options.reportHtmlFile,
      keepJson: false,
      temporaryJson: true
    };
  }

  return {
    compositeJsonPath: options.reportFile,
    keepJson: Boolean(options.keepReportJson || options.reportFile),
    temporaryJson: false
  };
}

function finalizeCompositeReport(
  command: "run" | "apply",
  plan: CompositeReportPlan,
  options: CommandOptions,
  logger: Logger
): void {
  if (!plan.compositeJsonPath) {
    return;
  }

  if (plan.htmlPath) {
    runReportCommand({
      ...options,
      reportFile: plan.htmlPath,
      reportSourceFile: plan.compositeJsonPath
    }, logger);
  }

  if (plan.keepJson) {
    return;
  }

  cleanupStepReports(plan.compositeJsonPath);
}

function cleanupStepReports(compositeJsonPath: string): void {
  const stepFiles = [
    compositeJsonPath,
    deriveStepReportFile(compositeJsonPath, "scan"),
    deriveStepReportFile(compositeJsonPath, "extract"),
    deriveStepReportFile(compositeJsonPath, "replace")
  ];

  for (const filePath of stepFiles) {
    if (fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
    }
  }
}

function deriveStepReportFile(reportFile: string, step: "scan" | "extract" | "replace"): string {
  const suffix = `.${step}.json`;

  if (reportFile.endsWith(".json")) {
    return reportFile.replace(/\.json$/i, suffix);
  }

  return `${reportFile}${suffix}`;
}

function handleGitWorkspaceCheck(
  targetDir: string,
  mode: CommandOptions["gitCheck"],
  logger: Logger
): number {
  if (mode === "off") {
    logger.debug("apply safety check skipped: git-check mode is off.");
    return 0;
  }

  const gitRootResult = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: targetDir,
    encoding: "utf8"
  });

  if (gitRootResult.status !== 0) {
    logger.debug("apply safety check skipped: current directory is not inside a Git repository.");
    return 0;
  }

  const gitRoot = gitRootResult.stdout.trim();
  const statusResult = spawnSync("git", ["status", "--porcelain"], {
    cwd: gitRoot,
    encoding: "utf8"
  });

  if (statusResult.status !== 0) {
    logger.debug("apply safety check skipped: unable to read Git status.");
    return 0;
  }

  const dirtyLines = statusResult.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (dirtyLines.length === 0) {
    logger.debug("apply safety check: Git working tree is clean.");
    return 0;
  }

  const prefix = mode === "strict" ? "Error" : "Warning";
  logger.error(`${prefix}: Git working tree is not clean.`);
  logger.error(`${prefix}: Repository root: ${gitRoot}`);
  logger.error(`${prefix}: Uncommitted entries: ${dirtyLines.length}`);

  for (const line of dirtyLines.slice(0, 5)) {
    logger.error(`${prefix}:   ${line}`);
  }

  if (dirtyLines.length > 5) {
    logger.error(`${prefix}:   ... and ${dirtyLines.length - 5} more`);
  }

  if (mode === "strict") {
    // strict 模式下脏工作区直接中止，避免“替换结果”和人工改动混在一起难以回溯。
    logger.error("Error: apply has been aborted because --git-check=strict is enabled.");
    return 1;
  }

  logger.error("Warning: apply will continue. Review or commit changes first if needed.");

  // Future extension point: export a patch before apply when stricter safety is needed.
  return 0;
}

function printConfigSummary(command: "run" | "apply", options: CommandOptions, logger: Logger): void {
  logger.info("[配置]");
  logger.info(`structure: ${options.resourceStructure}${formatDefaultLabel(options.explicitConfig?.resourceStructure)}`);
  logger.info(`mode: ${options.extractMode}${formatDefaultLabel(options.explicitConfig?.extractMode)}`);
  logger.info(`git-check: ${options.gitCheck}${formatDefaultLabel(options.explicitConfig?.gitCheck)}`);
  logger.info(`script-rules: ${options.scriptRulesFile ? toDisplayPath(options.scriptRulesFile) : "disabled"}`);

  const missingDefaults: string[] = [];

  if (!options.explicitConfig?.resourceStructure) {
    // module-dir is now the default structure; no extra hint needed.
  }

  if (!options.explicitConfig?.extractMode) {
    // merge is the default append-only strategy; no extra hint needed.
  }

  if (!options.explicitConfig?.gitCheck) {
    missingDefaults.push("--git-check strict");
  }

  if (missingDefaults.length === 0) {
    logger.info("");
    return;
  }

  logger.info("");
  logger.info("你可以使用以下命令指定参数：");
  logger.info("");
  logger.info(`i18n ${command} --dir ${formatShellPath(options.targetDir)} ${missingDefaults.join(" ")}`);
  logger.info("");
}

function formatDefaultLabel(explicit: boolean | undefined): string {
  return explicit ? "" : "（默认）";
}

function formatShellPath(input: string): string {
  return /\s/.test(input) ? JSON.stringify(input) : input;
}

function writeCompositeReport(
  command: "run" | "apply",
  options: CommandOptions,
  stepReportFiles: { scan?: string; extract?: string; replace?: string },
  logger: Logger
): void {
  if (!options.reportFile) {
    return;
  }

  const scanReport = stepReportFiles.scan ? readJsonFile(stepReportFiles.scan) : undefined;
  const extractReport = stepReportFiles.extract ? readJsonFile(stepReportFiles.extract) : undefined;
  const replaceReport = stepReportFiles.replace ? readJsonFile(stepReportFiles.replace) : undefined;
  const detailsSource = replaceReport?.details ?? extractReport?.details ?? scanReport?.details ?? [];
  // 复合报告把 scan/extract/replace 聚合到同一文件，便于一次验收“发现-产键-替换”全链路。

  const report = {
    config: {
      command,
      dir: toDisplayPath(options.targetDir),
      output: toDisplayPath(options.outputFile),
      structure: options.resourceStructure,
      mode: options.extractMode,
      "git-check": options.gitCheck,
      report: options.reportFile ? toDisplayPath(options.reportFile) : undefined,
      "script-rules": options.scriptRulesFile ? toDisplayPath(options.scriptRulesFile) : undefined
    },
    summary: {
      scan: scanReport ? {
        files_scanned: scanReport.summary.files_scanned,
        candidates_found: scanReport.summary.candidates_found,
        extractable_count: scanReport.summary.extractable_count,
        replaceable_count: scanReport.summary.replaceable_count,
        policy_skipped_count: scanReport.summary.policy_skipped_count,
        script_unsupported_count: scanReport.summary.script_unsupported_count,
        matched_rule_distribution: scanReport.summary.matched_rule_distribution
      } : undefined,
      extract: extractReport ? {
        key_reused_count: extractReport.summary.key_reused_count,
        key_created_count: extractReport.summary.key_created_count,
        changed_files: extractReport.summary.changed_files,
        extractable_count: extractReport.summary.extractable_count,
        replaceable_count: extractReport.summary.replaceable_count,
        policy_skipped_count: extractReport.summary.policy_skipped_count,
        script_unsupported_count: extractReport.summary.script_unsupported_count,
        matched_rule_distribution: extractReport.summary.matched_rule_distribution
      } : undefined,
      module_distribution: buildModuleDistribution(detailsSource, options.targetDir),
      replace: replaceReport ? {
        replaced_count: replaceReport.summary.replaced_count,
        skipped_count: replaceReport.summary.skipped_count,
        extractable_count: replaceReport.summary.extractable_count,
        replaceable_count: replaceReport.summary.replaceable_count,
        policy_skipped_count: replaceReport.summary.policy_skipped_count,
        script_unsupported_count: replaceReport.summary.script_unsupported_count,
        matched_rule_distribution: replaceReport.summary.matched_rule_distribution,
        changed_files: replaceReport.summary.changed_files,
        unchanged_files: replaceReport.summary.unchanged_files
      } : undefined
    },
    details: {
      scan: scanReport?.details ?? [],
      extract: extractReport?.details ?? [],
      replace: replaceReport?.details ?? []
    }
  };

  ensureParentDir(options.reportFile);
  fs.writeFileSync(options.reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  logger.info(`Composite report written to ${toDisplayPath(options.reportFile)}.`);
}

function buildModuleDistribution(details: Array<{ file: string; candidates_found: number }>, targetDir: string): Record<string, number> {
  const counts = new Map<string, number>();

  for (const detail of details) {
    if (!detail.candidates_found) {
      continue;
    }

    const absoluteFile = path.resolve(process.cwd(), detail.file);
    // 这里复用 extractModulePrefix，确保报告中的模块分布与 key 前缀归属口径一致。
    const modulePrefix = extractModulePrefix(absoluteFile, targetDir);
    counts.set(modulePrefix, (counts.get(modulePrefix) ?? 0) + detail.candidates_found);
  }

  return Object.fromEntries([...counts.entries()].sort(([left], [right]) => left.localeCompare(right)));
}

function readJsonFile(filePath: string): any {
  return JSON.parse(fs.readFileSync(filePath, "utf8"));
}
