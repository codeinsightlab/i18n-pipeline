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
  validateArgs(args, command);
  const positionalArgs = collectPositionalArgs(args);

  const targetDir = readFlagValue(args, "--dir") ?? process.cwd();
  const resourceStructure = readFlagValue(args, "--structure") ?? "module-dir";
  const extractMode = readFlagValue(args, "--mode") ?? "merge";
  const gitCheck = readFlagValue(args, "--git-check") ?? "warn";
  const outputFile = readFlagValue(args, "--output") ?? defaultOutputPath(resourceStructure);
  const report = readOptionalPathFlag(args, "--report");
  const reportJson = readOptionalPathFlag(args, "--report-json");
  const reportSourceFile = readFlagValue(args, "--report-source");
  const scriptRulesFile = readFlagValue(args, "--script-rules");
  const initOutFile = readFlagValue(args, "--out") ?? (isInitCommand(command) ? positionalArgs[0] : undefined);

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

  const resolvedReports = resolveReportOptions(command, report, reportJson);

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
      reportFile: resolvedReports.reportFile ? path.resolve(resolvedReports.reportFile) : undefined,
      reportHtmlFile: resolvedReports.reportHtmlFile ? path.resolve(resolvedReports.reportHtmlFile) : undefined,
      keepReportJson: resolvedReports.keepReportJson,
      reportSourceFile: reportSourceFile ? path.resolve(reportSourceFile) : undefined
    }
  };
}

function defaultOutputPath(structure: string): string {
  if (structure === "module-dir") {
    return path.resolve(process.cwd(), "i18n");
  }

  return path.resolve(process.cwd(), "i18n/zh.json");
}

function defaultReportPath(command: CommandName | undefined): string | undefined {
  if (command !== "report") {
    return undefined;
  }

  return path.resolve(process.cwd(), "i18n-report.html");
}

function validateArgs(args: string[], command: CommandName | undefined): void {
  const valuedFlags = ["--dir", "--output", "--report-source", "--structure", "--mode", "--git-check", "--script-rules", "--out"];
  const allowedFlags = new Set([
    "--dir",
    "--output",
    "--report",
    "--report-json",
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

  // Legacy step commands keep explicit --report <file> to avoid accidental writes.
  if ((command === "scan" || command === "extract" || command === "replace") && args.includes("--report")) {
    const report = readOptionalPathFlag(args, "--report");
    if (!report.value) {
      throw new CliUsageError("Missing value for --report.");
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

function readOptionalPathFlag(args: string[], flag: string): { present: boolean; value?: string } {
  const index = args.indexOf(flag);

  if (index === -1) {
    return { present: false };
  }

  const next = args[index + 1];
  if (!next || next.startsWith("-")) {
    return { present: true };
  }

  return { present: true, value: next };
}

function resolveReportOptions(
  command: CommandName | undefined,
  report: { present: boolean; value?: string },
  reportJson: { present: boolean; value?: string }
): { reportFile?: string; reportHtmlFile?: string; keepReportJson: boolean } {
  const defaultHtml = path.resolve(process.cwd(), "i18n-report.html");
  const defaultJson = path.resolve(process.cwd(), "i18n-report.json");

  if (command === "report") {
    const reportFile = report.present
      ? path.resolve(report.value ?? defaultHtml)
      : defaultReportPath(command);
    return {
      reportFile,
      keepReportJson: true
    };
  }

  if (command === "run" || command === "apply") {
    let reportHtmlFile: string | undefined;
    let reportFile: string | undefined;
    let keepReportJson = false;

    if (report.present) {
      const reportValue = path.resolve(report.value ?? defaultHtml);
      if (report.value && reportValue.toLowerCase().endsWith(".json") && !reportJson.present) {
        // Backward compatibility: old `--report <json>` keeps JSON-only behavior.
        reportFile = reportValue;
        keepReportJson = true;
      } else {
        reportHtmlFile = reportValue;
      }
    }

    if (reportJson.present) {
      reportFile = path.resolve(reportJson.value ?? defaultJson);
      keepReportJson = true;
    }

    return {
      reportFile,
      reportHtmlFile,
      keepReportJson
    };
  }

  if (command === "scan" || command === "extract" || command === "replace") {
    const reportFile = report.value ? path.resolve(report.value) : undefined;
    return {
      reportFile,
      keepReportJson: Boolean(reportFile)
    };
  }

  return {
    keepReportJson: false
  };
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

function isInitCommand(command: CommandName | undefined): boolean {
  return command === "init-script-rules" || command === "init";
}

function collectPositionalArgs(args: string[]): string[] {
  const valuedFlags = new Set(["--dir", "--output", "--report-source", "--structure", "--mode", "--git-check", "--script-rules", "--out"]);
  const positional: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const token = args[index];

    if (token === "--report" || token === "--report-json") {
      const next = args[index + 1];
      if (next && !next.startsWith("-")) {
        index += 1;
      }
      continue;
    }

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
