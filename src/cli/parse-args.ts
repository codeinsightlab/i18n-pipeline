import path from "node:path";
import type { CommandOptions } from "../core/types.js";

export type CommandName = "scan" | "extract" | "replace" | "run" | "apply" | "report" | "init-script-rules" | "init";

export interface ParsedCliArgs {
  command?: CommandName;
  options: CommandOptions;
  initOutFile?: string;
  showHelp: boolean;
  showVersion: boolean;
  missingCommand: boolean;
}

export class CliUsageError extends Error {}

export function parseCliArgs(argv: string[]): ParsedCliArgs {
  const [maybeCommand, ...restArgs] = argv;

  if (maybeCommand === "--help" || maybeCommand === "-h") {
    return buildParsedArgs(undefined, restArgs, true, false);
  }

  if (maybeCommand === "--version" || maybeCommand === "-v") {
    return buildParsedArgs(undefined, restArgs, false, true);
  }

  if (!maybeCommand) {
    return buildParsedArgs(undefined, restArgs, true, false);
  }

  if (!isCommandName(maybeCommand)) {
    throw new CliUsageError(`Unknown command: ${maybeCommand}.`);
  }

  const showHelp = restArgs.includes("--help") || restArgs.includes("-h");
  const showVersion = restArgs.includes("--version") || restArgs.includes("-v");

  return buildParsedArgs(maybeCommand, restArgs, showHelp, showVersion);
}

function buildParsedArgs(
  command: CommandName | undefined,
  args: string[],
  showHelp: boolean,
  showVersion: boolean
): ParsedCliArgs {
  validateArgs(args);
  const positionalArgs = collectPositionalArgs(args);

  const targetDir = readFlagValue(args, "--dir") ?? process.cwd();
  const outputFile = readFlagValue(args, "--output") ?? path.resolve(process.cwd(), "i18n/zh.json");
  const reportFile = readFlagValue(args, "--report");
  const reportSourceFile = readFlagValue(args, "--report-source");
  const scriptRulesFile = readFlagValue(args, "--script-rules");
  const initOutFile = readFlagValue(args, "--out") ?? (isInitCommand(command) ? positionalArgs[0] : undefined);
  const resourceStructure = readFlagValue(args, "--structure") ?? "module-dir";
  const extractMode = readFlagValue(args, "--mode") ?? "merge";
  const gitCheck = readFlagValue(args, "--git-check") ?? "warn";

  if (isInitCommand(command) && positionalArgs.length > 1) {
    throw new CliUsageError("init accepts at most one positional path.");
  }

  if (!isInitCommand(command) && positionalArgs.length > 0) {
    throw new CliUsageError(`Unexpected positional argument: ${positionalArgs[0]}.`);
  }

  if (!isResourceStructure(resourceStructure)) {
    throw new CliUsageError(`Invalid --structure value: ${resourceStructure}. Use single or module-dir.`);
  }

  if (!isExtractMode(extractMode)) {
    throw new CliUsageError(`Invalid --mode value: ${extractMode}. Use overwrite, merge, or clean.`);
  }

  const normalizedExtractMode = normalizeExtractMode(extractMode);

  if (!isGitCheckMode(gitCheck)) {
    throw new CliUsageError(`Invalid --git-check value: ${gitCheck}. Use warn, strict, or off.`);
  }

  return {
    command,
    initOutFile: initOutFile ? path.resolve(initOutFile) : undefined,
    showHelp,
    showVersion,
    missingCommand: !command && !showHelp && !showVersion,
    options: {
      targetDir: path.resolve(targetDir),
      outputFile: path.resolve(outputFile),
      dryRun: args.includes("--dry-run"),
      debug: args.includes("--debug"),
      writeResources: true,
      resourceStructure,
      extractMode: normalizedExtractMode,
      gitCheck,
      explicitConfig: {
        resourceStructure: args.includes("--structure"),
        extractMode: args.includes("--mode"),
        gitCheck: args.includes("--git-check")
      },
      scriptRulesFile: scriptRulesFile ? path.resolve(scriptRulesFile) : undefined,
      reportFile: reportFile ? path.resolve(reportFile) : undefined,
      reportSourceFile: reportSourceFile ? path.resolve(reportSourceFile) : undefined
    }
  };
}

function validateArgs(args: string[]): void {
  const valuedFlags = ["--dir", "--output", "--report", "--report-source", "--structure", "--mode", "--git-check", "--script-rules", "--out"];
  const allowedFlags = new Set([
    "--dir",
    "--output",
    "--report",
    "--report-source",
    "--structure",
    "--mode",
    "--git-check",
    "--script-rules",
    "--out",
    "--dry-run",
    "--debug",
    "--help",
    "-h",
    "--version",
    "-v"
  ]);

  for (const flag of valuedFlags) {
    const index = args.indexOf(flag);

    if (index !== -1 && (index === args.length - 1 || args[index + 1].startsWith("--"))) {
      throw new CliUsageError(`Missing value for ${flag}.`);
    }
  }

  for (const arg of args) {
    if (arg.startsWith("-") && !allowedFlags.has(arg)) {
      throw new CliUsageError(`Unknown flag: ${arg}.`);
    }
  }
}

function readFlagValue(args: string[], flag: string): string | undefined {
  const index = args.indexOf(flag);

  if (index === -1) {
    return undefined;
  }

  return args[index + 1];
}

function isCommandName(value: string): value is CommandName {
  return value === "scan" || value === "extract" || value === "replace" || value === "run" || value === "apply" || value === "report" || value === "init-script-rules" || value === "init";
}

function isExtractMode(value: string): value is CommandOptions["extractMode"] {
  return value === "overwrite" || value === "merge" || value === "clean";
}

function normalizeExtractMode(value: CommandOptions["extractMode"]): CommandOptions["extractMode"] {
  return value === "overwrite" ? "merge" : value;
}

function isResourceStructure(value: string): value is CommandOptions["resourceStructure"] {
  return value === "single" || value === "module-dir";
}

function isGitCheckMode(value: string): value is CommandOptions["gitCheck"] {
  return value === "warn" || value === "strict" || value === "off";
}

export function ensureDirProvided(argv: string[]): void {
  const [maybeCommand, ...restArgs] = argv;

  if (!maybeCommand || maybeCommand.startsWith("-")) {
    return;
  }

  if (!isCommandName(maybeCommand)) {
    return;
  }

  if (maybeCommand === "init-script-rules" || maybeCommand === "init") {
    return;
  }

  if (restArgs.includes("--help") || restArgs.includes("-h") || restArgs.includes("--version") || restArgs.includes("-v")) {
    return;
  }

  if (!restArgs.includes("--dir")) {
    throw new CliUsageError("Missing required --dir <path>.");
  }
}

function isInitCommand(command: CommandName | undefined): boolean {
  return command === "init-script-rules" || command === "init";
}

function collectPositionalArgs(args: string[]): string[] {
  const valuedFlags = new Set(["--dir", "--output", "--report", "--report-source", "--structure", "--mode", "--git-check", "--script-rules", "--out"]);
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (valuedFlags.has(token)) {
      index += 1;
      continue;
    }

    if (!token.startsWith("-")) {
      positional.push(token);
    }
  }

  return positional;
}
