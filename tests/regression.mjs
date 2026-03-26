import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { execFileSync, spawnSync } from "node:child_process";

const workspace = process.cwd();
const cliPath = path.join(workspace, "dist/cli/index.js");
const defaultScriptRulesFile = path.join(workspace, "tests/fixtures/script-rules.phase1.json");

await runBuild();
await testScriptRulesTemplateAndLoader();
await testModulePrefixResolver();
testKeyStability();
testExtractModes();
testModuleDirExtractModes();
testModuleDirCrossModuleReuseBoundary();
testModuleDirTouchedModulesOnly();
testModuleDirNestedOutputAndDeepMerge();
testModuleDirPathConflictIsExplainable();
await testNonAutoKeysDoNotAffectModuleCounter();
testModuleDirReplace();
testLeafTargetDirUsesAnchoredModulePrefix();
testStructuredAnchorKeyPriority();
testFormLabelPlaceholderComboUsesFlatSuffix();
testModuleDirGroupFirstNoCrossGroupReuse();
testModuleDirRulesMessageAnchors();
testModuleDirRulesMessageFallback();
testModuleDirRulesMessagePreferAnchorOverAutoReuse();
testTemplateWhitelistSupport();
testTemplateTrailingSpaceReplacement();
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
testHtmlReportCommand();
testReportApplyAlignmentAndSourceMode();
testReportExplainability();
testScriptRulesAreExplicit();
testScriptRulesFileValidation();
testInitScriptRulesCommand();
testUsageExitCode();

console.log("Regression checks passed.");

async function testScriptRulesTemplateAndLoader() {
  const { SCRIPT_RULES_TEMPLATE } = await import("../dist/core/script-templates.js");
  const { validateScriptRulesDocument } = await import("../dist/core/script-rules.js");

  assert.equal(Array.isArray(SCRIPT_RULES_TEMPLATE.scriptRules), true);
  assert.equal(SCRIPT_RULES_TEMPLATE.scriptRules.some((rule) => rule.type === "assignment"), true);
  assert.equal(SCRIPT_RULES_TEMPLATE.scriptRules.some((rule) => rule.type === "call"), true);

  const validated = validateScriptRulesDocument(JSON.parse(fs.readFileSync(defaultScriptRulesFile, "utf8")), defaultScriptRulesFile);
  assert.equal(validated.scriptRules.length >= 3, true);
}

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

  runCli(["extract", "--dir", dirA, "--output", outputA, "--structure", "single"]);
  runCli(["extract", "--dir", dirB, "--output", outputB, "--structure", "single"]);

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

  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--structure", "single"]);
  const overwriteResult = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  assert.equal(overwriteResult["module.auto_005"], "欢迎登录");
  assert.equal(overwriteResult["module.auto_099"], "旧文案");

  fs.writeFileSync(outputFile, JSON.stringify({
    "module.auto_005": "欢迎登录",
    "module.auto_099": "旧文案"
  }, null, 2), "utf8");
  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--mode", "merge", "--structure", "single"]);
  const mergeResult = JSON.parse(fs.readFileSync(outputFile, "utf8"));
  assert.equal(mergeResult["module.auto_005"], "欢迎登录");
  assert.equal(mergeResult["module.auto_099"], "旧文案");

  fs.writeFileSync(outputFile, JSON.stringify({
    "module.auto_005": "欢迎登录",
    "module.auto_099": "旧文案"
  }, null, 2), "utf8");
  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--mode", "clean", "--structure", "single"]);
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
    auto_005: "用户管理",
    auto_010: "旧文案"
  });
  writeJson(path.join(tempDir, "i18n/plugins/download/zh.json"), {
    auto_002: "下载中心"
  });
  writeJson(path.join(tempDir, "i18n/router/zh.json"), {
    auto_003: "路由旧文案"
  });

  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--structure", "module-dir"]);

  const overwriteSystem = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/system/user/zh.json"), "utf8"));
  const overwritePlugin = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/plugins/download/zh.json"), "utf8"));
  const untouchedRouter = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/router/zh.json"), "utf8"));

  assert.equal(overwriteSystem.auto_005, "用户管理");
  assert.equal(overwriteSystem.auto_011, "保存");
  assert.equal(overwriteSystem.auto_010, "旧文案");
  assert.equal(overwritePlugin.auto_002, "下载中心");
  assert.equal(untouchedRouter.auto_003, "路由旧文案");

  writeJson(path.join(tempDir, "i18n/system/user/zh.json"), {
    auto_005: "用户管理",
    auto_010: "旧文案"
  });
  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--structure", "module-dir", "--mode", "merge"]);
  const mergeSystem = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/system/user/zh.json"), "utf8"));
  assert.equal(mergeSystem.auto_005, "用户管理");
  assert.equal(mergeSystem.auto_010, "旧文案");
  assert.equal(mergeSystem.auto_011, "保存");
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
    auto_005: "保存"
  });
  writeJson(path.join(tempDir, "i18n/plugins/download/zh.json"), {
    auto_002: "旧下载文案"
  });

  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--structure", "module-dir"]);

  const systemZh = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/system/user/zh.json"), "utf8"));
  const pluginZh = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/plugins/download/zh.json"), "utf8"));

  assert.equal(systemZh.auto_005, "保存");
  assert.equal(pluginZh.auto_003, "保存");
  assert.equal("auto_005" in pluginZh, false);
}

function testModuleDirTouchedModulesOnly() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-module-touched-"));
  const targetDir = path.join(tempDir, "project");
  const outputFile = path.join(tempDir, "i18n/zh.json");

  fs.mkdirSync(path.join(targetDir, "src/views/system/user"), { recursive: true });
  fs.writeFileSync(path.join(targetDir, "src/views/system/user/index.ts"), 'this.title = "用户管理";\n', "utf8");

  writeJson(path.join(tempDir, "i18n/system/user/zh.json"), {
    auto_001: "旧用户"
  });
  writeJson(path.join(tempDir, "i18n/plugins/download/zh.json"), {
    auto_001: "下载中心"
  });

  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--structure", "module-dir"]);
  const pluginZh = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/plugins/download/zh.json"), "utf8"));
  assert.deepEqual(pluginZh, {
    auto_001: "下载中心"
  });

  writeJson(path.join(tempDir, "i18n/system/user/zh.json"), {
    auto_001: "旧用户"
  });
  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--structure", "module-dir", "--mode", "merge"]);
  const pluginZhAfterMerge = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/plugins/download/zh.json"), "utf8"));
  assert.deepEqual(pluginZhAfterMerge, {
    auto_001: "下载中心"
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
    auto_001: "用户管理",
    auto_002: "保存"
  });

  const output = runCli(["replace", "--dir", targetDir, "--output", outputFile, "--structure", "module-dir"]);
  const source = fs.readFileSync(path.join(targetDir, "src/views/system/user/index.ts"), "utf8");

  assert.match(output, /Applied 2 replacement\(s\)\./);
  assert.match(source, /t\("system\.user\.auto_001"\)/);
  assert.match(source, /t\("system\.user\.auto_002"\)/);
}

function testModuleDirNestedOutputAndDeepMerge() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-module-nested-merge-"));
  const targetDir = path.join(tempDir, "project");
  const outputFile = path.join(tempDir, "i18n/zh.json");

  fs.mkdirSync(path.join(targetDir, "src/views/order/transactions"), { recursive: true });
  fs.writeFileSync(path.join(targetDir, "src/views/order/transactions/index.vue"), [
    "<template>",
    "  <el-form-item>",
    "    <el-input v-model=\"queryParams.search\" placeholder=\"搜索\" />",
    "  </el-form-item>",
    "</template>"
  ].join("\n"), "utf8");

  writeJson(path.join(tempDir, "i18n/order/transactions/zh.json"), {
    query: {
      reset: "重置"
    }
  });

  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--structure", "module-dir"]);
  const moduleZh = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/order/transactions/zh.json"), "utf8"));

  assert.equal(moduleZh.query.reset, "重置");
  assert.equal(moduleZh.query.search, "搜索");
}

function testModuleDirPathConflictIsExplainable() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-module-conflict-"));
  const targetDir = path.join(tempDir, "project");
  const outputFile = path.join(tempDir, "i18n/zh.json");

  fs.mkdirSync(path.join(targetDir, "src/views/order/transactions"), { recursive: true });
  fs.writeFileSync(path.join(targetDir, "src/views/order/transactions/index.vue"), [
    "<template>",
    "  <el-form-item>",
    "    <el-input v-model=\"queryParams.search\" placeholder=\"搜索\" />",
    "  </el-form-item>",
    "</template>"
  ].join("\n"), "utf8");

  writeJson(path.join(tempDir, "i18n/order/transactions/zh.json"), {
    query: "旧值"
  });

  const result = runCliRaw([
    "extract",
    "--dir",
    targetDir,
    "--output",
    outputFile,
    "--structure",
    "module-dir"
  ], false);

  assert.equal(result.status !== 0, true);
  assert.match(result.stderr, /Resource path conflict/);
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
  assert.equal(zh.auto_001, "添加活动信息");
}

function testStructuredAnchorKeyPriority() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-key-priority-module-dir-"));
  const targetDir = path.join(tempDir, "project");
  const pageDir = path.join(targetDir, "src/views/mes/pro/schedule");
  const outputFile = path.join(tempDir, "i18n/zh.json");

  fs.mkdirSync(pageDir, { recursive: true });
  fs.writeFileSync(path.join(pageDir, "index.vue"), [
    "<template>",
    "  <el-form-item>",
    "    <el-input v-model=\"queryParams.filters.workorderName\" placeholder=\"工单名称查询\" />",
    "  </el-form-item>",
    "  <el-table-column prop=\"workorderName\" label=\"工单名称列\" />",
    "  <el-form-item label=\"工单名称\" prop=\"workorderName\">",
    "    <el-input />",
    "  </el-form-item>",
    "  <el-form-item>",
    "    <el-input v-model=\"formData.user.name\" placeholder=\"用户姓名输入\" />",
    "  </el-form-item>",
    "  <el-form-item>",
    "    <el-input placeholder=\"无锚点占位\" />",
    "  </el-form-item>",
    "  <el-button>保存</el-button>",
    "</template>"
  ].join("\n"), "utf8");

  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--structure", "module-dir"]);
  const moduleFile = path.join(tempDir, "i18n/mes/pro/schedule/zh.json");
  const resources = JSON.parse(fs.readFileSync(moduleFile, "utf8"));
  assert.equal(resources.query.workorderName, "工单名称查询");
  assert.equal(resources.table.workorderName, "工单名称列");
  assert.equal(resources.form.workorderName, "工单名称");
  assert.equal(resources.form.name, "用户姓名输入");
  assert.equal(resources.form.queryParams, undefined);
  assert.equal(resources.form.formData, undefined);
  assert.match(resources.auto_001 ?? "", /无锚点占位|保存/);
  assert.match(resources.auto_002 ?? "", /无锚点占位|保存/);
  const rootFile = path.join(tempDir, "i18n/zh.json");
  const rootResources = fs.existsSync(rootFile) ? JSON.parse(fs.readFileSync(rootFile, "utf8")) : {};
  assert.equal(Object.keys(rootResources).length, 0);
}

function testFormLabelPlaceholderComboUsesFlatSuffix() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-form-combo-"));
  const targetDir = path.join(tempDir, "project");
  const outputFile = path.join(tempDir, "i18n/zh.json");
  const pageDir = path.join(targetDir, "src/views/order/transactions");

  fs.mkdirSync(pageDir, { recursive: true });
  fs.writeFileSync(path.join(pageDir, "index.vue"), [
    "<template>",
    "  <el-form-item label=\"地址标签\" prop=\"addressTag\">",
    "    <el-input v-model=\"form.addressTag\" placeholder=\"请输入地址标签\" />",
    "  </el-form-item>",
    "</template>"
  ].join("\n"), "utf8");

  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--structure", "module-dir"]);
  const moduleZh = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/order/transactions/zh.json"), "utf8"));

  assert.equal(moduleZh.form.addressTag, "地址标签");
  assert.equal(moduleZh.form.addressTagPlaceholder, "请输入地址标签");
  assert.equal(typeof moduleZh.form.addressTag, "string");
  assert.equal(moduleZh.form.addressTag?.label, undefined);
}

function testModuleDirGroupFirstNoCrossGroupReuse() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-group-first-"));
  const targetDir = path.join(tempDir, "project");
  const outputFile = path.join(tempDir, "i18n/zh.json");
  const pageDir = path.join(targetDir, "src/views/order/addresses");

  fs.mkdirSync(pageDir, { recursive: true });
  fs.writeFileSync(path.join(pageDir, "index.vue"), [
    "<template>",
    "  <el-form-item label=\"用户id\" prop=\"userId\">",
    "    <el-input v-model=\"form.userId\" placeholder=\"请输入用户id\" />",
    "  </el-form-item>",
    "  <el-table-column prop=\"userId\" label=\"用户id\" />",
    "</template>",
    "<script>",
    "const rules = {",
    "  userId: [",
    "    { required: true, message: \"用户id\", trigger: \"blur\" }",
    "  ]",
    "};",
    "</script>"
  ].join("\n"), "utf8");

  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--structure", "module-dir"]);
  const moduleZh = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/order/addresses/zh.json"), "utf8"));

  assert.equal(moduleZh.form.userId, "用户id");
  assert.equal(moduleZh.form.userIdPlaceholder, "请输入用户id");
  assert.equal(moduleZh.table.userId, "用户id");
  assert.equal(moduleZh.rules.userId, "用户id");
}

function testModuleDirRulesMessageAnchors() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-rules-anchor-"));
  const targetDir = path.join(tempDir, "project");
  const outputFile = path.join(tempDir, "i18n/zh.json");
  const pageDir = path.join(targetDir, "src/views/order/transactions");

  fs.mkdirSync(pageDir, { recursive: true });
  fs.writeFileSync(path.join(pageDir, "index.ts"), [
    "const rules = {",
    "  userId: [",
    "    { required: true, message: \"请选择用户\", trigger: \"blur\" }",
    "  ],",
    "  amount: { required: true, message: \"请输入金额\", trigger: \"blur\" }",
    "};"
  ].join("\n"), "utf8");

  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--structure", "module-dir"]);
  const moduleZh = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/order/transactions/zh.json"), "utf8"));

  assert.equal(moduleZh.rules.userId, "请选择用户");
  assert.equal(moduleZh.rules.amount, "请输入金额");
}

function testModuleDirRulesMessageFallback() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-rules-fallback-"));
  const targetDir = path.join(tempDir, "project");
  const outputFile = path.join(tempDir, "i18n/zh.json");
  const pageDir = path.join(targetDir, "src/views/order/transactions");

  fs.mkdirSync(pageDir, { recursive: true });
  fs.writeFileSync(path.join(pageDir, "index.ts"), [
    "const rules = {",
    "  amount: [",
    "    { required: true, message: \"请输入金额\", trigger: \"blur\" },",
    "    { validator: checkAmount, message: \"金额必须大于0\", trigger: \"blur\" }",
    "  ],",
    "  status: [",
    "    { required: true, message: flag ? \"启用\" : \"停用\", trigger: \"blur\" }",
    "  ]",
    "};"
  ].join("\n"), "utf8");

  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--structure", "module-dir"]);
  const moduleZh = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/order/transactions/zh.json"), "utf8"));
  const flattened = flattenNestedObject(moduleZh);
  const allValues = new Set(Object.values(flattened));

  assert.equal(allValues.has("请输入金额"), true);
  assert.equal(allValues.has("金额必须大于0"), true);
  assert.equal(moduleZh.rules.amount === "请输入金额" || moduleZh.rules.amount === "金额必须大于0", true);
  assert.equal(typeof moduleZh.auto_001, "string");
  assert.equal(moduleZh.rules.status, undefined);
}

function testModuleDirRulesMessagePreferAnchorOverAutoReuse() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-rules-prefer-anchor-"));
  const targetDir = path.join(tempDir, "project");
  const outputFile = path.join(tempDir, "i18n/zh.json");
  const pageDir = path.join(targetDir, "src/views/order/transactions");

  fs.mkdirSync(pageDir, { recursive: true });
  fs.writeFileSync(path.join(pageDir, "index.ts"), [
    "const rules = {",
    "  userId: [",
    "    { required: true, message: \"请选择用户\", trigger: \"blur\" }",
    "  ]",
    "};"
  ].join("\n"), "utf8");

  writeJson(path.join(tempDir, "i18n/order/transactions/zh.json"), {
    auto_005: "请选择用户"
  });

  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--structure", "module-dir"]);
  const moduleZh = JSON.parse(fs.readFileSync(path.join(tempDir, "i18n/order/transactions/zh.json"), "utf8"));

  assert.equal(moduleZh.rules.userId, "请选择用户");
  assert.equal(moduleZh.auto_005, "请选择用户");
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

function testTemplateTrailingSpaceReplacement() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-template-trailing-space-"));
  const targetDir = path.join(tempDir, "src");
  const outputFile = path.join(tempDir, "zh.json");
  const reportFile = path.join(tempDir, "replace-report.json");

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, "sample.vue"), [
    "<template>",
    "  <el-form-item label=\"订单id \">",
    "    <el-input placeholder=\"订单id \" />",
    "  </el-form-item>",
    "  <el-table-column label=\"订单id \" />",
    "</template>"
  ].join("\n"), "utf8");

  const output = runCli(["replace", "--dir", targetDir, "--output", outputFile, "--dry-run", "--report", reportFile], {
    withoutScriptRules: true
  });

  assert.match(output, /replaced: 3/);
  const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
  assert.equal(report.summary.replaceable_count, 3);
  assert.equal(report.summary.replaced_count, 3);
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
  assert.match(runOutput, /structure: module-dir（默认）/);
  assert.match(runOutput, /mode: merge（默认）/);
  assert.match(runOutput, /git-check: warn（默认）/);
  assert.match(runOutput, /你可以使用以下命令指定参数：/);
  assert.match(runOutput, /i18n run --dir .* --git-check strict/);
  assert.match(runOutput, /scan_count:/);
  assert.match(runOutput, /Planned 28 resource key\(s\)\./);
  assert.match(runOutput, /未修改资源文件。/);
  assert.match(runOutput, /Planned 41 replacement\(s\)\./);
  assert.match(runOutput, /活动标题不能为空/);
  assert.match(runOutput, /活动ID/);
  assert.match(runOutput, /Composite report written to/);

  const runReport = JSON.parse(fs.readFileSync(runReportFile, "utf8"));
  assert.equal(runReport.config.command, "run");
  assert.equal(runReport.config.structure, "module-dir");
  assert.equal(runReport.summary.scan.candidates_found, 41);
  assert.equal(runReport.summary.replace.replaced_count, 41);
  assert.equal(Array.isArray(runReport.details.replace), true);

  const applyOutput = runCli(["apply", "--dir", targetDir, "--output", outputFile, "--report", applyReportFile]);
  assert.match(applyOutput, /\[配置]/);
  assert.match(applyOutput, /Generated .*zh\.json with 28 key\(s\)\./);
  assert.match(applyOutput, /Applied 41 replacement\(s\)\./);
  assert.match(applyOutput, /Composite report written to/);

  const applyReport = JSON.parse(fs.readFileSync(applyReportFile, "utf8"));
  assert.equal(applyReport.config.command, "apply");
  assert.equal(applyReport.summary.extract.key_created_count, 28);
  assert.equal(applyReport.summary.replace.replaced_count, 41);
  assert.equal(typeof applyReport.summary.module_distribution, "object");

  const zhAfterFirstApply = snapshotResourceFiles(outputFile);
  const secondApplyOutput = runCli(["apply", "--dir", targetDir, "--output", outputFile]);
  const zhAfterSecondApply = snapshotResourceFiles(outputFile);
  assert.equal(zhAfterSecondApply, zhAfterFirstApply);
  assert.match(secondApplyOutput, /未发现可提取文本。/);
  assert.match(secondApplyOutput, /未修改资源文件。/);
  assert.match(secondApplyOutput, /Applied 0 replacement\(s\)\./);

  const zhBeforeRun = snapshotResourceFiles(outputFile);
  const runAfterApply = runCli(["run", "--dir", targetDir, "--output", outputFile]);
  const zhAfterRun = snapshotResourceFiles(outputFile);
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
  assert.match(replaceOutput, /sample\.vue:\d+[\s\S]*\{\{ \$t\("module\.auto_/);
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
  runCli(["extract", "--dir", targetDir, "--output", outputFile, "--report", extractReportFile, "--structure", "single"]);
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
  assert.equal(typeof replaceReport.summary.script_rules_enabled, "boolean");
  assert.equal(replaceReport.summary.script_rules_enabled, true);
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

function testHtmlReportCommand() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-html-report-"));
  const targetDir = path.join(tempDir, "realish");
  const outputFile = path.join(tempDir, "zh.json");
  const htmlReportFile = path.join(tempDir, "quality/i18n-report.html");
  const jsonReportFile = path.join(tempDir, "quality/i18n-report.json");

  fs.cpSync(path.join(workspace, "fixtures/realish"), targetDir, { recursive: true });

  runCli(["report", "--dir", targetDir, "--output", outputFile, "--report", htmlReportFile]);

  assert.equal(fs.existsSync(htmlReportFile), true);
  assert.equal(fs.existsSync(jsonReportFile), true);

  const html = fs.readFileSync(htmlReportFile, "utf8");
  const json = JSON.parse(fs.readFileSync(jsonReportFile, "utf8"));

  assert.match(html, /i18n 最小可用质量报告/);
  assert.match(html, /总览摘要/);
  assert.match(html, /冲突明细/);
  assert.match(html, /Auto 明细/);
  assert.equal(typeof json.summary.files_scanned, "number");
  assert.equal(typeof json.summary.hits_total, "number");
  assert.equal(typeof json.summary.auto_keys, "number");
  assert.equal(typeof json.summary.conflicts, "number");
  assert.equal(Array.isArray(json.conflicts), true);
  assert.equal(Array.isArray(json.autos), true);
  assert.equal(Array.isArray(json.rankings.auto_top_files), true);
}

function testReportApplyAlignmentAndSourceMode() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-report-align-"));
  const targetDir = path.join(tempDir, "realish");
  const outputFile = path.join(tempDir, "zh.json");
  const preHtmlFile = path.join(tempDir, "quality/pre-report.html");
  const preJsonFile = path.join(tempDir, "quality/pre-report.json");
  const applyReportFile = path.join(tempDir, "logs/apply-report.json");
  const sourceHtmlFile = path.join(tempDir, "quality/from-source.html");

  fs.cpSync(path.join(workspace, "fixtures/realish"), targetDir, { recursive: true });

  runCli(["report", "--dir", targetDir, "--output", outputFile, "--report", preHtmlFile]);
  runCli(["apply", "--dir", targetDir, "--output", outputFile, "--report", applyReportFile]);
  runCli(["report", "--dir", targetDir, "--output", outputFile, "--report-source", applyReportFile, "--report", sourceHtmlFile]);

  const pre = JSON.parse(fs.readFileSync(preJsonFile, "utf8"));
  const apply = JSON.parse(fs.readFileSync(applyReportFile, "utf8"));
  const sourceHtml = fs.readFileSync(sourceHtmlFile, "utf8");

  assert.equal(pre.summary.apply_preview_replaced_count, apply.summary.replace.replaced_count);
  assert.match(sourceHtml, /执行日志报告（source）/);
}

function testScriptRulesAreExplicit() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-script-explicit-"));
  const targetDir = path.join(tempDir, "src");
  const outputFile = path.join(tempDir, "zh.json");

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, "sample.ts"), [
    'this.title = "用户管理";',
    'this.$modal.msgSuccess("保存成功");',
    'const rules = [{ required: true, message: "请输入姓名", trigger: "blur" }];'
  ].join("\n"), "utf8");

  const noRulesOutput = runCli(["replace", "--dir", targetDir, "--output", outputFile, "--dry-run"], {
    withoutScriptRules: true
  });
  assert.match(noRulesOutput, /\[skip:script_unsupported] "用户管理"/);
  assert.match(noRulesOutput, /\[skip:script_unsupported] "保存成功"/);
  assert.doesNotMatch(noRulesOutput, /script_this_title/);
  assert.doesNotMatch(noRulesOutput, /modal_msg_success/);

  const withRulesOutput = runCli(["replace", "--dir", targetDir, "--output", outputFile, "--dry-run"]);
  assert.match(withRulesOutput, /t\("module\.auto_001"\)/);
  assert.match(withRulesOutput, /t\("module\.auto_002"\)/);

  const noRulesReportFile = path.join(tempDir, "no-rules.report.json");
  runCli(["replace", "--dir", targetDir, "--output", outputFile, "--dry-run", "--report", noRulesReportFile], {
    withoutScriptRules: true
  });
  const noRulesReport = JSON.parse(fs.readFileSync(noRulesReportFile, "utf8"));
  assert.equal(noRulesReport.summary.script_rules_enabled, false);
}

function testScriptRulesFileValidation() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-script-rule-invalid-"));
  const targetDir = path.join(tempDir, "src");
  const outputFile = path.join(tempDir, "zh.json");
  const badRulesFile = path.join(tempDir, "bad-rules.json");

  fs.mkdirSync(targetDir, { recursive: true });
  fs.writeFileSync(path.join(targetDir, "sample.ts"), 'this.title = "用户管理";\n', "utf8");
  fs.writeFileSync(badRulesFile, JSON.stringify({ scriptRules: [{ id: "bad", type: "call", callee: "this.$modal.msgSuccess" }] }, null, 2), "utf8");

  const result = runCliRaw(["scan", "--dir", targetDir, "--script-rules", badRulesFile], false);
  assert.equal(result.status, 4);
  assert.match(result.stderr, /Invalid script rules/);
}

function testInitScriptRulesCommand() {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), "i18n-init-rules-"));
  const outFile = path.join(tempDir, "i18n/script-rules.json");
  const aliasOutFile = path.join(tempDir, "alias/i18n/script-rules.json");
  const positionalOutFile = path.join(tempDir, "positional/i18n/script-rules.json");

  runCliRaw(["init-script-rules", "--out", outFile]);
  assert.equal(fs.existsSync(outFile), true);
  const generated = fs.readFileSync(outFile, "utf8");
  assert.match(generated, /^\/\/ i18n script rules template/);
  const parsed = parseScriptRulesWithComments(generated);
  assert.equal(Array.isArray(parsed.scriptRules), true);
  assert.equal(parsed.scriptRules.some((rule) => rule.type === "assignment"), true);
  assert.equal(parsed.scriptRules.some((rule) => rule.type === "call"), true);

  runCliRaw(["init", "--out", path.join(tempDir, "alias")]);
  assert.equal(fs.existsSync(aliasOutFile), true);

  runCliRaw(["init", path.join(tempDir, "positional")]);
  assert.equal(fs.existsSync(positionalOutFile), true);
}

function testUsageExitCode() {
  const result = runCliRaw(["scan", "--report"], false);

  assert.equal(result.status, 2);
  assert.match(result.stderr, /Missing value for --report/);
}

function runCli(args, options = {}) {
  const withScriptRules = !options.withoutScriptRules && !args.includes("--script-rules") && !args.includes("init-script-rules");
  const finalArgs = withScriptRules ? [...args, "--script-rules", defaultScriptRulesFile] : args;

  return execFileSync("node", [cliPath, ...finalArgs], {
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

function snapshotResourceFiles(outputFile) {
  const rootDir = path.dirname(outputFile);
  const files = [];

  if (fs.existsSync(rootDir)) {
    const stack = [rootDir];
    while (stack.length > 0) {
      const current = stack.pop();
      for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
        const fullPath = path.join(current, entry.name);
        if (entry.isDirectory()) {
          stack.push(fullPath);
          continue;
        }
        if (entry.isFile() && entry.name === "zh.json") {
          files.push(fullPath);
        }
      }
    }
  }

  const snapshot = {};
  for (const filePath of files.sort()) {
    const relative = path.relative(rootDir, filePath);
    snapshot[relative] = fs.readFileSync(filePath, "utf8");
  }

  return JSON.stringify(snapshot, null, 2);
}

function flattenNestedObject(input, prefix = "", output = {}) {
  for (const [key, value] of Object.entries(input)) {
    const nextKey = prefix ? `${prefix}.${key}` : key;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      flattenNestedObject(value, nextKey, output);
    } else {
      output[nextKey] = value;
    }
  }
  return output;
}

function parseScriptRulesWithComments(content) {
  const lines = content
    .split("\n")
    .filter((line) => !line.trimStart().startsWith("//"));
  return JSON.parse(lines.join("\n"));
}
