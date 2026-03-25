import fs from "node:fs";
import path from "node:path";
import type { ScriptPatternType, ScriptRule } from "./types.js";

export interface ScriptRulesDocument {
  scriptRules: ScriptRule[];
}

export const SUPPORTED_SCRIPT_PATTERNS: ScriptPatternType[] = [
  "string_literal",
  "ternary_string",
  "concat_string_var_string"
];

export function createScriptRulesTemplateDocument(): ScriptRulesDocument {
  return {
    scriptRules: [
      {
        id: "assign_title",
        type: "assignment",
        target: "this.title",
        valuePatterns: ["string_literal"]
      },
      {
        id: "modal_msg_success",
        type: "call",
        callee: "this.$modal.msgSuccess",
        args: [
          { index: 0, patterns: ["string_literal", "ternary_string"] }
        ]
      },
      {
        id: "modal_confirm_concat",
        type: "call",
        callee: "this.$modal.confirm",
        args: [
          { index: 0, patterns: ["concat_string_var_string"] }
        ]
      }
    ]
  };
}

export function renderScriptRulesTemplateWithComments(): string {
  const header = [
    "// i18n script rules template",
    "//",
    "// 中文说明",
    "// 这个文件是可选的；即使不修改，下面的默认规则也可以直接使用。",
    "// 使用方式：",
    "// 1) 保留默认模板，或在 scriptRules 下编辑/新增规则。",
    "// 2) 运行命令时传入：--script-rules ./i18n/script-rules.json",
    "// 3) 即使不传这个文件，内置 rules.message 规则仍会生效。",
    "// 字段说明：",
    "// - id：规则唯一标识，会出现在 report.matched_rule。格式：/^[a-zA-Z][a-zA-Z0-9_]*$/",
    "// - type：规则类型，assignment | call",
    "// - target：assignment 必填，点路径标识符（例如 this.title）",
    "// - valuePatterns：assignment 必填，非空模式列表",
    "// - callee：call 必填，点路径标识符（例如 this.$modal.msgSuccess）",
    "// - args：call 必填，Phase 1 仅支持 1 个参数定义且 index=0",
    "// - args[0].patterns：非空模式列表",
    "// 支持的模式：",
    "// - string_literal：单个中文字符串字面量，例如 \"保存成功\"",
    "// - ternary_string：顶层三元字符串，例如 flag ? \"开启成功\" : \"关闭成功\"",
    "// - concat_string_var_string：顶层拼接字符串，例如 \"确认删除\" + id + \"吗\"",
    "//",
    "// English",
    "// This file is optional. If you do not edit it, defaults below already work.",
    "// How to use:",
    "// 1) Keep this default template, or edit/add rules under scriptRules.",
    "// 2) Run commands with: --script-rules ./i18n/script-rules.json",
    "// 3) Built-in rules.message still works even without this file.",
    "// Fields:",
    "// - id: unique rule id, appears in report.matched_rule. /^[a-zA-Z][a-zA-Z0-9_]*$/",
    "// - type: assignment | call",
    "// - target: required for assignment, dotted identifier path (e.g. this.title)",
    "// - valuePatterns: required for assignment, non-empty pattern list",
    "// - callee: required for call, dotted identifier path (e.g. this.$modal.msgSuccess)",
    "// - args: required for call, Phase 1 only supports exactly one item with index=0",
    "// - args[0].patterns: non-empty pattern list",
    "// Supported patterns:",
    "// - string_literal: \"保存成功\"",
    "// - ternary_string: flag ? \"开启成功\" : \"关闭成功\"",
    "// - concat_string_var_string: \"确认删除\" + id + \"吗\"",
    ""
  ].join("\n");

  return `${header}${JSON.stringify(createScriptRulesTemplateDocument(), null, 2)}\n`;
}

export function loadScriptRulesFromFile(filePath: string): ScriptRule[] {
  const absolutePath = path.resolve(filePath);
  let parsed: unknown;

  try {
    const raw = fs.readFileSync(absolutePath, "utf8");
    parsed = JSON.parse(stripJsonComments(raw));
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown parse error";
    throw new Error(`Invalid --script-rules file: ${absolutePath}. ${message}`);
  }

  return validateScriptRulesDocument(parsed, absolutePath).scriptRules;
}

export function validateScriptRulesDocument(input: unknown, source: string = "script-rules.json"): ScriptRulesDocument {
  if (!isObject(input)) {
    throw new Error(`Invalid script rules (${source}): root must be an object.`);
  }

  const { scriptRules } = input;

  if (!Array.isArray(scriptRules)) {
    throw new Error(`Invalid script rules (${source}): "scriptRules" must be an array.`);
  }

  const validatedRules: ScriptRule[] = [];
  const seenIds = new Set<string>();

  for (let index = 0; index < scriptRules.length; index += 1) {
    const rawRule = scriptRules[index];
    if (!isObject(rawRule)) {
      throw new Error(`Invalid script rules (${source}): scriptRules[${index}] must be an object.`);
    }

    const id = ensureRuleId(rawRule.id, source, index);
    if (seenIds.has(id)) {
      throw new Error(`Invalid script rules (${source}): duplicate rule id "${id}".`);
    }
    seenIds.add(id);

    const type = rawRule.type;
    if (type !== "assignment" && type !== "call") {
      throw new Error(
        `Invalid script rules (${source}): scriptRules[${index}].type must be "assignment" or "call".`
      );
    }

    if (type === "assignment") {
      const target = ensureDottedTarget(rawRule.target, source, index, "target");
      const valuePatterns = ensurePatternList(rawRule.valuePatterns, source, index, "valuePatterns");
      validatedRules.push({
        id,
        type: "assignment",
        target,
        valuePatterns
      });
      continue;
    }

    const callee = ensureDottedTarget(rawRule.callee, source, index, "callee");
    if (!Array.isArray(rawRule.args) || rawRule.args.length !== 1) {
      throw new Error(
        `Invalid script rules (${source}): scriptRules[${index}].args must contain exactly one arg definition.`
      );
    }

    const firstArg = rawRule.args[0];
    if (!isObject(firstArg)) {
      throw new Error(`Invalid script rules (${source}): scriptRules[${index}].args[0] must be an object.`);
    }

    if (firstArg.index !== 0) {
      throw new Error(
        `Invalid script rules (${source}): scriptRules[${index}].args[0].index must be 0 (Phase 1 only supports arg0).`
      );
    }

    const patterns = ensurePatternList(firstArg.patterns, source, index, "args[0].patterns");
    validatedRules.push({
      id,
      type: "call",
      callee,
      args: [
        { index: 0, patterns }
      ]
    });
  }

  return { scriptRules: validatedRules };
}

function ensureRuleId(value: unknown, source: string, index: number): string {
  if (typeof value !== "string" || !/^[a-zA-Z][a-zA-Z0-9_]*$/.test(value)) {
    throw new Error(
      `Invalid script rules (${source}): scriptRules[${index}].id must match /^[a-zA-Z][a-zA-Z0-9_]*$/.`
    );
  }

  return value;
}

function ensureDottedTarget(
  value: unknown,
  source: string,
  index: number,
  fieldName: "target" | "callee"
): string {
  if (typeof value !== "string" || !/^[A-Za-z_$][\w$]*(\.[A-Za-z_$][\w$]*)*$/.test(value)) {
    throw new Error(
      `Invalid script rules (${source}): scriptRules[${index}].${fieldName} must be a dotted identifier path.`
    );
  }

  return value;
}

function ensurePatternList(
  value: unknown,
  source: string,
  index: number,
  fieldName: string
): ScriptPatternType[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(
      `Invalid script rules (${source}): scriptRules[${index}].${fieldName} must be a non-empty array.`
    );
  }

  const patterns = value.map((item) => {
    if (item !== "string_literal" && item !== "ternary_string" && item !== "concat_string_var_string") {
      throw new Error(
        `Invalid script rules (${source}): unsupported pattern "${String(item)}". Allowed: ${SUPPORTED_SCRIPT_PATTERNS.join(", ")}.`
      );
    }

    return item;
  });

  return [...new Set(patterns)];
}

function isObject(value: unknown): value is Record<string, any> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function stripJsonComments(input: string): string {
  let result = "";
  let inString = false;
  let escaped = false;
  let inLineComment = false;
  let inBlockComment = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];
    const next = input[index + 1];

    if (inLineComment) {
      if (char === "\n") {
        inLineComment = false;
        result += char;
      }
      continue;
    }

    if (inBlockComment) {
      if (char === "*" && next === "/") {
        inBlockComment = false;
        index += 1;
      }
      continue;
    }

    if (inString) {
      result += char;
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        inString = false;
      }
      continue;
    }

    if (char === "\"") {
      inString = true;
      result += char;
      continue;
    }

    if (char === "/" && next === "/") {
      inLineComment = true;
      index += 1;
      continue;
    }

    if (char === "/" && next === "*") {
      inBlockComment = true;
      index += 1;
      continue;
    }

    result += char;
  }

  return result;
}
