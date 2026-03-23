import path from "node:path";
import type { CommandOptions } from "../core/types.js";

export type CommandName = "scan" | "extract" | "replace" | "run" | "apply";

export interface ParsedCliArgs {
  command?: CommandName;
  options: CommandOptions;
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

  const targetDir = readFlagValue(args, "--dir") ?? process.cwd();
  const outputFile = readFlagValue(args, "--output") ?? path.resolve(process.cwd(), "i18n/zh.json");
  const reportFile = readFlagValue(args, "--report");
  const resourceStructure = readFlagValue(args, "--structure") ?? "single";
  const extractMode = readFlagValue(args, "--mode") ?? "merge";
  const gitCheck = readFlagValue(args, "--git-check") ?? "warn";

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
      reportFile: reportFile ? path.resolve(reportFile) : undefined
    }
  };
}

function validateArgs(args: string[]): void {
  const valuedFlags = ["--dir", "--output", "--report", "--structure", "--mode", "--git-check"];
  const allowedFlags = new Set([
    "--dir",
    "--output",
    "--report",
    "--structure",
    "--mode",
    "--git-check",
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
  return value === "scan" || value === "extract" || value === "replace" || value === "run" || value === "apply";
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

  if (restArgs.includes("--help") || restArgs.includes("-h") || restArgs.includes("--version") || restArgs.includes("-v")) {
    return;
  }

  if (!restArgs.includes("--dir")) {
    throw new CliUsageError("Missing required --dir <path>.");
  }
}
