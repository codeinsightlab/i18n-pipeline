#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import {
  EXIT_CODE_RUNTIME_ERROR,
  EXIT_CODE_SUCCESS,
  EXIT_CODE_USAGE_ERROR
} from "../core/exit-codes.js";
import { runApplyCommand, runRunCommand } from "../commands/run.js";
import { runExtractCommand } from "../commands/extract.js";
import { runInitScriptRulesCommand } from "../commands/init-script-rules.js";
import { runReportCommand } from "../commands/report.js";
import { runReplaceCommand } from "../commands/replace.js";
import { runScanCommand } from "../commands/scan.js";
import { formatHelp } from "./help.js";
import { createLogger } from "./logger.js";
import { CliUsageError, ensureDirProvided, parseCliArgs } from "./parse-args.js";

async function main(): Promise<void> {
  const [, , ...argv] = process.argv;

  try {
    const parsed = parseCliArgs(argv);
    const version = readVersion();

    if (parsed.showVersion) {
      console.log(version);
      process.exitCode = EXIT_CODE_SUCCESS;
      return;
    }

    if (parsed.showHelp || !parsed.command) {
      console.log(formatHelp(version));
      process.exitCode = parsed.missingCommand ? EXIT_CODE_USAGE_ERROR : EXIT_CODE_SUCCESS;
      return;
    }

    ensureDirProvided(argv);

    const logger = createLogger(parsed.options.debug);
    logger.debug(`command=${parsed.command}`);

    switch (parsed.command) {
      case "scan":
        process.exitCode = runScanCommand(parsed.options, logger);
        return;
      case "extract":
        process.exitCode = runExtractCommand(parsed.options, logger);
        return;
      case "replace":
        process.exitCode = runReplaceCommand(parsed.options, logger);
        return;
      case "run":
        process.exitCode = runRunCommand(parsed.options, logger);
        return;
      case "apply":
        process.exitCode = runApplyCommand(parsed.options, logger);
        return;
      case "report":
        process.exitCode = runReportCommand(parsed.options, logger);
        return;
      case "init-script-rules":
      case "init":
        process.exitCode = runInitScriptRulesCommand(parsed.initOutFile, logger);
        return;
    }
  } catch (error) {
    if (error instanceof CliUsageError) {
      console.error(error.message);
      console.error("");
      console.error(formatHelp(readVersion()));
      process.exitCode = EXIT_CODE_USAGE_ERROR;
      return;
    }

    const message = error instanceof Error ? error.message : "Unexpected runtime error.";
    console.error(message);
    process.exitCode = EXIT_CODE_RUNTIME_ERROR;
  }
}

function readVersion(): string {
  const packageJsonPath = path.resolve(process.cwd(), "package.json");

  try {
    const packageJson = JSON.parse(fs.readFileSync(packageJsonPath, "utf8")) as { version?: string };
    return packageJson.version ?? "0.0.0";
  } catch {
    return "0.0.0";
  }
}

main();
