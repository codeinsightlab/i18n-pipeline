import path from "node:path";

export function toDisplayPath(filePath: string, projectRoot: string = process.cwd()): string {
  if (!filePath) {
    return "";
  }

  const relative = path.isAbsolute(filePath) ? path.relative(projectRoot, filePath) : filePath;
  const normalized = relative.replace(/\\/g, "/");
  return normalized || ".";
}
