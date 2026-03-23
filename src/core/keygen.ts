import path from "node:path";

const DEFAULT_MODULE_PREFIX = "module";
const FILTERED_SEGMENTS = new Set(["views", "components", "common", "layout", "index"]);

export function generateAutoKey(modulePrefix: string, index: number): string {
  return `${sanitizeModulePrefix(modulePrefix)}.auto_${String(index).padStart(3, "0")}`;
}

export function extractModulePrefix(filePath: string, targetDir: string): string {
  const relativePath = path.relative(targetDir, filePath);
  const normalized = relativePath.split(path.sep).filter(Boolean);
  const srcIndex = normalized.indexOf("src");
  const segmentsAfterSrc = srcIndex >= 0 ? normalized.slice(srcIndex + 1) : normalized;
  const directorySegments = segmentsAfterSrc.slice(0, -1);
  const filtered = directorySegments.filter((segment) => !FILTERED_SEGMENTS.has(segment.toLowerCase()));

  if (filtered.length > 0) {
    return filtered.slice(0, 2).map(sanitizeModulePrefix).join(".");
  }

  if (directorySegments.length > 0) {
    return sanitizeModulePrefix(directorySegments[0]);
  }

  return DEFAULT_MODULE_PREFIX;
}

export function parseAutoKey(key: string): { modulePrefix: string; index: number } | null {
  const match = key.match(/^([a-z0-9_]+)\.auto_(\d+)$/);

  if (!match) {
    return null;
  }

  return {
    modulePrefix: match[1],
    index: Number(match[2])
  };
}

function sanitizeModulePrefix(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || DEFAULT_MODULE_PREFIX;
}
