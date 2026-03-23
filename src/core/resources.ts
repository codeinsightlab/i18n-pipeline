import fs from "node:fs";
import path from "node:path";
import { ensureParentDir } from "./files.js";
import { parseAutoKey } from "./keygen.js";
import type { CommandOptions } from "./types.js";

const RESOURCE_FILE_NAME = "zh.json";

export function loadResourceMap(
  outputFile: string,
  structure: CommandOptions["resourceStructure"]
): Map<string, string> {
  if (structure === "single") {
    return loadSingleResourceFile(outputFile);
  }

  const rootDir = path.dirname(outputFile);
  const resourceFiles = listModuleResourceFiles(rootDir);
  const resources = new Map<string, string>();

  for (const filePath of resourceFiles) {
    for (const [key, text] of loadSingleResourceFile(filePath)) {
      resources.set(key, text);
    }
  }

  return resources;
}

export function writeResourceMap(
  outputFile: string,
  structure: CommandOptions["resourceStructure"],
  resources: Map<string, string>,
  touchedModulePrefixes: string[] = [],
  previousResources: Map<string, string> = new Map(),
  options: { allowDeleteTouched?: boolean } = {}
): string[] {
  if (structure === "single") {
    const content = `${JSON.stringify(toSortedRecord(resources), null, 2)}\n`;
    if (fs.existsSync(outputFile) && fs.readFileSync(outputFile, "utf8") === content) {
      return [];
    }
    ensureParentDir(outputFile);
    fs.writeFileSync(outputFile, content, "utf8");
    return [outputFile];
  }

  const groupedCurrent = groupResourcesByFile(resources, outputFile);
  const touchedFiles = new Set(
    touchedModulePrefixes.map((modulePrefix) => modulePrefixToResourceFile(modulePrefix, outputFile))
  );
  const previousFiles = new Set(
    [...groupResourcesByFile(previousResources, outputFile).keys()]
  );
  const changedFiles = new Set<string>();

  for (const [filePath, fileResources] of groupedCurrent) {
    const content = `${JSON.stringify(toSortedRecord(fileResources), null, 2)}\n`;
    if (fs.existsSync(filePath) && fs.readFileSync(filePath, "utf8") === content) {
      continue;
    }
    ensureParentDir(filePath);
    fs.writeFileSync(filePath, content, "utf8");
    changedFiles.add(filePath);
  }

  if (!options.allowDeleteTouched) {
    return [...changedFiles].sort();
  }

  for (const filePath of touchedFiles) {
    if (groupedCurrent.has(filePath)) {
      continue;
    }

    if (previousFiles.has(filePath) && fs.existsSync(filePath)) {
      fs.unlinkSync(filePath);
      changedFiles.add(filePath);
    }
  }

  return [...changedFiles].sort();
}

export function modulePrefixToResourceFile(modulePrefix: string, outputFile: string): string {
  return path.join(path.dirname(outputFile), ...modulePrefix.split("."), RESOURCE_FILE_NAME);
}

export function keyToResourceFile(
  key: string,
  outputFile: string,
  structure: CommandOptions["resourceStructure"]
): string {
  if (structure === "single") {
    return outputFile;
  }

  const parsed = parseAutoKey(key);
  return parsed ? modulePrefixToResourceFile(parsed.modulePrefix, outputFile) : outputFile;
}

function loadSingleResourceFile(filePath: string): Map<string, string> {
  if (!fs.existsSync(filePath)) {
    return new Map();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as Record<string, string>;
    return new Map(Object.entries(parsed));
  } catch {
    return new Map();
  }
}

function listModuleResourceFiles(rootDir: string): string[] {
  if (!fs.existsSync(rootDir)) {
    return [];
  }

  const files: string[] = [];
  walk(rootDir, files);
  return files.sort();
}

function walk(currentDir: string, files: string[]): void {
  for (const entry of fs.readdirSync(currentDir, { withFileTypes: true })) {
    const nextPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      walk(nextPath, files);
      continue;
    }

    if (entry.isFile() && entry.name === RESOURCE_FILE_NAME) {
      files.push(nextPath);
    }
  }
}

function groupResourcesByFile(resources: Map<string, string>, outputFile: string): Map<string, Map<string, string>> {
  const grouped = new Map<string, Map<string, string>>();

  for (const [key, text] of resources) {
    const filePath = keyToResourceFile(key, outputFile, "module-dir");
    const fileResources = grouped.get(filePath) ?? new Map<string, string>();
    fileResources.set(key, text);
    grouped.set(filePath, fileResources);
  }

  return grouped;
}

function toSortedRecord(resources: Map<string, string>): Record<string, string> {
  return Object.fromEntries(
    [...resources.entries()].sort(([left], [right]) => left.localeCompare(right))
  );
}
