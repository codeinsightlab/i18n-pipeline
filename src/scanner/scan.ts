import fs from "node:fs";
import path from "node:path";
import { collectSourceFiles } from "../core/files.js";
import { collectCommentRanges, isInCommentRanges } from "../core/comments.js";
import { extractAllVueBlocks, extractFirstVueBlock } from "../core/vue-blocks.js";
import {
  CHINESE_STRING_LITERAL_RE,
  SIMPLE_VUE_INTERPOLATION_RE,
  VUE_ALREADY_I18N_RE,
  VUE_ATTRIBUTE_LITERAL_RE,
  VUE_TEXT_NODE_RE,
  classifyAlreadyI18nTemplate,
  classifyJsLiteralMatch,
  classifyTemplateAttribute,
  classifyTemplateInterpolation,
  classifyTemplateText,
  collectControlledScriptLiterals,
  resolveTemplateTextTagName
} from "../core/rules.js";
import type { ScanMatch, ScriptRule } from "../core/types.js";

export function scanProject(targetDir: string, scriptRules: ScriptRule[] = []): ScanMatch[] {
  const files = collectSourceFiles(targetDir);
  const matches: ScanMatch[] = [];

  for (const filePath of files) {
    const content = fs.readFileSync(filePath, "utf8");
    if (path.extname(filePath) === ".vue") {
      // Phase 1 的 .vue 处理是“template + script 双通道”：
      // template 走模板白名单；script 复用 JS 字面量分类器。
      // 这样 report 可以完整体现候选来源，便于真实页面验收。
      const template = extractFirstVueBlock(content, "template");

      if (template) {
        matches.push(...scanVueTemplate(filePath, template.content, template.startLine));
      }

      const scripts = extractAllVueBlocks(content, "script");
      for (const scriptBlock of scripts) {
        matches.push(...scanContentForLiterals(filePath, scriptBlock.content, scriptBlock.startLine, scriptRules));
      }

      continue;
    }

    matches.push(...scanContentForLiterals(filePath, content, 0, scriptRules));
  }

  return matches;
}

export function scanContentForLiterals(filePath: string, content: string, lineOffset: number, scriptRules: ScriptRule[] = []): ScanMatch[] {
  const matches: ScanMatch[] = [];
  const commentRanges = collectCommentRanges(content, false);
  // 受控表达式（msgSuccess 三元 / confirm 拼接）先做“模板级定位”，
  // 后续按字符串起始偏移直接命中，避免在 classify 阶段重复解析整段表达式。
  const controlledLiterals = collectControlledScriptLiterals(content, scriptRules);

  for (const match of content.matchAll(/`(?:\\.|[^`])*?[\u4e00-\u9fff]+(?:\\.|[^`])*?`/g)) {
    const raw = match[0];
    const start = match.index ?? 0;
    if (isInCommentRanges(start, commentRanges)) {
      continue;
    }
    const location = calculateLocation(content, start);
    matches.push({
      filePath,
      line: location.line + lineOffset,
      column: location.column,
      text: raw,
      quote: '"',
      raw,
      matchedRule: "template_string",
      contextType: "template_string",
      extractable: false,
      replaceable: false,
      skipReason: "template_string"
    });
  }

  for (const match of content.matchAll(CHINESE_STRING_LITERAL_RE)) {
    const raw = match[0];
    const text = match[2];
    const start = match.index ?? 0;
    if (isInCommentRanges(start, commentRanges)) {
      continue;
    }
    const controlled = controlledLiterals.get(start);
    // 先尝试命中受控模板；命不中再走通用分类器（rules.message / this.title / unsupported ...）
    const classification = controlled?.raw === raw
      ? controlled.classification
      : classifyJsLiteralMatch(content, start, raw);
    const location = calculateLocation(content, start);

    matches.push({
      filePath,
      line: location.line + lineOffset,
      column: location.column,
      text,
      quote: raw[0] as "'" | '"',
      raw,
      contextType: classification.contextType,
      matchedRule: classification.matchedRule,
      extractable: classification.extractable,
      replaceable: classification.replaceable,
      skipReason: classification.skipReason
    });
  }

  return matches;
}

function scanVueTemplate(filePath: string, content: string, lineOffset: number): ScanMatch[] {
  const matches: ScanMatch[] = [];
  // 模板注释必须先剔除，否则常见“示例注释中文”会污染统计并误导人工审查。
  const commentRanges = collectCommentRanges(content, true);

  for (const match of content.matchAll(VUE_ALREADY_I18N_RE)) {
    const raw = match[0];
    const text = match[2];
    const start = match.index ?? 0;
    if (isInCommentRanges(start, commentRanges)) {
      continue;
    }
    const location = calculateLocation(content, start);

    const classification = classifyAlreadyI18nTemplate();

    matches.push({
      filePath,
      line: location.line + lineOffset,
      column: location.column,
      text,
      quote: raw.includes("'") ? "'" : '"',
      raw,
      contextType: classification.contextType,
      matchedRule: classification.matchedRule,
      extractable: classification.extractable,
      replaceable: classification.replaceable,
      skipReason: classification.skipReason
    });
  }

  for (const match of content.matchAll(SIMPLE_VUE_INTERPOLATION_RE)) {
    const raw = match[0];
    const text = match[2];
    const start = match.index ?? 0;
    if (isInCommentRanges(start, commentRanges)) {
      continue;
    }
    const location = calculateLocation(content, start);

    const classification = classifyTemplateInterpolation();

    matches.push({
      filePath,
      line: location.line + lineOffset,
      column: location.column,
      text,
      quote: raw.includes("'") ? "'" : '"',
      raw,
      contextType: classification.contextType,
      matchedRule: classification.matchedRule,
      extractable: classification.extractable,
      replaceable: classification.replaceable
    });
  }

  for (const match of content.matchAll(VUE_ATTRIBUTE_LITERAL_RE)) {
    const raw = match[0];
    const attrName = match[2];
    const text = match[4];
    const start = (match.index ?? 0) + match[1].length;
    if (isInCommentRanges(start, commentRanges)) {
      continue;
    }
    const location = calculateLocation(content, start);
    const tagName = resolveTemplateAttributeTagName(content, match.index ?? 0);
    const classification = classifyTemplateAttribute(attrName, tagName);

    matches.push({
      filePath,
      line: location.line + lineOffset,
      column: location.column,
      text,
      quote: raw.includes("'") ? "'" : '"',
      raw,
      contextType: classification.contextType,
      matchedRule: classification.matchedRule,
      extractable: classification.extractable,
      replaceable: classification.replaceable,
      skipReason: classification.skipReason
    });
  }

  const strippedTemplate = content.replace(/{{[\s\S]*?}}/g, "");
  // 文本节点扫描前先移除插值，避免把 {{ ... }} 的内部字符串重复计入 template_text。
  for (const match of strippedTemplate.matchAll(VUE_TEXT_NODE_RE)) {
    const rawText = match[2];
    const text = rawText.trim();

    if (!text) {
      continue;
    }

    const start = (match.index ?? 0) + match[1].length + rawText.indexOf(text);
    if (isInCommentRanges(start, commentRanges)) {
      continue;
    }
    const location = calculateLocation(strippedTemplate, start);
    const tagName = resolveTemplateTextTagName(strippedTemplate, start);
    const classification = classifyTemplateText(tagName);

    matches.push({
      filePath,
      line: location.line + lineOffset,
      column: location.column,
      text,
      quote: '"',
      raw: rawText,
      contextType: classification.contextType,
      matchedRule: classification.matchedRule,
      extractable: classification.extractable,
      replaceable: classification.replaceable,
      skipReason: classification.skipReason
    });
  }

  return matches;
}

function calculateLocation(content: string, index: number): { line: number; column: number } {
  const prefix = content.slice(0, index);
  const lines = prefix.split("\n");

  return {
    line: lines.length,
    column: (lines[lines.length - 1]?.length ?? 0) + 1
  };
}

function resolveTemplateAttributeTagName(content: string, attrStart: number): string | null {
  const lineStart = content.lastIndexOf("\n", attrStart - 1) + 1;
  const linePrefix = content.slice(lineStart, attrStart);
  const openTagMatch = linePrefix.match(/<([A-Za-z][\w-]*)\b[^>]*$/);
  return openTagMatch ? openTagMatch[1].toLowerCase() : null;
}
