import { collectSourceFiles } from "../core/files.js";
import type { CommandOptions } from "../core/types.js";
import type { Logger } from "../cli/logger.js";
import { scanProject } from "../scanner/scan.js";
import { buildScanDetails, countSourceFiles, createBaseReport, writeReport } from "./shared.js";

export function runScanCommand(options: CommandOptions, logger: Logger): number {
  logger.debug(`scan targetDir=${options.targetDir}`);

  const matches = scanProject(options.targetDir);
  const filesScanned = countSourceFiles(options.targetDir);
  const allFiles = collectSourceFiles(options.targetDir);
  const details = buildScanDetails(allFiles, matches);

  const report = createBaseReport("scan", options, {
    filesScanned,
    candidatesFound: matches.length,
    replacedCount: 0,
    skippedCount: 0,
    skippedReasons: {},
    changedFiles: [],
    unchangedFiles: allFiles,
    keyReusedCount: 0,
    keyCreatedCount: 0
  }, details);

  if (matches.length === 0) {
    logger.info("No Chinese string literals found.");
    writeReport(report, options.reportFile);
    return 0;
  }

  for (const match of matches) {
    logger.info(`${match.filePath.replace(`${process.cwd()}/`, "")}:${match.line}:${match.column}  ${match.text}`);
  }

  logger.info("");
  logger.info("scan_count:");
  logger.info(`  files_scanned: ${filesScanned}`);
  logger.info(`  candidates_found: ${matches.length}`);
  writeReport(report, options.reportFile);
  return 0;
}
