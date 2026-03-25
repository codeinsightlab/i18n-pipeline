import path from "node:path";

const DEFAULT_MODULE_PREFIX = "module";
const FILTERED_SEGMENTS = new Set(["views", "components", "common", "layout", "index"]);
const ANCHOR_SEGMENTS = [["src", "views"]];
const MAX_MODULE_PATH_SEGMENTS = 3;

export function generateAutoKey(modulePrefix: string, index: number): string {
  return `${sanitizeDottedModulePrefix(modulePrefix)}.auto_${String(index).padStart(3, "0")}`;
}

export function extractModulePrefix(filePath: string, targetDir: string): string {
  // 优先走稳定锚点（src/views/...），使不同 --dir 扫描范围下同一文件得到一致前缀。
  const anchored = extractAnchoredModulePrefix(filePath);

  if (anchored) {
    return anchored;
  }

  const relativePath = path.relative(targetDir, filePath);
  const normalized = relativePath.split(path.sep).filter(Boolean);
  const srcIndex = normalized.indexOf("src");
  const segmentsAfterSrc = srcIndex >= 0 ? normalized.slice(srcIndex + 1) : normalized;
  const directorySegments = segmentsAfterSrc.slice(0, -1);
  const filtered = directorySegments.filter((segment) => !FILTERED_SEGMENTS.has(segment.toLowerCase()));

  if (filtered.length > 0) {
    return filtered.slice(0, MAX_MODULE_PATH_SEGMENTS).map(sanitizeModulePrefix).join(".");
  }

  if (directorySegments.length > 0) {
    return sanitizeModulePrefix(directorySegments[0]);
  }

  // 两级推导都失败时才 fallback 到 module，避免误把“无法归类”写成伪业务前缀。
  return DEFAULT_MODULE_PREFIX;
}

function extractAnchoredModulePrefix(filePath: string): string | null {
  const normalized = path.resolve(filePath).split(path.sep).filter(Boolean);

  for (const anchor of ANCHOR_SEGMENTS) {
    const anchorIndex = findAnchorIndex(normalized, anchor);

    if (anchorIndex < 0) {
      continue;
    }

    const directorySegments = normalized.slice(anchorIndex + anchor.length, -1);
    const filtered = directorySegments.filter((segment) => !FILTERED_SEGMENTS.has(segment.toLowerCase()));

    if (filtered.length > 0) {
      return filtered.slice(0, MAX_MODULE_PATH_SEGMENTS).map(sanitizeModulePrefix).join(".");
    }

    if (directorySegments.length > 0) {
      return sanitizeModulePrefix(directorySegments[0]);
    }
  }

  // 返回 null 代表“锚点不可用”，让上层继续走 targetDir relative 兜底。
  return null;
}

function findAnchorIndex(segments: string[], anchor: string[]): number {
  for (let index = 0; index <= segments.length - anchor.length; index += 1) {
    const matched = anchor.every((segment, offset) => segments[index + offset]?.toLowerCase() === segment);

    if (matched) {
      return index;
    }
  }

  return -1;
}

export function parseAutoKey(key: string): { modulePrefix: string; index: number } | null {
  const match = key.match(/^([a-z0-9_.]+)\.auto_(\d+)$/);

  if (!match) {
    return null;
  }

  return {
    modulePrefix: match[1],
    index: Number(match[2])
  };
}

export function parseModuleScopedKey(key: string): { modulePrefix: string } | null {
  const parsedAuto = parseAutoKey(key);
  if (parsedAuto) {
    return { modulePrefix: parsedAuto.modulePrefix };
  }

  const structured = key.match(/^([a-z0-9_.]+)\.(query|table|form|rules)\.[A-Za-z_$][\w$]*(?:\.(label|placeholder))?$/);
  if (!structured) {
    const generic = key.match(/^([a-z0-9_.]+)\.([A-Za-z_$][\w$]*)$/);
    if (!generic) {
      return null;
    }

    if (!generic[1].includes(".")) {
      return null;
    }

    return { modulePrefix: generic[1] };
  }

  return { modulePrefix: structured[1] };
}

function sanitizeModulePrefix(input: string): string {
  const normalized = input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");

  return normalized || DEFAULT_MODULE_PREFIX;
}

function sanitizeDottedModulePrefix(input: string): string {
  const segments = input
    .split(".")
    .map((segment) => sanitizeModulePrefix(segment))
    .filter(Boolean);

  if (segments.length === 0) {
    return DEFAULT_MODULE_PREFIX;
  }

  return segments.join(".");
}
