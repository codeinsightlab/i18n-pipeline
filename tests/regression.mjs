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
testModuleDirExtractModes();
testModuleDirCrossModuleReuseBoundary();
testModuleDirTouchedModulesOnly();
await testNonAutoKeysDoNotAffectModuleCounter();
testModuleDirReplace();
testLeafTargetDirUsesAnchoredModulePrefix();
testTemplateWhitelistSupport();
testScriptWhitelistSupport();
testVueSfcWhitelistMainline();
testControlledExpressionBoundaries();
testScanCountOutput();
testCompositeCommands();
testGitCheckModes();
testReplaceIdempotency();
testCommentRangesFiltered();
testRiskyReport();
testStructuredReports();
testReportExplainability();
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
  const activityFile = path.join(workspace, "src/views/system/activityMini/index.vue");

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
  assert.equal(
    extractModulePrefix(activityFile, path.join(workspace, "src/views/system/activityMini")),
    "system.activitymini"
  );
  assert.equal(
    extractModulePrefix(activityFile, path.join(workspace, "src/views/system")),
    "system.activitymini"
  );
  assert.equal(
    extractModulePrefix(activityFile, path.join(workspace, "src/views")),
    "system.activitymini"
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

  fs.writeFileSync(path.join(dirA, "a.ts"), 'this.title = "欢迎登录";\nconst rules = [{ required: true, message: "保存", trigger: "blur" }];\n', "utf8");
  fs.writeFileSync(path.join(dirA, "b.ts"), 'this.$modal.msgSuccess("继续提交");\n', "utf8");

  fs.writeFileSync(path.join(dirB, "z.ts"), 'this.$modal.msgSuccess("继续提交");\n', "utf8");
  fs.writeFileSync(path.join(dirB, "y.ts"), 'this.title = "欢迎登录";\nconst rules = [{ required: true, message: "保存", trigger: "blur" }];\n', "utf8");

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
  fs.writeFileSync(path.join(targetDir, "a.ts"), 'this.title = "欢迎登录";\n', "utf8");

  fs.mkdirSync(path.dirname(outputFile), { recursive: true });
  fs.writeFileSync(outputFile, JSON.stringify({
    "module.auto_005": "欢迎登录",
    "module.auto_099": "旧文案"
  }, null, 2), "utf8");

  runCli(["extract", "--dir", targetDir, "--output", outputFile]);
  const overwriteResult = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  assert.equal(overwriteResult["module.auto_005"], "欢迎登录");
  assert.equal(overwriteResult["module.auto_099"], "旧文案");

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

function testModuleDirExtractModes() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-module-dir-"));
  const targetDir = path.join(tempDir, "project");
  const outputFile = path.join(tempDir, "i18n/zh.json");

  fs.mkdirSync(path.join(targetDir, "src/views/system/user"), { recursive: true });
  fs.mkdirSync(path.join(targetDir, "src/plugins/download"), { recursive: true });
  fs.writeFileSync(path.join(targetDir, "src/views/system/user/index.ts"), 'this.title = "用户管理";\nconst rules = [{ required: true, message: "保存", trigger: "blur" }];\n', "utf8");
  fs.writeFileSync(path.join(targetDir, "src/plugins/download/index.ts"), 'this.$modal.msgSuccess("下载中心");\n', "utf8");

  writeJson(path.join(tempDir, "i18n/system/user/zh.json"), {
    "system.user.auto_005": "用户管理",
    "system.user.auto_010": "旧文案"
  });
  writeJson(path.join(tempDir, "i18n/plugins/download/zh.json"), {
    "plugins.download.auto_002": "下载中心"
  });
  writeJson(path.join(tempDir, "i18n/router/zh.json"), {
    "router.auto_003": "路由旧文案"
  });

  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--structure", "module-dir"]);

  const overwriteSystem = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/system/user/zh.json"), "utf8"));
  const overwritePlugin = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/plugins/download/zh.json"), "utf8"));
  const untouchedRouter = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/router/zh.json"), "utf8"));

  assert.equal(overwriteSystem["system.user.auto_005"], "用户管理");
  assert.equal(overwriteSystem["system.user.auto_011"], "保存");
  assert.equal(overwriteSystem["system.user.auto_010"], "旧文案");
  assert.equal(overwritePlugin["plugins.download.auto_002"], "下载中心");
  assert.equal(untouchedRouter["router.auto_003"], "路由旧文案");

  writeJson(path.join(tempDir, "i18n/system/user/zh.json"), {
    "system.user.auto_005": "用户管理",
    "system.user.auto_010": "旧文案"
  });
  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--structure", "module-dir", "--mode", "merge"]);
  const mergeSystem = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/system/user/zh.json"), "utf8"));
  assert.equal(mergeSystem["system.user.auto_005"], "用户管理");
  assert.equal(mergeSystem["system.user.auto_010"], "旧文案");
  assert.equal(mergeSystem["system.user.auto_011"], "保存");
}

function testModuleDirCrossModuleReuseBoundary() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-module-boundary-"));
  const targetDir = path.join(tempDir, "project");
  const outputFile = path.join(tempDir, "i18n/zh.json");

  fs.mkdirSync(path.join(targetDir, "src/views/system/user"), { recursive: true });
  fs.mkdirSync(path.join(targetDir, "src/plugins/download"), { recursive: true });
  fs.writeFileSync(path.join(targetDir, "src/views/system/user/index.ts"), 'this.title = "保存";\n', "utf8");
  fs.writeFileSync(path.join(targetDir, "src/plugins/download/index.ts"), 'this.$modal.msgSuccess("保存");\n', "utf8");

  writeJson(path.join(tempDir, "i18n/system/user/zh.json"), {
    "system.user.auto_005": "保存"
  });
  writeJson(path.join(tempDir, "i18n/plugins/download/zh.json"), {
    "plugins.download.auto_002": "旧下载文案"
  });

  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--structure", "module-dir"]);

  const systemZh = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/system/user/zh.json"), "utf8"));
  const pluginZh = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/plugins/download/zh.json"), "utf8"));

  assert.equal(systemZh["system.user.auto_005"], "保存");
  assert.equal(pluginZh["plugins.download.auto_003"], "保存");
  assert.equal("system.user.auto_005" in pluginZh, false);
}

function testModuleDirTouchedModulesOnly() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-module-touched-"));
  const targetDir = path.join(tempDir, "project");
  const outputFile = path.join(tempDir, "i18n/zh.json");

  fs.mkdirSync(path.join(targetDir, "src/views/system/user"), { recursive: true });
  fs.writeFileSync(path.join(targetDir, "src/views/system/user/index.ts"), 'this.title = "用户管理";\n', "utf8");

  writeJson(path.join(tempDir, "i18n/system/user/zh.json"), {
    "system.user.auto_001": "旧用户"
  });
  writeJson(path.join(tempDir, "i18n/plugins/download/zh.json"), {
    "plugins.download.auto_001": "下载中心"
  });

  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--structure", "module-dir"]);
  const pluginZh = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/plugins/download/zh.json"), "utf8"));
  assert.deepEqual(pluginZh, {
    "plugins.download.auto_001": "下载中心"
  });

  writeJson(path.join(tempDir, "i18n/system/user/zh.json"), {
    "system.user.auto_001": "旧用户"
  });
  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--structure", "module-dir", "--mode", "merge"]);
  const pluginZhAfterMerge = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/plugins/download/zh.json"), "utf8"));
  assert.deepEqual(pluginZhAfterMerge, {
    "plugins.download.auto_001": "下载中心"
  });
}

async function testNonAutoKeysDoNotAffectModuleCounter() {
  const { extractEntries } = await import("../dist/extractor/extract.js");
  const targetDir = path.join(os.tmpdir(), "i18n-non-auto-dir");
  const filePath = path.join(targetDir, "src/views/system/user/index.ts");
  const entries = extractEntries([{
    filePath,
    line: 1,
    column: 1,
    text: "保存",
    quote: "\"",
    raw: "\"保存\"",
    contextType: "js_string",
    extractable: true,
    replaceable: true
  }], new Map([
    ["system.user.legacy", "历史文案"],
    ["system.user.auto_005", "用户管理"],
    ["bad-format", "错误格式"]
  ]), targetDir, "module-dir");

  assert.equal(entries[0].key, "system.user.auto_006");
}

function testModuleDirReplace() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-module-replace-"));
  const targetDir = path.join(tempDir, "project");
  const outputFile = path.join(tempDir, "i18n/zh.json");

  fs.mkdirSync(path.join(targetDir, "src/views/system/user"), { recursive: true });
  fs.mkdirSync(path.join(tempDir, "i18n/system/user"), { recursive: true });
  fs.writeFileSync(path.join(targetDir, "src/views/system/user/index.ts"), 'this.title = "用户管理";\nconst rules = [{ required: true, message: "保存", trigger: "blur" }];\n', "utf8");
  writeJson(path.join(tempDir, "i18n/system/user/zh.json"), {
    "system.user.auto_001": "用户管理",
    "system.user.auto_002": "保存"
  });

  const output = runCli(["replace", "--dir", targetDir, "--output", outputFile, "--structure", "module-dir"]);
  const source = fs.readFileSync(path.join(targetDir, "src/views/system/user/index.ts"), "utf8");

  assert.match(output, /Applied 2 replacement\(s\)\./);
  assert.match(source, /t\("system\.user\.auto_001"\)/);
  assert.match(source, /t\("system\.user\.auto_002"\)/);
}

function testLeafTargetDirUsesAnchoredModulePrefix() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-leaf-target-"));
  const projectDir = path.join(tempDir, "ruoyi-ui");
  const targetDir = path.join(projectDir, "src/views/system/activityMini");
  const outputFile = path.join(projectDir, "i18n/zh.json");

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, "index.ts"), 'this.title = "添加活动信息";\n', "utf8");

  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--structure", "module-dir"]);

  const moduleFile = path.join(projectDir, "i18n/system/activitymini/zh.json");
  assert.equal(fs.existsSync(moduleFile), true);
  const zh = JSON.parse(fs.readFileSync(moduleFile, "utf8"));
  assert.equal(zh["system.activitymini.auto_001"], "添加活动信息");
}

function testTemplateWhitelistSupport() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-template-whitelist-"));
  const targetDir = path.join(tempDir, "src");
  const outputFile = path.join(tempDir, "zh.json");

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, "sample.vue"), [
    "<template>",
    "  <el-button>保存</el-button>",
    "  <el-table-column label=\"用户名\" />",
    "  <input placeholder=\"请输入姓名\" />",
    "  <div>不应替换</div>",
    "</template>"
  ].join("\n"), "utf8");

  const output = runCli(["replace", "--dir", targetDir, "--output", outputFile, "--dry-run"]);
  assert.match(output, /\+ \{\{ \$t\("module\.auto_001"\) \}\}/);
  assert.match(output, /:label="\$t\('/);
  assert.match(output, /:placeholder="\$t\('/);
  assert.match(output, /\[skip:template_unsupported] 不应替换/);
}

function testScriptWhitelistSupport() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-script-whitelist-"));
  const targetDir = path.join(tempDir, "src");
  const outputFile = path.join(tempDir, "zh.json");

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, "sample.ts"), [
    'const rules = [{ required: true, message: "请输入姓名", trigger: "blur" }];',
    'this.$modal.msgSuccess("保存成功");',
    'this.$modal.msgSuccess(flag ? "开启成功" : "关闭成功");',
    'this.title = "用户管理";',
    'const desc = "不应替换";',
    'const obj = { message: "普通消息" };',
    'this.$modal.confirm("确认删除" + id + "吗");'
  ].join("\n"), "utf8");

  const output = runCli(["replace", "--dir", targetDir, "--output", outputFile, "--dry-run"]);
  assert.match(output, /- "请输入姓名"/);
  assert.match(output, /- "保存成功"/);
  assert.match(output, /- "开启成功"/);
  assert.match(output, /- "关闭成功"/);
  assert.match(output, /- "用户管理"/);
  assert.match(output, /- "确认删除"/);
  assert.match(output, /- "吗"/);
  assert.match(output, /\[skip:script_unsupported] "不应替换"/);
  assert.match(output, /\[skip:script_unsupported] "普通消息"/);
  assert.doesNotMatch(output, /\[skip:script_unsupported] "确认删除"/);
  assert.doesNotMatch(output, /\[skip:script_unsupported] "开启成功"/);
  assert.match(output, /replaced: 7/);
}

function testControlledExpressionBoundaries() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-expression-boundaries-"));
  const targetDir = path.join(tempDir, "src");
  const outputFile = path.join(tempDir, "zh.json");

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, "sample.ts"), [
    'this.$modal.confirm("确认" + type + id + "吗");',
    'this.$modal.msgSuccess(flag ? "开启" + name : "关闭");',
    'this.$message.success(flag ? "开启成功" : "关闭成功");'
  ].join("\n"), "utf8");

  const output = runCli(["replace", "--dir", targetDir, "--output", outputFile, "--dry-run"]);
  assert.match(output, /\[skip:script_unsupported] "确认"/);
  assert.match(output, /\[skip:script_unsupported] "吗"/);
  assert.match(output, /\[skip:script_unsupported] "开启"/);
  assert.match(output, /\[skip:script_unsupported] "关闭"/);
  assert.match(output, /\[skip:object_key] "开启成功"/);
  assert.match(output, /\[skip:script_unsupported] "关闭成功"/);
  assert.match(output, /replaced: 0/);
}

function testScanCountOutput() {
  const output = runCli(["scan", "--dir", path.join(workspace, "fixtures/realish")]);

  assert.match(output, /scan_count:/);
  assert.match(output, /files_scanned: 3/);
  assert.match(output, /\[template_attr_static]/);
  assert.match(output, /\[template_text_static]/);
  assert.match(output, /\[unsafe_skip] \[skip:console_call]/);
  assert.match(output, /candidates_found: 17/);
}

function testCompositeCommands() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-composite-"));
  const targetDir = path.join(tempDir, "demo");
  const outputFile = path.join(tempDir, "i18n/zh.json");
  const runReportFile = path.join(tempDir, "logs/run-report.json");
  const applyReportFile = path.join(tempDir, "logs/apply-report.json");

  fs.cpSync(path.join(workspace, "fixtures/demo"), targetDir, { recursive: true });

  const runOutput = runCli(["run", "--dir", targetDir, "--output", outputFile, "--report", runReportFile]);
  assert.match(runOutput, /\[配置]/);
  assert.match(runOutput, /structure: single（默认）/);
  assert.match(runOutput, /mode: merge（默认）/);
  assert.match(runOutput, /git-check: warn（默认）/);
  assert.match(runOutput, /你可以使用以下命令指定参数：/);
  assert.match(runOutput, /i18n run --dir .* --structure module-dir --git-check strict/);
  assert.match(runOutput, /scan_count:/);
  assert.match(runOutput, /Planned 25 resource key\(s\)\./);
  assert.match(runOutput, /未修改资源文件。/);
  assert.match(runOutput, /Planned 41 replacement\(s\)\./);
  assert.match(runOutput, /活动标题不能为空/);
  assert.match(runOutput, /活动ID/);
  assert.match(runOutput, /Composite report written to/);

  const runReport = JSON.parse(fs.readFileSync(runReportFile, "utf8"));
  assert.equal(runReport.config.command, "run");
  assert.equal(runReport.config.structure, "single");
  assert.equal(runReport.summary.scan.candidates_found, 41);
  assert.equal(runReport.summary.replace.replaced_count, 41);
  assert.equal(Array.isArray(runReport.details.replace), true);

  const applyOutput = runCli(["apply", "--dir", targetDir, "--output", outputFile, "--report", applyReportFile]);
  assert.match(applyOutput, /\[配置]/);
  assert.match(applyOutput, /Generated .*zh\.json with 25 key\(s\)\./);
  assert.match(applyOutput, /Applied 41 replacement\(s\)\./);
  assert.match(applyOutput, /Composite report written to/);

  const applyReport = JSON.parse(fs.readFileSync(applyReportFile, "utf8"));
  assert.equal(applyReport.config.command, "apply");
  assert.equal(applyReport.summary.extract.key_created_count, 25);
  assert.equal(applyReport.summary.replace.replaced_count, 41);
  assert.equal(typeof applyReport.summary.module_distribution, "object");

  const zhAfterFirstApply = fs.readFileSync(outputFile, "utf8");
  const secondApplyOutput = runCli(["apply", "--dir", targetDir, "--output", outputFile]);
  const zhAfterSecondApply = fs.readFileSync(outputFile, "utf8");
  assert.equal(zhAfterSecondApply, zhAfterFirstApply);
  assert.match(secondApplyOutput, /未发现可提取文本。/);
  assert.match(secondApplyOutput, /未修改资源文件。/);
  assert.match(secondApplyOutput, /Applied 0 replacement\(s\)\./);

  const zhBeforeRun = fs.readFileSync(outputFile, "utf8");
  const runAfterApply = runCli(["run", "--dir", targetDir, "--output", outputFile]);
  const zhAfterRun = fs.readFileSync(outputFile, "utf8");
  assert.equal(zhAfterRun, zhBeforeRun);
  assert.match(runAfterApply, /No Chinese string literals found\./);
  assert.match(runAfterApply, /未发现可提取文本。/);
  assert.match(runAfterApply, /未修改资源文件。/);
  assert.match(runAfterApply, /Planned 0 replacement\(s\)\./);

  const explicitOutput = runCli([
    "run",
    "--dir",
    targetDir,
    "--output",
    outputFile,
    "--structure",
    "module-dir",
    "--mode",
    "merge",
    "--git-check",
    "strict"
  ]);
  assert.doesNotMatch(explicitOutput, /你可以使用以下命令指定参数：/);
}

function testGitCheckModes() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-git-check-"));
  const targetDir = path.join(tempDir, "demo");
  const outputFile = path.join(tempDir, "i18n/zh.json");

  fs.cpSync(path.join(workspace, "fixtures/demo"), targetDir, { recursive: true });
  execFileSync("git", ["init"], { cwd: targetDir, stdio: "ignore" });

  const strictResult = runCliRaw(["apply", "--dir", targetDir, "--output", outputFile, "--git-check", "strict"], false);
  assert.equal(strictResult.status !== 0, true);
  assert.match(strictResult.stderr, /Git working tree is not clean/);
  assert.match(strictResult.stderr, /apply has been aborted/);

  const offResult = runCliRaw(["apply", "--dir", targetDir, "--output", outputFile, "--git-check", "off"], false);
  assert.equal(offResult.status, 0);
}

function testReplaceIdempotency() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-idempotent-"));
  const targetDir = path.join(tempDir, "demo");
  const outputFile = path.join(tempDir, "zh.json");

  fs.cpSync(path.join(workspace, "fixtures/demo"), targetDir, { recursive: true });

  const firstRun = runCli(["replace", "--dir", targetDir, "--output", outputFile]);
  const secondRun = runCli(["replace", "--dir", targetDir, "--output", outputFile]);

  assert.match(firstRun, /Applied 41 replacement\(s\)\./);
  assert.match(secondRun, /Applied 0 replacement\(s\)\./);
  assert.doesNotMatch(secondRun, /\n  - /, "second replace should not emit more changes");
}

function testVueSfcWhitelistMainline() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-vue-mainline-"));
  const targetDir = path.join(tempDir, "src");
  const outputFile = path.join(tempDir, "zh.json");
  const reportFile = path.join(tempDir, "replace-report.json");

  fs.mkdirSync(targetDir, { recursive: true });
  fs.copyFileSync(path.join(workspace, "fixtures/demo/sample.vue"), path.join(targetDir, "sample.vue"));

  const scanOutput = runCli(["scan", "--dir", targetDir]);
  assert.match(scanOutput, /sample\.vue:45:23  \[template_attr_static] 活动标题/);
  assert.match(scanOutput, /sample\.vue:54:55  \[template_text_static] 确 定/);
  assert.match(scanOutput, /sample\.vue:75:38  \[js_string] 活动标题不能为空/);
  assert.match(scanOutput, /sample\.vue:100:18  \[js_string] 是否确认删除活动信息编号为"/);
  assert.match(scanOutput, /candidates_found: 31/);

  const replaceOutput = runCli(["replace", "--dir", targetDir, "--output", outputFile, "--dry-run", "--report", reportFile]);
  assert.match(replaceOutput, /sample\.vue:45[\s\S]*:label="\$t\('/);
  assert.match(replaceOutput, /sample\.vue:66[\s\S]*\{\{ \$t\("module\.auto_/);
  assert.match(replaceOutput, /sample\.vue:75[\s\S]*\+ t\("module\.auto_/);
  assert.match(replaceOutput, /sample\.vue:100[\s\S]*\+ t\("module\.auto_/);
  assert.match(replaceOutput, /replaced: 31/);

  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  assert.equal(report.summary.replaceable_count, 31);
  assert.equal(report.summary.replaced_count, 31);
  assert.equal(report.summary.policy_skipped_count, 0);
  assert.equal(report.summary.script_unsupported_count, 0);
  assert.equal(report.summary.matched_rule_distribution.script_rules_message, 2);
  assert.equal(report.summary.matched_rule_distribution.script_this_title, 2);
  assert.equal(report.summary.matched_rule_distribution.modal_msg_success, 3);
  assert.equal(report.summary.matched_rule_distribution.modal_msg_success_ternary, 2);
  assert.equal(report.summary.matched_rule_distribution.modal_confirm_concat, 2);
}

function testCommentRangesFiltered() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-comment-filter-"));
  const targetDir = path.join(tempDir, "src");
  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, "sample.ts"), [
    '// "注释中文"',
    'const title = "真实文案";',
    '/*',
    '  "块注释中文"',
    '*/'
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(targetDir, "sample.vue"), [
    "<template>",
    "  <!-- 注释里的中文 -->",
    "  <span>页面标题</span>",
    "</template>"
  ].join("\n"), "utf8");

  const output = runCli(["scan", "--dir", targetDir]);
  assert.doesNotMatch(output, /注释中文/);
  assert.doesNotMatch(output, /块注释中文/);
  assert.doesNotMatch(output, /注释里的中文/);
  assert.match(output, /真实文案/);
  assert.match(output, /页面标题/);
}

function testRiskyReport() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-risky-"));
  const targetDir = path.join(tempDir, "risky");
  const outputFile = path.join(tempDir, "zh.json");
  fs.cpSync(path.join(workspace, "fixtures/risky"), targetDir, { recursive: true });

  const report = runCli(["replace", "--dir", targetDir, "--output", outputFile, "--dry-run"]);

  assert.match(report, /\[skip:console_call]/);
  assert.match(report, /\[skip:object_key]/);
  assert.match(report, /\[skip:already_i18n]/);
  assert.match(report, /\[skip:template_string]/);
  assert.match(report, /\[skip:template_unsupported] title="按钮标题"/);
  assert.match(report, /\{\{ \$t\("module\.auto_\d{3}"\) \}\}/);
  assert.match(report, /\[skip:script_unsupported] "欢迎登录"/);
  assert.match(report, /\[skip:script_unsupported] "不会替换对象键"/);
  assert.match(report, /replaced: 2/);
  assert.doesNotMatch(report, /\[skip:comment]/);
  assert.match(report, /\[skip:script_unsupported]/);
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
  assert.equal(typeof replaceReport.summary.extractable_count, "number");
  assert.equal(typeof replaceReport.summary.replaceable_count, "number");
  assert.equal(typeof replaceReport.summary.policy_skipped_count, "number");
  assert.equal(typeof replaceReport.summary.script_unsupported_count, "number");
  assert.equal(Array.isArray(replaceReport.summary.changed_files), true);
  assert.equal(typeof replaceReport.summary.skipped_reasons, "object");
  assert.equal(typeof replaceReport.summary.matched_rule_distribution, "object");
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
      assert.equal(typeof sample.context_type, "string");
      assert.equal(typeof sample.matched_rule, "string");
      assert.equal(typeof sample.extractable, "boolean");
      assert.equal(typeof sample.replaceable, "boolean");
    }
  }
}

function testReportExplainability() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-explainability-"));
  const targetDir = path.join(tempDir, "src");
  const outputFile = path.join(tempDir, "zh.json");
  const reportFile = path.join(tempDir, "replace-report.json");

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, "sample.vue"), [
    "<template>",
    "  <el-button>保存</el-button>",
    "  <el-table-column label=\"用户名\" />",
    "  <img alt=\"头像\" />",
    "  <span title=\"页面标题\">普通文案</span>",
    "</template>"
  ].join("\n"), "utf8");
  fs.writeFileSync(path.join(targetDir, "sample.ts"), [
    'const rules = [{ required: true, message: "请输入姓名", trigger: "blur" }];',
    'this.$modal.msgSuccess("保存成功");',
    'this.title = "用户管理";',
    'const desc = "普通字符串";',
    'this.$modal.confirm("确认删除" + id + "吗");'
  ].join("\n"), "utf8");

  runCli(["replace", "--dir", targetDir, "--output", outputFile, "--report", reportFile, "--dry-run"]);
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));

  assert.equal(report.summary.replaceable_count, 7);
  assert.equal(report.summary.policy_skipped_count, 4);
  assert.equal(report.summary.script_unsupported_count, 1);
  assert.equal(report.summary.matched_rule_distribution.template_el_button_text, 1);
  assert.equal(report.summary.matched_rule_distribution.template_el_table_column_label, 1);
  assert.equal(report.summary.matched_rule_distribution.template_unsupported_attr_alt, 1);
  assert.equal(report.summary.matched_rule_distribution.template_unsupported_attr_title, 1);
  assert.equal(report.summary.matched_rule_distribution.template_unsupported_text, 1);
  assert.equal(report.summary.matched_rule_distribution.script_rules_message, 1);
  assert.equal(report.summary.matched_rule_distribution.modal_msg_success, 1);
  assert.equal(report.summary.matched_rule_distribution.script_this_title, 1);
  assert.equal(report.summary.matched_rule_distribution.modal_confirm_concat, 2);
  assert.equal(report.summary.matched_rule_distribution.script_unsupported_generic, 1);

  const sampleRules = [];
  for (const detail of report.details) {
    if (!detail.samples) {
      continue;
    }
    for (const sample of [...detail.samples.replaced, ...detail.samples.skipped]) {
      sampleRules.push(sample.matched_rule);
      assert.equal(typeof sample.context_type, "string");
      assert.equal(typeof sample.extractable, "boolean");
      assert.equal(typeof sample.replaceable, "boolean");
    }
  }

  assert.equal(sampleRules.includes("template_unsupported_attr_title"), true);
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

function writeJson(filePath, value) {
  fs.mkdirSync(path.dirname(filePath), { recursive: true });
  fs.writeFileSync(filePath, JSON.stringify(value, null, 2), "utf8");
}
