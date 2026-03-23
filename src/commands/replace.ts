import type { CommandOptions } from "../core/types.js";
import type { Logger } from "../cli/logger.js";
import { extractEntries } from "../extractor/extract.js";
import { replaceProject } from "../replacer/replace.js";
import { scanProject } from "../scanner/scan.js";
import {
  buildReplaceDetails,
  countSourceFiles,
  createBaseReport,
  readZhJson,
  uniqueStrings,
  writeReport
} from "./shared.js";
import { collectSourceFiles } from "../core/files.js";

export function runReplaceCommand(options: CommandOptions, logger: Logger): number {
  logger.debug(`replace targetDir=${options.targetDir} output=${options.outputFile} dryRun=${String(options.dryRun)}`);

  const matches = scanProject(options.targetDir);
  const existingZh = readZhJson(options.outputFile);
  const entries = extractEntries(matches, existingZh, options.targetDir);
  const report = replaceProject(options.targetDir, entries, options.dryRun);
  const reusedCount = entries.filter((entry) => entry.reused).length;
  const createdCount = entries.length - reusedCount;
  const changedFiles = uniqueStrings(report.changes.map((item) => item.filePath));
  const allFiles = collectSourceFiles(options.targetDir);
  const details = buildReplaceDetails(allFiles, matches, report);

  for (const change of report.changes) {
    logger.info(`${change.filePath.replace(`${process.cwd()}/`, "")}:${change.line}`);
    logger.info(`  - ${change.original}`);
    logger.info(`  + ${change.replacement}`);
  }

  for (const item of report.skipped) {
    logger.info(`${item.filePath.replace(`${process.cwd()}/`, "")}:${item.line}  [skip:${item.reason}] ${item.raw}`);
  }

  logger.info("");
  logger.info(`replaced: ${report.changes.length}`);
  logger.info(`skipped: ${report.skipped.length}`);
  logger.info(`unchanged_files: ${report.unchangedFiles.length}`);

  if (report.skipped.length > 0) {
    logger.info("skipped_reasons:");

    for (const [reason, count] of Object.entries(report.skippedByReason)) {
      logger.info(`  ${reason}: ${count}`);
    }
  }

  logger.info(`\n${options.dryRun ? "Planned" : "Applied"} ${report.changes.length} replacement(s).`);
  writeReport(createBaseReport("replace", options, {
    filesScanned: countSourceFiles(options.targetDir),
    candidatesFound: matches.length,
    replacedCount: report.changes.length,
    skippedCount: report.skipped.length,
    skippedReasons: report.skippedByReason,
    changedFiles,
    unchangedFiles: report.unchangedFiles,
    keyReusedCount: reusedCount,
    keyCreatedCount: createdCount
  }, details), options.reportFile);

  return 0;
}
