import fs from "node:fs";
import { collectSourceFiles } from "../core/files.js";
import { toDisplayPath } from "../core/display-path.js";
import type { CommandOptions } from "../core/types.js";
import type { Logger } from "../cli/logger.js";
import { extractEntries, toResourceMap } from "../extractor/extract.js";
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
import { extractModulePrefix, parseModuleScopedKey } from "../core/keygen.js";
import { loadResourceMap, writeResourceMap } from "../core/resources.js";

export function runExtractCommand(options: CommandOptions, logger: Logger): number {
  const effectiveMode = normalizeExtractMode(options.extractMode);
  logger.debug(
    `extract targetDir=${options.targetDir} output=${options.outputFile} mode=${options.extractMode} effectiveMode=${effectiveMode} structure=${options.resourceStructure} writeResources=${String(options.writeResources !== false)}`
  );

  const scriptRules = resolveScriptRules(options, logger);
  const matches = scanProject(options.targetDir, scriptRules);
  const scannedFiles = collectSourceFiles(options.targetDir);
  const touchedModulePrefixes = collectTouchedModulePrefixes(scannedFiles, options.targetDir);
  const previousResources = loadResourceMap(options.outputFile, options.resourceStructure);
  const reusableResources = effectiveMode === "clean" ? new Map<string, string>() : previousResources;
  const entries = extractEntries(matches, reusableResources, options.targetDir, options.resourceStructure);
  const currentResources = toResourceMap(entries);
  const nextResources = buildNextResourceMap(
    currentResources,
    previousResources,
    touchedModulePrefixes,
    effectiveMode,
    options.resourceStructure
  );
  const reusedCount = entries.filter((entry) => entry.reused).length;
  const createdCount = entries.length - reusedCount;
  const filesScanned = countSourceFiles(options.targetDir);
  const details = buildScanDetails(scannedFiles, matches);
  const shouldWriteResources = options.writeResources !== false;
  const changedFiles = shouldWriteResources
    ? writeResourceMap(
      options.outputFile,
      options.resourceStructure,
      nextResources,
      touchedModulePrefixes,
      previousResources,
      { allowDeleteTouched: effectiveMode === "clean" }
    )
    : [];

  if (shouldWriteResources && changedFiles.length > 0) {
    logger.info(`Generated ${toDisplayPath(options.outputFile)} with ${nextResources.size} key(s).`);
  } else if (shouldWriteResources && matches.length === 0) {
    logger.info("未发现可提取文本。");
    logger.info("未修改资源文件。");
  } else if (shouldWriteResources) {
    logger.info(`Generated ${toDisplayPath(options.outputFile)} with ${nextResources.size} key(s).`);
    logger.info("资源文件内容未发生变化。");
  } else if (matches.length === 0) {
    logger.info("未发现可提取文本。");
    logger.info("未修改资源文件。");
  } else {
    logger.info(`Planned ${nextResources.size} resource key(s).`);
    logger.info("未修改资源文件。");
  }

  writeReport(createBaseReport("extract", options, {
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
    changedFiles: changedFiles.length > 0 ? changedFiles : [],
    unchangedFiles: scannedFiles,
    keyReusedCount: reusedCount,
    keyCreatedCount: createdCount
  }, details), options.reportFile);

  return 0;
}

function buildNextResourceMap(
  currentResources: Map<string, string>,
  previousResources: Map<string, string>,
  touchedModulePrefixes: string[],
  mode: CommandOptions["extractMode"],
  structure: CommandOptions["resourceStructure"]
): Map<string, string> {
  if (mode === "clean") {
    if (structure === "single") {
      return currentResources;
    }

    const touchedModules = new Set(touchedModulePrefixes);
    const nextResources = new Map<string, string>();

    for (const [key, text] of previousResources) {
      const parsed = parseModuleScopedKey(key);
      if (!parsed || !touchedModules.has(parsed.modulePrefix)) {
        nextResources.set(key, text);
      }
    }

    for (const [key, text] of currentResources) {
      nextResources.set(key, text);
    }

    return nextResources;
  }

  if (structure === "single") {
    return mergeSingleResources(currentResources, previousResources);
  }

  const nextResources = new Map(previousResources);

  for (const [key, text] of currentResources) {
    nextResources.set(key, text);
  }

  return nextResources;
}

function mergeSingleResources(
  currentResources: Map<string, string>,
  previousResources: Map<string, string>
): Map<string, string> {
  const merged = new Map(previousResources);

  for (const [key, text] of currentResources) {
    merged.set(key, text);
  }

  return merged;
}

function normalizeExtractMode(mode: CommandOptions["extractMode"]): CommandOptions["extractMode"] {
  if (mode === "clean") {
    return "clean";
  }

  return "merge";
}

function collectTouchedModulePrefixes(files: string[], targetDir: string): string[] {
  const touched = new Set<string>();

  for (const filePath of files) {
    touched.add(extractModulePrefix(filePath, targetDir));
  }

  return [...touched].sort();
}
