import type { CommandOptions } from "../core/types.js";
import type { Logger } from "../cli/logger.js";
import { extractEntries } from "../extractor/extract.js";
import { replaceProject } from "../replacer/replace.js";
import { scanProject } from "../scanner/scan.js";
import {
  buildMatchedRuleDistribution,
  buildReplaceDetails,
  countExtractableMatches,
  countPolicySkippedMatches,
  countReplaceableMatches,
  countScriptUnsupportedMatches,
  countSourceFiles,
  createBaseReport,
  uniqueStrings,
  writeReport
} from "./shared.js";
import { collectSourceFiles } from "../core/files.js";
import { toDisplayPath } from "../core/display-path.js";
import { loadResourceMap } from "../core/resources.js";
import { resolveScriptRules } from "./script-rules.js";

export function runReplaceCommand(options: CommandOptions, logger: Logger): number {
  logger.debug(
    `replace targetDir=${options.targetDir} output=${options.outputFile} dryRun=${String(options.dryRun)} structure=${options.resourceStructure}`
  );

  const scriptRules = resolveScriptRules(options, logger);
  const matches = scanProject(options.targetDir, scriptRules);
  const existingResources = loadResourceMap(options.outputFile, options.resourceStructure);
  const entries = extractEntries(matches, existingResources, options.targetDir, options.resourceStructure);
  const report = replaceProject(options.targetDir, entries, options.dryRun, scriptRules);
  const reusedCount = entries.filter((entry) => entry.reused).length;
  const createdCount = entries.length - reusedCount;
  const changedFiles = uniqueStrings(report.changes.map((item) => item.filePath));
  const allFiles = collectSourceFiles(options.targetDir);
  const details = buildReplaceDetails(allFiles, matches, report);

  for (const change of report.changes) {
    logger.info(`${toDisplayPath(change.filePath)}:${change.line}`);
    logger.info(`  - ${change.original}`);
    logger.info(`  + ${change.replacement}`);
  }

  for (const item of report.skipped) {
    logger.info(`${toDisplayPath(item.filePath)}:${item.line}  [skip:${item.reason}] ${item.raw}`);
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
    extractableCount: countExtractableMatches(matches),
    replaceableCount: countReplaceableMatches(matches),
    policySkippedCount: countPolicySkippedMatches(matches),
    scriptUnsupportedCount: countScriptUnsupportedMatches(matches),
    matchedRuleDistribution: buildMatchedRuleDistribution(matches),
    changedFiles,
    unchangedFiles: report.unchangedFiles,
    keyReusedCount: reusedCount,
    keyCreatedCount: createdCount
  }, details), options.reportFile);

  return 0;
}
