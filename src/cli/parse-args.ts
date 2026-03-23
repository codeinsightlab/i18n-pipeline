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
  const extractMode = readFlagValue(args, "--mode") ?? "overwrite";

  if (!isExtractMode(extractMode)) {
    throw new CliUsageError(`Invalid --mode value: ${extractMode}. Use overwrite, merge, or clean.`);
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
      extractMode,
      reportFile: reportFile ? path.resolve(reportFile) : undefined
    }
  };
}

function validateArgs(args: string[]): void {
  const valuedFlags = ["--dir", "--output", "--report", "--mode"];
  const allowedFlags = new Set(["--dir", "--output", "--report", "--mode", "--dry-run", "--debug", "--help", "-h", "--version", "-v"]);

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
