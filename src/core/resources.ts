import fs from "node:fs";
import path from "node:path";
import { ensureParentDir } from "./files.js";
import { parseModuleScopedKey } from "./keygen.js";
import type { CommandOptions } from "./types.js";

const RESOURCE_FILE_NAME = "zh.json";

export function loadResourceMap(
  outputFile: string,
  structure: CommandOptions["resourceStructure"]
): Map<string, string> {
  if (structure === "single") {
    return loadSingleResourceFile(outputFile);
  }

  const rootDir = resolveModuleResourceRoot(outputFile);
  const resourceFiles = listModuleResourceFiles(rootDir);
  const resources = new Map<string, string>();

  for (const filePath of resourceFiles) {
    const modulePrefix = resourceFileToModulePrefix(filePath, outputFile);
    for (const [key, text] of loadModuleResourceFile(filePath, modulePrefix)) {
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
    const content = `${JSON.stringify(toModuleNestedRecord(fileResources, filePath, outputFile), null, 2)}\n`;
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
  return path.join(resolveModuleResourceRoot(outputFile), ...modulePrefix.split("."), RESOURCE_FILE_NAME);
}

export function keyToResourceFile(
  key: string,
  outputFile: string,
  structure: CommandOptions["resourceStructure"]
): string {
  if (structure === "single") {
    return outputFile;
  }

  const parsed = parseModuleScopedKey(key);
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

function loadModuleResourceFile(filePath: string, modulePrefix: string | null): Map<string, string> {
  if (!fs.existsSync(filePath)) {
    return new Map();
  }

  try {
    const parsed = JSON.parse(fs.readFileSync(filePath, "utf8")) as unknown;
    const flattened = flattenModuleValue(parsed, modulePrefix ?? "", [], filePath);
    return new Map(flattened);
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

function toModuleNestedRecord(
  resources: Map<string, string>,
  filePath: string,
  outputFile: string
): Record<string, unknown> {
  const modulePrefix = resourceFileToModulePrefix(filePath, outputFile);
  const root: Record<string, unknown> = {};
  const sortedEntries = [...resources.entries()].sort(([left], [right]) => left.localeCompare(right));

  for (const [fullKey, value] of sortedEntries) {
    const relativeKey = modulePrefix && fullKey.startsWith(`${modulePrefix}.`)
      ? fullKey.slice(modulePrefix.length + 1)
      : fullKey;
    const segments = relativeKey.split(".").filter(Boolean);

    if (segments.length === 0) {
      throw new Error(`Invalid module key "${fullKey}" for ${filePath}`);
    }

    setNestedValue(root, segments, value, filePath, fullKey);
  }

  return sortNestedObject(root) as Record<string, unknown>;
}

function setNestedValue(
  root: Record<string, unknown>,
  segments: string[],
  value: string,
  filePath: string,
  fullKey: string
): void {
  let cursor: Record<string, unknown> = root;

  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index];
    const isLeaf = index === segments.length - 1;
    const current = cursor[segment];

    if (isLeaf) {
      if (current !== undefined && typeof current === "object" && current !== null) {
        throw new Error(`Resource path conflict at ${filePath}: "${fullKey}" collides with existing object node`);
      }
      cursor[segment] = value;
      return;
    }

    if (current === undefined) {
      const next: Record<string, unknown> = {};
      cursor[segment] = next;
      cursor = next;
      continue;
    }

    if (typeof current !== "object" || current === null || Array.isArray(current)) {
      throw new Error(`Resource path conflict at ${filePath}: "${fullKey}" collides with existing leaf node`);
    }

    cursor = current as Record<string, unknown>;
  }
}

function sortNestedObject(value: unknown): unknown {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return value;
  }

  const entries = Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, child]) => [key, sortNestedObject(child)] as const);

  return Object.fromEntries(entries);
}

function flattenModuleValue(
  value: unknown,
  modulePrefix: string,
  segments: string[],
  filePath: string
): Array<[string, string]> {
  if (typeof value === "string") {
    const relative = segments.join(".");
    if (!relative) {
      throw new Error(`Invalid module resource shape in ${filePath}: root cannot be string`);
    }
    return [[joinModuleAndRelative(modulePrefix, relative), value]];
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`Invalid module resource shape in ${filePath}: expected object tree`);
  }

  const entries: Array<[string, string]> = [];
  for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
    const nextSegments = [...segments, key];
    entries.push(...flattenModuleValue(child, modulePrefix, nextSegments, filePath));
  }
  return entries;
}

function joinModuleAndRelative(modulePrefix: string, relativeKey: string): string {
  return modulePrefix ? `${modulePrefix}.${relativeKey}` : relativeKey;
}

function resourceFileToModulePrefix(filePath: string, outputFile: string): string | null {
  const rootDir = resolveModuleResourceRoot(outputFile);
  const relativePath = path.relative(rootDir, filePath);
  const normalized = relativePath.split(path.sep).filter(Boolean);

  if (normalized.length <= 1) {
    return null;
  }

  const segments = normalized.slice(0, -1);
  return segments.join(".");
}

function resolveModuleResourceRoot(outputFile: string): string {
  const normalized = outputFile.replace(/\\/g, "/");
  return normalized.endsWith(`/${RESOURCE_FILE_NAME}`) ? path.dirname(outputFile) : outputFile;
}
