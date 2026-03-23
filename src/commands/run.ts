import { spawnSync } from "node:child_process";
import type { CommandOptions } from "../core/types.js";
import type { Logger } from "../cli/logger.js";
import { runExtractCommand } from "./extract.js";
import { runReplaceCommand } from "./replace.js";
import { runScanCommand } from "./scan.js";

export function runRunCommand(options: CommandOptions, logger: Logger): number {
  logger.debug("run pipeline: scan -> extract -> replace --dry-run");

  const scanExitCode = runScanCommand(withStepReport(options, "scan"), logger);
  if (scanExitCode !== 0) {
    return scanExitCode;
  }

  const extractExitCode = runExtractCommand(withStepReport(options, "extract"), logger);
  if (extractExitCode !== 0) {
    return extractExitCode;
  }

  return runReplaceCommand(withStepReport({ ...options, dryRun: true }, "replace"), logger);
}

export function runApplyCommand(options: CommandOptions, logger: Logger): number {
  logger.debug("apply pipeline: extract -> replace");
  warnIfGitWorkspaceDirty(options.targetDir, logger);

  const extractExitCode = runExtractCommand(withStepReport(options, "extract"), logger);
  if (extractExitCode !== 0) {
    return extractExitCode;
  }

  return runReplaceCommand(withStepReport(options, "replace"), logger);
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

function deriveStepReportFile(reportFile: string, step: "scan" | "extract" | "replace"): string {
  const suffix = `.${step}.json`;

  if (reportFile.endsWith(".json")) {
    return reportFile.replace(/\.json$/i, suffix);
  }

  return `${reportFile}${suffix}`;
}

function warnIfGitWorkspaceDirty(targetDir: string, logger: Logger): void {
  const gitRootResult = spawnSync("git", ["rev-parse", "--show-toplevel"], {
    cwd: targetDir,
    encoding: "utf8"
  });

  if (gitRootResult.status !== 0) {
    logger.debug("apply safety check skipped: current directory is not inside a Git repository.");
    return;
  }

  const gitRoot = gitRootResult.stdout.trim();
  const statusResult = spawnSync("git", ["status", "--porcelain"], {
    cwd: gitRoot,
    encoding: "utf8"
  });

  if (statusResult.status !== 0) {
    logger.debug("apply safety check skipped: unable to read Git status.");
    return;
  }

  const dirtyLines = statusResult.stdout
    .split("\n")
    .map((line) => line.trimEnd())
    .filter(Boolean);

  if (dirtyLines.length === 0) {
    logger.debug("apply safety check: Git working tree is clean.");
    return;
  }

  logger.error("Warning: Git working tree is not clean. Apply will continue, but review or commit changes first.");
  logger.error(`Warning: Repository root: ${gitRoot}`);
  logger.error(`Warning: Uncommitted entries: ${dirtyLines.length}`);

  for (const line of dirtyLines.slice(0, 5)) {
    logger.error(`Warning:   ${line}`);
  }

  if (dirtyLines.length > 5) {
    logger.error(`Warning:   ... and ${dirtyLines.length - 5} more`);
  }

  // Future extension point: export a patch before apply when stricter safety is needed.
}
