import { collectSourceFiles } from "../core/files.js";
import { toDisplayPath } from "../core/display-path.js";
import type { CommandOptions } from "../core/types.js";
import type { Logger } from "../cli/logger.js";
import { scanProject } from "../scanner/scan.js";
import { resolveScriptRules } from "./script-rules.js";
import {
  buildMatchedRuleDistribution,
  buildScanDetails,
  countExtractableMatches,
  countPolicySkippedMatches,
  countReplaceableMatches,
  countScriptUnsupportedMatches,
  countSourceFiles,
  createBaseReport,
  writeReport
} from "./shared.js";

export function runScanCommand(options: CommandOptions, logger: Logger): number {
  logger.debug(`scan targetDir=${options.targetDir}`);

  const scriptRules = resolveScriptRules(options, logger);
  const matches = scanProject(options.targetDir, scriptRules);
  const filesScanned = countSourceFiles(options.targetDir);
  const allFiles = collectSourceFiles(options.targetDir);
  const details = buildScanDetails(allFiles, matches);

  const report = createBaseReport("scan", options, {
    filesScanned,
    candidatesFound: matches.length,
    replacedCount: 0,
    skippedCount: 0,
    skippedReasons: {},
    extractableCount: countExtractableMatches(matches),
    replaceableCount: countReplaceableMatches(matches),
    policySkippedCount: countPolicySkippedMatches(matches),
    scriptUnsupportedCount: countScriptUnsupportedMatches(matches),
    matchedRuleDistribution: buildMatchedRuleDistribution(matches),
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
    const skipTag = match.skipReason ? ` [skip:${match.skipReason}]` : "";
    logger.info(
      `${toDisplayPath(match.filePath)}:${match.line}:${match.column}  [${match.contextType}]${skipTag} ${match.text}`
    );
  }

  logger.info("");
  logger.info("scan_count:");
  logger.info(`  files_scanned: ${filesScanned}`);
  logger.info(`  candidates_found: ${matches.length}`);
  writeReport(report, options.reportFile);
  return 0;
}
