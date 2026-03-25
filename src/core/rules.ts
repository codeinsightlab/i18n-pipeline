import type { ContextType, MatchedRule, ScriptPatternType, ScriptRule, SkipReason } from "./types.js";

export const CHINESE_STRING_LITERAL_RE = /(['"])((?:\\.|(?!\1).)*?[\u4e00-\u9fff]+(?:\\.|(?!\1).)*?)\1/g;
export const SIMPLE_VUE_INTERPOLATION_RE = /{{\s*(['"])([^'"\\\n]*[\u4e00-\u9fff]+[^'"\\\n]*)\1\s*}}/g;
export const VUE_ALREADY_I18N_RE = /{{\s*\$?t\(\s*(['"])([^'"\\\n]*[\u4e00-\u9fff]+[^'"\\\n]*)\1\s*\)\s*}}/g;
export const VUE_ATTRIBUTE_LITERAL_RE = /(^|[\s<])([A-Za-z][\w-]*)\s*=\s*(['"])([^'"\\\n]*[\u4e00-\u9fff]+[^'"\\\n]*)\3/gm;
export const VUE_TEXT_NODE_RE = /(^|>)([^<>{}\n]*[\u4e00-\u9fff]+[^<>{}\n]*)(?=<|$)/g;
// Phase 1 template 白名单：只收口到最小可控范围，非白名单统一进入 report + skip。
const TEMPLATE_ATTRIBUTE_WHITELIST = new Set(["label", "placeholder"]);
const TEMPLATE_TEXT_TAG_WHITELIST = new Set(["el-button"]);
export interface MatchClassification {
  contextType: ContextType;
  matchedRule: MatchedRule;
  extractable: boolean;
  replaceable: boolean;
  skipReason?: SkipReason;
}

export interface ControlledScriptLiteral {
  start: number;
  raw: string;
  classification: MatchClassification;
}

export function classifyJsLiteral(content: string, start: number, raw: string): SkipReason | null {
  return classifyJsLiteralMatch(content, start, raw).skipReason ?? null;
}

export function collectControlledScriptLiterals(content: string, scriptRules: ScriptRule[] = []): Map<number, ControlledScriptLiteral> {
  const controlled = new Map<number, ControlledScriptLiteral>();

  // 受控表达式由外部规则声明驱动：
  // 内核只做固定 pattern 匹配与替换，不承载业务默认规则。
  for (const rule of scriptRules) {
    collectRuleControlledLiterals(content, rule, controlled);
  }

  return controlled;
}

export function classifyJsLiteralMatch(content: string, start: number, raw: string): MatchClassification {
  // template string 一律跳过，避免误替换插值模板导致运行时语义变化。
  if (raw.includes("${")) {
    return buildSkippedClassification("template_string", "template_string", "template_string");
  }

  if (isInsideLineComment(content, start) || isInsideBlockComment(content, start)) {
    return buildSkippedClassification("comment", "script_unsupported_generic", "unsafe_skip");
  }

  if (hasI18nPrefix(content, start)) {
    return buildSkippedClassification("already_i18n", "already_i18n", "unsafe_skip");
  }

  if (isConsoleCall(content, start)) {
    return buildSkippedClassification("console_call", "console_call", "unsafe_skip");
  }

  if (isObjectKey(content, start, raw.length)) {
    return buildSkippedClassification("object_key", "object_key", "unsafe_skip");
  }

  if (isRulesMessage(content, start)) {
    // 白名单：rules 中 message。
    return buildAllowedClassification("script_rules_message", "js_string");
  }

  if (isConfirmConcatCall(content, start, raw.length)) {
    // 兼容历史报告：无法安全替换的 confirm 拼接，明确打特定 matched_rule 供人工筛查。
    return buildSkippedClassification("script_unsupported", "script_unsupported_confirm_concat", "unsafe_skip");
  }

  return buildSkippedClassification("script_unsupported", "script_unsupported_generic", "unsafe_skip");
}

export function hasI18nPrefix(content: string, start: number): boolean {
  const before = content.slice(Math.max(0, start - 30), start);
  return /(?:^|[^\w$])\$?t\s*\(\s*$/.test(before);
}

function isInsideLineComment(content: string, start: number): boolean {
  const lineStart = content.lastIndexOf("\n", start - 1) + 1;
  const linePrefix = content.slice(lineStart, start);
  return linePrefix.trimStart().startsWith("//");
}

function isInsideBlockComment(content: string, start: number): boolean {
  const before = content.slice(0, start);
  const openIndex = before.lastIndexOf("/*");
  const closeIndex = before.lastIndexOf("*/");
  return openIndex > closeIndex;
}

function isConsoleCall(content: string, start: number): boolean {
  const lineStart = content.lastIndexOf("\n", start - 1) + 1;
  const linePrefix = content.slice(lineStart, start).trimStart();
  return /^console\./.test(linePrefix);
}

function isObjectKey(content: string, start: number, rawLength: number): boolean {
  const suffix = content.slice(start + rawLength).trimStart();
  return suffix.startsWith(":");
}

export function isWhitelistedTemplateAttribute(attrName: string): boolean {
  return TEMPLATE_ATTRIBUTE_WHITELIST.has(attrName.toLowerCase());
}

export function classifyTemplateAttribute(attrName: string, tagName: string | null): MatchClassification {
  const normalizedAttr = attrName.toLowerCase();
  const normalizedTag = tagName?.toLowerCase() ?? null;

  if (normalizedAttr === "label" && normalizedTag === "el-table-column") {
    return buildAllowedClassification("template_el_table_column_label", "template_attr_static");
  }

  if (normalizedAttr === "label") {
    return buildAllowedClassification("template_label_attr", "template_attr_static");
  }

  if (normalizedAttr === "placeholder") {
    return buildAllowedClassification("template_placeholder_attr", "template_attr_static");
  }

  if (normalizedAttr === "title") {
    // 明确保留“可见但不替换”：title/alt 典型高频，便于覆盖率评估时单独观察。
    return buildSkippedClassification("template_unsupported", "template_unsupported_attr_title", "template_attr_static");
  }

  if (normalizedAttr === "alt") {
    return buildSkippedClassification("template_unsupported", "template_unsupported_attr_alt", "template_attr_static");
  }

  return buildSkippedClassification("template_unsupported", "template_unsupported_attr_other", "template_attr_static");
}

export function resolveTemplateTextTagName(content: string, textStart: number): string | null {
  const before = content.slice(0, textStart);
  const openTagMatch = before.match(/<([A-Za-z][\w-]*)\b[^>]*>\s*$/);
  return openTagMatch ? openTagMatch[1].toLowerCase() : null;
}

export function isWhitelistedTemplateTextTag(tagName: string | null): boolean {
  return Boolean(tagName && TEMPLATE_TEXT_TAG_WHITELIST.has(tagName));
}

export function classifyTemplateText(tagName: string | null): MatchClassification {
  if (isWhitelistedTemplateTextTag(tagName)) {
    return buildAllowedClassification("template_el_button_text", "template_text_static");
  }

  return buildSkippedClassification("template_unsupported", "template_unsupported_text", "template_text_static");
}

export function classifyTemplateInterpolation(): MatchClassification {
  return buildAllowedClassification("template_interpolation", "template_expr");
}

export function classifyAlreadyI18nTemplate(): MatchClassification {
  return buildSkippedClassification("already_i18n", "already_i18n", "template_expr");
}

function isRulesMessage(content: string, start: number): boolean {
  const before = content.slice(Math.max(0, start - 120), start);
  const after = content.slice(start, Math.min(content.length, start + 200));

  // message 需要同时满足“键位形态 + rules 语义邻域”，降低普通对象 message 误命中概率。
  if (!/\bmessage\s*:\s*$/.test(before)) {
    return false;
  }

  return /\b(trigger|required|validator|pattern|min|max|type)\s*:/.test(after) || /\brules\b/.test(before);
}

function isConfirmConcatCall(content: string, start: number, rawLength: number): boolean {
  const before = content.slice(Math.max(0, start - 80), start);
  const after = content.slice(start + rawLength, Math.min(content.length, start + rawLength + 120));

  return (
    /(?:^|[^\w$.])(?:window\.)?confirm\(\s*$/.test(before) ||
    /(?:^|[^\w$.])this\.\$modal\.confirm\(\s*$/.test(before)
  ) && /^\s*\+/.test(after);
}

function buildAllowedClassification(matchedRule: MatchedRule, contextType: ContextType): MatchClassification {
  return {
    contextType,
    matchedRule,
    extractable: true,
    replaceable: true
  };
}

function buildSkippedClassification(
  skipReason: SkipReason,
  matchedRule: MatchedRule,
  contextType: ContextType
): MatchClassification {
  return {
    contextType,
    matchedRule,
    extractable: false,
    replaceable: false,
    skipReason
  };
}

function collectRuleControlledLiterals(
  content: string,
  rule: ScriptRule,
  controlled: Map<number, ControlledScriptLiteral>
): void {
  if (rule.type === "assignment") {
    collectAssignmentControlledLiterals(content, rule, controlled);
  } else {
    collectCallControlledLiterals(content, rule, controlled);
  }
}

function collectCallControlledLiterals(
  content: string,
  rule: Extract<ScriptRule, { type: "call" }>,
  controlled: Map<number, ControlledScriptLiteral>
): void {
  const argRule = rule.args[0];
  if (!argRule || argRule.index !== 0) {
    return;
  }

  const callPattern = buildCallPattern(rule.callee);

  // callee 采用精确匹配；Phase 1 不支持模糊匹配/别名解析，优先保障可解释性。
  for (const match of content.matchAll(callPattern)) {
    const body = match[1] ?? "";
    const bodyOffset = (match.index ?? 0) + match[0].indexOf(body);
    for (const pattern of argRule.patterns) {
      const literals = collectPatternLiterals(body, bodyOffset, rule.id, pattern);

      for (const literal of literals) {
        controlled.set(literal.start, literal);
      }
    }
  }
}

function collectAssignmentControlledLiterals(
  content: string,
  rule: Extract<ScriptRule, { type: "assignment" }>,
  controlled: Map<number, ControlledScriptLiteral>
): void {
  const assignmentPattern = buildAssignmentPattern(rule.target);

  for (const match of content.matchAll(assignmentPattern)) {
    const body = match[1] ?? "";
    const bodyOffset = (match.index ?? 0) + match[0].indexOf(body);
    for (const pattern of rule.valuePatterns) {
      const literals = collectPatternLiterals(body, bodyOffset, rule.id, pattern);

      for (const literal of literals) {
        controlled.set(literal.start, literal);
      }
    }
  }
}

function collectPatternLiterals(
  body: string,
  bodyOffset: number,
  matchedRule: ScriptRule["id"],
  pattern: ScriptPatternType
): ControlledScriptLiteral[] {
  if (pattern === "string_literal") {
    const trimmed = trimRange(body, 0, body.length);
    const literal = parseChineseStringLiteral(body.slice(trimmed.start, trimmed.end));

    if (!literal) {
      return [];
    }

    return [{
      start: bodyOffset + trimmed.start,
      raw: literal.raw,
      classification: buildAllowedClassification(matchedRule, "js_string")
    }];
  }

  if (pattern === "ternary_string") {
    // 仅支持 condition ? "中文" : "中文"，且两侧不得再拼接。
    const parsed = parseTopLevelTernary(body);

    if (!parsed) {
      return [];
    }

    const trueRaw = body.slice(parsed.trueStart, parsed.trueEnd);
    const falseRaw = body.slice(parsed.falseStart, parsed.falseEnd);
    const trueLiteral = parseChineseStringLiteral(trueRaw);
    const falseLiteral = parseChineseStringLiteral(falseRaw);

    if (!trueLiteral || !falseLiteral) {
      return [];
    }

    if (containsTopLevelOperator(trueRaw, "+") || containsTopLevelOperator(falseRaw, "+")) {
      return [];
    }

    return [
      {
        start: bodyOffset + parsed.trueStart,
        raw: trueLiteral.raw,
        classification: buildAllowedClassification(matchedRule, "js_string")
      },
      {
        start: bodyOffset + parsed.falseStart,
        raw: falseLiteral.raw,
        classification: buildAllowedClassification(matchedRule, "js_string")
      }
    ];
  }

  if (pattern === "concat_string_var_string") {
    // 仅支持 2/3 段顶层 + 拼接（常见 confirm 文案），超边界直接返回空让上层 skip。
    const parts = splitTopLevelByOperator(body, "+");

    if (parts.length < 2 || parts.length > 3) {
      return [];
    }

    const parsedParts = parts.map((part) => {
      const trimmedBounds = trimRange(body, part.start, part.end);
      const trimmed = body.slice(trimmedBounds.start, trimmedBounds.end);

      return {
        ...part,
        trimmedStart: trimmedBounds.start,
        trimmedEnd: trimmedBounds.end,
        trimmed,
        literal: parseChineseStringLiteral(trimmed)
      };
    });

    const allowed =
      (parsedParts.length === 2 && isConfirmTwoPartPattern(parsedParts)) ||
      (parsedParts.length === 3 && isConfirmThreePartPattern(parsedParts));

    if (!allowed) {
      return [];
    }

    return parsedParts
      .filter((part) => Boolean(part.literal))
      .map((part) => ({
        start: bodyOffset + part.trimmedStart,
        raw: part.literal?.raw ?? "",
        classification: buildAllowedClassification(matchedRule, "js_string")
      }));
  }

  return [];
}

function parseTopLevelTernary(expression: string): {
  trueStart: number;
  trueEnd: number;
  falseStart: number;
  falseEnd: number;
} | null {
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let depth = 0;
  let questionIndex = -1;
  let colonIndex = -1;

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth > 0) {
      continue;
    }

    if (char === "?") {
      if (questionIndex >= 0) {
        return null;
      }
      questionIndex = index;
      continue;
    }

    if (char === ":" && questionIndex >= 0) {
      if (colonIndex >= 0) {
        return null;
      }
      colonIndex = index;
    }
  }

  if (questionIndex < 0 || colonIndex < 0) {
    return null;
  }

  const condition = expression.slice(0, questionIndex).trim();
  const trueBranch = expression.slice(questionIndex + 1, colonIndex).trim();
  const falseBranch = expression.slice(colonIndex + 1).trim();

  if (!condition || !trueBranch || !falseBranch) {
    return null;
  }

  if (condition.includes("?") || trueBranch.includes("?") || falseBranch.includes("?")) {
    return null;
  }

  if (trueBranch.includes(":") || falseBranch.includes(":")) {
    return null;
  }

  const trueBounds = trimRange(expression, questionIndex + 1, colonIndex);
  const falseBounds = trimRange(expression, colonIndex + 1, expression.length);

  return {
    trueStart: trueBounds.start,
    trueEnd: trueBounds.end,
    falseStart: falseBounds.start,
    falseEnd: falseBounds.end
  };
}

function splitTopLevelByOperator(expression: string, operator: "+" | ":"): Array<{ start: number; end: number }> {
  const parts: Array<{ start: number; end: number }> = [];
  let quote: "'" | '"' | null = null;
  let escaped = false;
  let depth = 0;
  let partStart = 0;

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0 && char === operator) {
      parts.push({ start: partStart, end: index });
      partStart = index + 1;
    }
  }

  parts.push({ start: partStart, end: expression.length });
  return parts;
}

function containsTopLevelOperator(expression: string, operator: "+" | ":" | "?"): boolean {
  if (operator === "+" || operator === ":") {
    return splitTopLevelByOperator(expression, operator).length > 1;
  }

  let quote: "'" | '"' | null = null;
  let escaped = false;
  let depth = 0;

  for (let index = 0; index < expression.length; index += 1) {
    const char = expression[index];

    if (quote) {
      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === quote) {
        quote = null;
      }
      continue;
    }

    if (char === "'" || char === '"') {
      quote = char;
      continue;
    }

    if (char === "(") {
      depth += 1;
      continue;
    }

    if (char === ")") {
      depth = Math.max(0, depth - 1);
      continue;
    }

    if (depth === 0 && char === "?") {
      return true;
    }
  }

  return false;
}

function parseChineseStringLiteral(raw: string): { raw: string } | null {
  if (!/^(['"])(?:\\.|(?!\1).)*[\u4e00-\u9fff]+(?:\\.|(?!\1).)*\1$/.test(raw)) {
    return null;
  }

  return { raw };
}

function isSimpleExpression(raw: string): boolean {
  const trimmed = raw.trim();

  if (!trimmed) {
    return false;
  }

  if (parseChineseStringLiteral(trimmed)) {
    return false;
  }

  return !trimmed.includes("?") && !containsTopLevelOperator(trimmed, "+") && !trimmed.includes(":");
}

function isConfirmTwoPartPattern(
  parts: Array<{ trimmed: string; literal: { raw: string } | null }>
): boolean {
  const [first, second] = parts;

  return (Boolean(first.literal) && isSimpleExpression(second.trimmed)) ||
    (isSimpleExpression(first.trimmed) && Boolean(second.literal));
}

function isConfirmThreePartPattern(
  parts: Array<{ trimmed: string; literal: { raw: string } | null }>
): boolean {
  const [first, second, third] = parts;

  return Boolean(first.literal) && isSimpleExpression(second.trimmed) && Boolean(third.literal);
}

function trimRange(expression: string, start: number, end: number): { start: number; end: number } {
  let nextStart = start;
  let nextEnd = end;

  while (nextStart < nextEnd && /\s/.test(expression[nextStart] ?? "")) {
    nextStart += 1;
  }

  while (nextEnd > nextStart && /\s/.test(expression[nextEnd - 1] ?? "")) {
    nextEnd -= 1;
  }

  return { start: nextStart, end: nextEnd };
}

function buildCallPattern(callee: string): RegExp {
  const escaped = callee
    .split(".")
    .map((segment) => escapeRegex(segment))
    .join("\\s*\\.\\s*");

  return new RegExp(`${escaped}\\(\\s*([^)]*?)\\s*\\)`, "g");
}

function buildAssignmentPattern(target: string): RegExp {
  const escaped = target
    .split(".")
    .map((segment) => escapeRegex(segment))
    .join("\\s*\\.\\s*");

  return new RegExp(`${escaped}\\s*=\\s*([^;\\n]+)`, "g");
}

function escapeRegex(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
