import fs from "node:fs";
import path from "node:path";
import type { SupportedFileExtension } from "./types.js";

const SUPPORTED_EXTENSIONS: SupportedFileExtension[] = [".js", ".ts", ".jsx", ".tsx", ".vue"];
const IGNORED_DIRS = new Set(["node_modules", ".git", "dist", "output"]);

export function isSupportedFile(filePath: string): boolean {
  return SUPPORTED_EXTENSIONS.some((extension) => filePath.endsWith(extension));
}

export function collectSourceFiles(targetDir: string): string[] {
  const absoluteDir = path.resolve(targetDir);
  const results: string[] = [];

  walkDirectory(absoluteDir, results);

  return results.sort();
}

function walkDirectory(currentDir: string, results: string[]): void {
  const entries = fs.readdirSync(currentDir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(currentDir, entry.name);

    if (entry.isDirectory()) {
      if (!IGNORED_DIRS.has(entry.name)) {
        walkDirectory(fullPath, results);
      }

      continue;
    }

    if (entry.isFile() && isSupportedFile(fullPath)) {
      results.push(fullPath);
    }
  }
}

export function ensureParentDir(filePath: string): void {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
}
