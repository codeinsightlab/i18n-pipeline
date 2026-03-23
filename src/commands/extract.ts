import fs from "node:fs";
import path from "node:path";
import { collectSourceFiles, ensureParentDir } from "../core/files.js";
import type { CommandOptions } from "../core/types.js";
import type { Logger } from "../cli/logger.js";
import { extractEntries, toZhJson } from "../extractor/extract.js";
import { scanProject } from "../scanner/scan.js";
import { buildScanDetails, countSourceFiles, createBaseReport, readZhJson, writeReport } from "./shared.js";

export function runExtractCommand(options: CommandOptions, logger: Logger): number {
  logger.debug(`extract targetDir=${options.targetDir} output=${options.outputFile} mode=${options.extractMode}`);

  const matches = scanProject(options.targetDir);
  const existingZh = options.extractMode === "clean" ? {} : readZhJson(options.outputFile);
  const entries = extractEntries(matches, existingZh, options.targetDir);
  const overwriteZh = toZhJson(entries);
  const zhJson = options.extractMode === "merge"
    ? mergeWithUnmatchedKeys(overwriteZh, existingZh)
    : overwriteZh;
  const reusedCount = entries.filter((entry) => entry.reused).length;
  const createdCount = entries.length - reusedCount;
  const filesScanned = countSourceFiles(options.targetDir);
  const scannedFiles = collectSourceFiles(options.targetDir);
  const details = buildScanDetails(scannedFiles, matches);

  ensureParentDir(options.outputFile);
  fs.writeFileSync(options.outputFile, `${JSON.stringify(zhJson, null, 2)}\n`, "utf8");

  logger.info(`Generated ${path.relative(process.cwd(), options.outputFile)} with ${Object.keys(zhJson).length} key(s).`);
  writeReport(createBaseReport("extract", options, {
    filesScanned,
    candidatesFound: matches.length,
    replacedCount: 0,
    skippedCount: 0,
    skippedReasons: {},
    changedFiles: [options.outputFile],
    unchangedFiles: scannedFiles,
    keyReusedCount: reusedCount,
    keyCreatedCount: createdCount
  }, details), options.reportFile);

  return 0;
}

function mergeWithUnmatchedKeys(currentZh: Record<string, string>, existingZh: Record<string, string>): Record<string, string> {
  const merged = { ...currentZh };
  const currentTexts = new Set(Object.values(currentZh));

  for (const [key, text] of Object.entries(existingZh)) {
    if (!currentTexts.has(text)) {
      merged[key] = text;
    }
  }

  return merged;
}
