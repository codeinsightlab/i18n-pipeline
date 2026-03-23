import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const workspace = process.cwd();
const cliPath = path.join(workspace, "dist/cli/index.js");

await runBuild();
await testModulePrefixResolver();
testKeyStability();
testExtractModes();
testScanCountOutput();
testCompositeCommands();
testReplaceIdempotency();
testRiskyReport();
testStructuredReports();
testUsageExitCode();

console.log("Regression checks passed.");

function runBuild() {
  execFileSync("npm", ["run", "build"], {
    cwd: workspace,
    stdio: "inherit"
  });
}

async function testModulePrefixResolver() {
  const { extractModulePrefix } = await import("../dist/core/keygen.js");
  const srcRoot = path.join(workspace, "src");

  assert.equal(
    extractModulePrefix(path.join(srcRoot, "plugins/download.js"), srcRoot),
    "plugins"
  );
  assert.equal(
    extractModulePrefix(path.join(srcRoot, "utils/ruoyi.js"), srcRoot),
    "utils"
  );
  assert.equal(
    extractModulePrefix(path.join(srcRoot, "views/system/user/index.vue"), srcRoot),
    "system.user"
  );
  assert.equal(
    extractModulePrefix(path.join(srcRoot, "views/components/dialog/index.vue"), srcRoot),
    "dialog"
  );
}

function testKeyStability() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-stable-"));
  const dirA = path.join(tempDir, "a");
  const dirB = path.join(tempDir, "b");
  const outputA = path.join(tempDir, "a.zh.json");
  const outputB = path.join(tempDir, "b.zh.json");

  fs.mkdirSync(dirA, { recursive: true });
  fs.mkdirSync(dirB, { recursive: true });

  fs.writeFileSync(path.join(dirA, "a.ts"), 'const a = "欢迎登录";\nconst b = "保存";\n', "utf8");
  fs.writeFileSync(path.join(dirA, "b.ts"), 'const c = "继续提交";\n', "utf8");

  fs.writeFileSync(path.join(dirB, "z.ts"), 'const c = "继续提交";\n', "utf8");
  fs.writeFileSync(path.join(dirB, "y.ts"), 'const a = "欢迎登录";\nconst b = "保存";\n', "utf8");

  runCli(["extract", "--dir", dirA, "--output", outputA]);
  runCli(["extract", "--dir", dirB, "--output", outputB]);

  const first = fs.readFileSync(outputA, "utf8");
  const second = fs.readFileSync(outputB, "utf8");

  assert.equal(first, second, "extract should keep keys stable when file order changes");
  assert.match(first, /"module\.auto_001"/);
  assert.match(first, /"module\.auto_002"/);
  assert.match(first, /"module\.auto_003"/);
}

function testExtractModes() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-modes-"));
  const targetDir = path.join(tempDir, "src");
  const outputFile = path.join(tempDir, "i18n/zh.json");
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, "a.ts"), 'const title = "欢迎登录";\n', "utf8");

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify({
    "module.auto_005": "欢迎登录",
    "module.auto_099": "旧文案"
  }, null, 2), "utf8");

  runCli(["extract", "--dir", targetDir, "--output", outputFile]);
  const overwriteResult = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  assert.equal(overwriteResult["module.auto_005"], "欢迎登录");
  assert.equal("module.auto_099" in overwriteResult, false);

  fs.writeFileSync(outputFile, JSON.stringify({
    "module.auto_005": "欢迎登录",
    "module.auto_099": "旧文案"
  }, null, 2), "utf8");
  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--mode", "merge"]);
  const mergeResult = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  assert.equal(mergeResult["module.auto_005"], "欢迎登录");
  assert.equal(mergeResult["module.auto_099"], "旧文案");

  fs.writeFileSync(outputFile, JSON.stringify({
    "module.auto_005": "欢迎登录",
    "module.auto_099": "旧文案"
  }, null, 2), "utf8");
  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--mode", "clean"]);
  const cleanResult = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  assert.equal(cleanResult["module.auto_001"], "欢迎登录");
  assert.equal("module.auto_005" in cleanResult, false);
}

function testScanCountOutput() {
  const output = runCli(["scan", "--dir", path.join(workspace, "fixtures/realish")]);

  assert.match(output, /scan_count:/);
  assert.match(output, /files_scanned: 3/);
  assert.match(output, /candidates_found: 11/);
}

function testCompositeCommands() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-composite-"));
  const targetDir = path.join(tempDir, "demo");
  const outputFile = path.join(tempDir, "i18n/zh.json");

  fs.cpSync(path.join(workspace, "fixtures/demo"), targetDir, { recursive: true });

  const runOutput = runCli(["run", "--dir", targetDir, "--output", outputFile]);
  assert.match(runOutput, /scan_count:/);
  assert.match(runOutput, /Planned 5 replacement\(s\)\./);

  const applyOutput = runCli(["apply", "--dir", targetDir, "--output", outputFile]);
  assert.match(applyOutput, /Generated .*zh\.json with 5 key\(s\)\./);
  assert.match(applyOutput, /Applied 5 replacement\(s\)\./);
}

function testReplaceIdempotency() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-idempotent-"));
  const targetDir = path.join(tempDir, "demo");
  const outputFile = path.join(tempDir, "zh.json");

  fs.cpSync(path.join(workspace, "fixtures/demo"), targetDir, { recursive: true });

  const firstRun = runCli(["replace", "--dir", targetDir, "--output", outputFile]);
  const secondRun = runCli(["replace", "--dir", targetDir, "--output", outputFile]);

  assert.match(firstRun, /Applied 5 replacement\(s\)\./);
  assert.match(secondRun, /Applied 0 replacement\(s\)\./);
  assert.doesNotMatch(secondRun, /\n  - /, "second replace should not emit more changes");
}

function testRiskyReport() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-risky-"));
  const targetDir = path.join(tempDir, "risky");
  const outputFile = path.join(tempDir, "zh.json");
  fs.cpSync(path.join(workspace, "fixtures/risky"), targetDir, { recursive: true });

  const report = runCli(["replace", "--dir", targetDir, "--output", outputFile, "--dry-run"]);

  assert.match(report, /\[skip:console_call]/);
  assert.match(report, /\[skip:object_key]/);
  assert.match(report, /\[skip:comment]/);
  assert.match(report, /\[skip:already_i18n]/);
  assert.match(report, /\[skip:template_string]/);
  assert.match(report, /\[skip:template_unsupported]/);
  assert.match(report, /replaced: 4/);
}

function testStructuredReports() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-report-"));
  const targetDir = path.join(tempDir, "realish");
  const outputFile = path.join(tempDir, "zh.json");
  const scanReportFile = path.join(tempDir, "scan-report.json");
  const extractReportFile = path.join(tempDir, "extract-report.json");
  const replaceReportFile = path.join(tempDir, "replace-report.json");

  fs.cpSync(path.join(workspace, "fixtures/realish"), targetDir, { recursive: true });

  runCli(["scan", "--dir", targetDir, "--report", scanReportFile]);
  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--report", extractReportFile]);
  runCli(["replace", "--dir", targetDir, "--output", outputFile, "--report", replaceReportFile, "--dry-run"]);

  const scanReport = JSON.parse(fs.readFileSync(scanReportFile, "utf8"));
  const extractReport = JSON.parse(fs.readFileSync(extractReportFile, "utf8"));
  const replaceReport = JSON.parse(fs.readFileSync(replaceReportFile, "utf8"));

  assert.equal(scanReport.summary.command, "scan");
  assert.equal(extractReport.summary.command, "extract");
  assert.equal(replaceReport.summary.command, "replace");
  assert.equal(scanReport.summary.files_scanned, 3);
  assert.equal(extractReport.summary.key_created_count > 0, true);
  assert.equal(replaceReport.summary.replaced_count > 0, true);
  assert.equal(Array.isArray(replaceReport.summary.changed_files), true);
  assert.equal(typeof replaceReport.summary.skipped_reasons, "object");
  assert.equal(Array.isArray(replaceReport.details), true);
  assert.equal(replaceReport.details.length > 0, true);

  const detailCandidates = replaceReport.details.reduce((sum, item) => sum + item.candidates_found, 0);
  const detailReplaced = replaceReport.details.reduce((sum, item) => sum + item.replaced_count, 0);
  const detailSkipped = replaceReport.details.reduce((sum, item) => sum + item.skipped_count, 0);

  assert.equal(detailCandidates, replaceReport.summary.candidates_found);
  assert.equal(detailReplaced, replaceReport.summary.replaced_count);
  assert.equal(detailSkipped, replaceReport.summary.skipped_count);

  const allowedPriorities = new Set(["high", "medium", "low"]);
  for (const detail of replaceReport.details) {
    assert.equal(allowedPriorities.has(detail.review_priority), true);
  }

  const detailWithSamples = replaceReport.details.find((item) => item.samples);
  assert.equal(Boolean(detailWithSamples), true);

  if (detailWithSamples?.samples) {
    assert.equal(Array.isArray(detailWithSamples.samples.replaced), true);
    assert.equal(Array.isArray(detailWithSamples.samples.skipped), true);
    assert.equal(detailWithSamples.samples.replaced.length <= 3, true);
    assert.equal(detailWithSamples.samples.skipped.length <= 3, true);

    for (const sample of [...detailWithSamples.samples.replaced, ...detailWithSamples.samples.skipped]) {
      assert.equal(typeof sample.reason, "string");
      assert.equal(typeof sample.text, "string");
    }
  }
}

function testUsageExitCode() {
  const result = runCliRaw(["scan", "--report"], false);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Missing value for --report/);
}

function runCli(args) {
  return execFileSync("node", [cliPath, ...args], {
    cwd: workspace,
    encoding: "utf8"
  });
}

function runCliRaw(args, expectSuccess = true) {
  const result = spawnSync("node", [cliPath, ...args], {
    cwd: workspace,
    encoding: "utf8"
  });

  if (expectSuccess && result.status !== 0) {
    throw new Error(result.stderr || `CLI exited with code ${result.status}`);
  }

  return result;
}
