import fs from "node:fs";
import path from "node:path";
import type { Logger } from "../cli/logger.js";
import { toDisplayPath } from "../core/display-path.js";
import { ensureParentDir } from "../core/files.js";
import { renderScriptRulesTemplateWithComments } from "../core/script-rules.js";

export function runInitScriptRulesCommand(outFile: string | undefined, logger: Logger): number {
  const targetFile = resolveInitOutFile(outFile);
  ensureParentDir(targetFile);
  fs.writeFileSync(targetFile, renderScriptRulesTemplateWithComments(), "utf8");
  logger.info(`Script rules template written to ${toDisplayPath(targetFile)}.`);
  return 0;
}

function resolveInitOutFile(outFile: string | undefined): string {
  if (!outFile) {
    return path.resolve(process.cwd(), "i18n/script-rules.json");
  }

  const resolved = path.resolve(outFile);

  if (fs.existsSync(resolved) && fs.statSync(resolved).isDirectory()) {
    return path.join(resolved, "i18n/script-rules.json");
  }

  if (resolved.endsWith(path.sep)) {
    return path.join(resolved, "i18n/script-rules.json");
  }

  if (path.extname(resolved).toLowerCase() !== ".json") {
    return path.join(resolved, "i18n/script-rules.json");
  }

  return resolved;
}
