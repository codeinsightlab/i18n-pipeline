import type { Logger } from "../cli/logger.js";
import { loadScriptRulesFromFile } from "../core/script-rules.js";
import type { CommandOptions, ScriptRule } from "../core/types.js";

export function resolveScriptRules(options: CommandOptions, logger: Logger): ScriptRule[] {
  if (!options.scriptRulesFile) {
    logger.debug("script rules: disabled (no --script-rules provided).");
    return [];
  }

  const rules = loadScriptRulesFromFile(options.scriptRulesFile);
  logger.debug(`script rules: loaded ${rules.length} rule(s) from ${options.scriptRulesFile}`);
  return rules;
}
