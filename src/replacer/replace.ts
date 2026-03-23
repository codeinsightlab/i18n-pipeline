import fs from "node:fs";
import path from "node:path";
import { collectCommentRanges, isInCommentRanges } from "../core/comments.js";
import { collectSourceFiles } from "../core/files.js";
import { extractModulePrefix } from "../core/keygen.js";
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
import type { ExtractItem, ReplaceChange, ReplaceReport, ReplaceSkip, SkipReason } from "../core/types.js";

export function replaceProject(targetDir: string, entries: ExtractItem[], dryRun: boolean): ReplaceReport {
  const files = collectSourceFiles(targetDir);
  const textToKey = new Map(entries.map((entry) => [entry.text, entry.key]));
  const moduleTextToKey = new Map<string, Map<string, string>>();
  const changes: ReplaceChange[] = [];
  const skipped: ReplaceSkip[] = [];
  const unchangedFiles: string[] = [];

  for (const entry of entries) {
    // Phase 1 保持“模块内优先复用、全局兜底复用”的键查找顺序：
    // 先 modulePrefix+text，再退回 text 全局匹配；不改 key 生成策略，只控制查找口径。
    const scoped = moduleTextToKey.get(entry.modulePrefix) ?? new Map<string, string>();
    scoped.set(entry.text, entry.key);
    moduleTextToKey.set(entry.modulePrefix, scoped);
  }

  for (const filePath of files) {
    const source = fs.readFileSync(filePath, "utf8");
    const modulePrefix = extractModulePrefix(filePath, targetDir);
    const result = path.extname(filePath) === ".vue"
      ? replaceVueFile(filePath, source, modulePrefix, textToKey, moduleTextToKey, changes, skipped)
      : replaceJsLikeFile(filePath, source, modulePrefix, textToKey, moduleTextToKey, changes, skipped);

    if (!dryRun && result.changed) {
      fs.writeFileSync(filePath, result.content, "utf8");
    }

    if (!result.changed) {
      unchangedFiles.push(filePath);
    }
  }

  return {
    changes,
    skipped,
    skippedByReason: groupSkippedByReason(skipped),
    unchangedFiles
  };
}

function replaceJsLikeFile(
  filePath: string,
  content: string,
  modulePrefix: string,
  textToKey: Map<string, string>,
  moduleTextToKey: Map<string, Map<string, string>>,
  changes: ReplaceChange[],
  skipped: ReplaceSkip[],
  locationContent: string = content,
  locationOffset = 0
): { content: string; changed: boolean } {
  let changed = false;
  let cursor = 0;
  let nextContent = "";
  const commentRanges = collectCommentRanges(content, false);
  const controlledLiterals = collectControlledScriptLiterals(content);

  for (const match of content.matchAll(/`(?:\\.|[^`])*?[\u4e00-\u9fff]+(?:\\.|[^`])*?`/g)) {
    const start = match.index ?? 0;
    if (isInCommentRanges(start, commentRanges)) {
      continue;
    }
    skipped.push(
      buildSkip(
        filePath,
        locationContent,
        locationOffset + start,
        match[0],
        "template_string",
        "template_string",
        "template_string",
        false,
        false
      )
    );
  }

  for (const match of content.matchAll(CHINESE_STRING_LITERAL_RE)) {
    const raw = match[0];
    const text = match[2];
    const start = match.index ?? 0;
    const end = start + raw.length;
    if (isInCommentRanges(start, commentRanges)) {
      continue;
    }
    const controlled = controlledLiterals.get(start);
    const classification = controlled?.raw === raw
      ? controlled.classification
      : classifyJsLiteralMatch(content, start, raw);

    nextContent += content.slice(cursor, start);
    cursor = end;

    if (classification.skipReason) {
      // 不可替换候选仍要进入 skipped，保证 report 能看到“为什么没改”。
      nextContent += raw;
      skipped.push(
        buildSkip(
          filePath,
          locationContent,
          locationOffset + start,
          raw,
          classification.skipReason,
          classification.contextType,
          classification.matchedRule,
          classification.extractable,
          classification.replaceable
        )
      );
      continue;
    }

    const key = resolveKey(text, modulePrefix, textToKey, moduleTextToKey);

    if (!key) {
      nextContent += raw;
      continue;
    }

    changed = true;
    const replacement = `t("${key}")`;
    changes.push(
      buildChange(
        filePath,
        locationContent,
        locationOffset + start,
        raw,
        replacement,
        classification.contextType,
        classification.matchedRule,
        true,
        true
      )
    );
    nextContent += replacement;
  }

  nextContent += content.slice(cursor);

  return { content: nextContent, changed };
}

function replaceVueFile(
  filePath: string,
  content: string,
  modulePrefix: string,
  textToKey: Map<string, string>,
  moduleTextToKey: Map<string, Map<string, string>>,
  changes: ReplaceChange[],
  skipped: ReplaceSkip[]
): { content: string; changed: boolean } {
  let changed = false;
  const segmentUpdates: Array<{ start: number; end: number; next: string }> = [];

  const templateBlock = extractFirstVueBlock(content, "template");
  if (templateBlock) {
    const templateResult = replaceVueTemplateBlock(
      filePath,
      content,
      templateBlock.content,
      templateBlock.contentStart,
      modulePrefix,
      textToKey,
      moduleTextToKey,
      changes,
      skipped
    );

    if (templateResult.changed) {
      changed = true;
      segmentUpdates.push({
        start: templateBlock.contentStart,
        end: templateBlock.contentEnd,
        next: templateResult.content
      });
    }
  }

  for (const scriptBlock of extractAllVueBlocks(content, "script")) {
    // script 替换在块内执行，但 line 计算仍基于整文件偏移，确保 report 行号可直接回源文件定位。
    const scriptResult = replaceJsLikeFile(
      filePath,
      scriptBlock.content,
      modulePrefix,
      textToKey,
      moduleTextToKey,
      changes,
      skipped,
      content,
      scriptBlock.contentStart
    );

    if (!scriptResult.changed) {
      continue;
    }

    changed = true;
    segmentUpdates.push({
      start: scriptBlock.contentStart,
      end: scriptBlock.contentEnd,
      next: scriptResult.content
    });
  }

  if (!changed) {
    return { content, changed: false };
  }

  let nextContent = content;
  // 逆序回写避免前面片段长度变化影响后续片段偏移。
  for (const update of segmentUpdates.sort((a, b) => b.start - a.start)) {
    nextContent = `${nextContent.slice(0, update.start)}${update.next}${nextContent.slice(update.end)}`;
  }

  return { content: nextContent, changed: true };
}

function replaceVueTemplateBlock(
  filePath: string,
  fileContent: string,
  originalTemplate: string,
  templateStart: number,
  modulePrefix: string,
  textToKey: Map<string, string>,
  moduleTextToKey: Map<string, Map<string, string>>,
  changes: ReplaceChange[],
  skipped: ReplaceSkip[]
): { content: string; changed: boolean } {
  let changed = false;
  const initialCommentRanges = collectCommentRanges(originalTemplate, true);

  for (const match of originalTemplate.matchAll(VUE_ALREADY_I18N_RE)) {
    const start = match.index ?? 0;
    if (isInCommentRanges(start, initialCommentRanges)) {
      continue;
    }
    const classification = classifyAlreadyI18nTemplate();
    skipped.push(
      buildSkip(
        filePath,
        fileContent,
        templateStart + start,
        match[0],
        classification.skipReason ?? "already_i18n",
        classification.contextType,
        classification.matchedRule,
        classification.extractable,
        classification.replaceable
      )
    );
  }

  let replacedTemplate = originalTemplate.replace(SIMPLE_VUE_INTERPOLATION_RE, (raw, _quote: string, text: string, offset: number) => {
    if (isInCommentRanges(offset, initialCommentRanges)) {
      return raw;
    }

    const key = resolveKey(text.trim(), modulePrefix, textToKey, moduleTextToKey);

    if (!key) {
      return raw;
    }

    const classification = classifyTemplateInterpolation();
    changed = true;
    const absoluteOffset = templateStart + offset;
    const replacement = `{{ $t("${key}") }}`;
    changes.push(
      buildChange(
        filePath,
        fileContent,
        absoluteOffset,
        raw,
        replacement,
        classification.contextType,
        classification.matchedRule,
        classification.extractable,
        classification.replaceable
      )
    );
    return replacement;
  });

  const attributeCommentRanges = collectCommentRanges(replacedTemplate, true);
  // 属性替换阶段使用“当前模板内容”的注释范围，避免多阶段替换后偏移漂移导致统计不一致。
  replacedTemplate = replacedTemplate.replace(
    VUE_ATTRIBUTE_LITERAL_RE,
    (raw, prefix: string, attrName: string, _quote: string, text: string, offset: number) => {
      const start = offset + prefix.length;
      if (isInCommentRanges(start, attributeCommentRanges)) {
        return raw;
      }

      const tagName = resolveTemplateAttributeTagName(replacedTemplate, offset);
      const classification = classifyTemplateAttribute(attrName, tagName);

      if (!classification.replaceable) {
        skipped.push(
          buildSkip(
            filePath,
            fileContent,
            templateStart + start,
            raw.trimStart(),
            classification.skipReason ?? "template_unsupported",
            classification.contextType,
            classification.matchedRule,
            classification.extractable,
            classification.replaceable
          )
        );
        return raw;
      }

      const key = resolveKey(text.trim(), modulePrefix, textToKey, moduleTextToKey);

      if (!key) {
        return raw;
      }

      changed = true;
      const absoluteOffset = templateStart + offset + prefix.length;
      const replacement = `${prefix}:${attrName}="$t('${key}')"`;
      changes.push(
        buildChange(
          filePath,
          fileContent,
          absoluteOffset,
          raw.trimStart(),
          replacement.trimStart(),
          classification.contextType,
          classification.matchedRule,
          classification.extractable,
          classification.replaceable
        )
      );
      return replacement;
    }
  );

  const textCommentRanges = collectCommentRanges(replacedTemplate, true);
  // 文本替换阶段同样重算注释范围，保持 replaced_count 与 replaceable_count 口径一致。
  replacedTemplate = replacedTemplate.replace(
    VUE_TEXT_NODE_RE,
    (raw, boundary: string, textBlock: string, offset: number) => {
      const text = textBlock.trim();

      if (!text) {
        return raw;
      }

      const textStart = offset + boundary.length + textBlock.indexOf(text);
      if (isInCommentRanges(textStart, textCommentRanges)) {
        return raw;
      }

      const tagName = resolveTemplateTextTagName(replacedTemplate, textStart);
      const classification = classifyTemplateText(tagName);
      if (!classification.replaceable) {
        skipped.push(
          buildSkip(
            filePath,
            fileContent,
            templateStart + textStart,
            text,
            classification.skipReason ?? "template_unsupported",
            classification.contextType,
            classification.matchedRule,
            classification.extractable,
            classification.replaceable
          )
        );
        return raw;
      }

      const key = resolveKey(text, modulePrefix, textToKey, moduleTextToKey);
      if (!key) {
        return raw;
      }

      const leading = textBlock.match(/^\s*/)?.[0] ?? "";
      const trailing = textBlock.match(/\s*$/)?.[0] ?? "";
      changed = true;
      const absoluteOffset = templateStart + offset + boundary.length + leading.length;
      const replacementText = `${leading}{{ $t("${key}") }}${trailing}`;
      changes.push(
        buildChange(
          filePath,
          fileContent,
          absoluteOffset,
          text,
          `{{ $t("${key}") }}`,
          classification.contextType,
          classification.matchedRule,
          classification.extractable,
          classification.replaceable
        )
      );
      return `${boundary}${replacementText}`;
    }
  );

  if (!changed) {
    return { content: originalTemplate, changed: false };
  }
  return { content: replacedTemplate, changed: true };
}

function resolveKey(
  text: string,
  modulePrefix: string,
  textToKey: Map<string, string>,
  moduleTextToKey: Map<string, Map<string, string>>
): string | undefined {
  return moduleTextToKey.get(modulePrefix)?.get(text) ?? textToKey.get(text);
}

function buildChange(
  filePath: string,
  content: string,
  offset: number,
  original: string,
  replacement: string,
  contextType: ReplaceChange["contextType"],
  matchedRule: ReplaceChange["matchedRule"],
  extractable: boolean,
  replaceable: boolean
): ReplaceChange {
  const prefix = content.slice(0, offset);
  const lines = prefix.split("\n");

  return {
    filePath,
    line: lines.length,
    original,
    replacement,
    contextType,
    matchedRule,
    extractable,
    replaceable
  };
}

function buildSkip(
  filePath: string,
  content: string,
  offset: number,
  raw: string,
  reason: SkipReason,
  contextType: ReplaceSkip["contextType"],
  matchedRule: ReplaceSkip["matchedRule"],
  extractable: boolean,
  replaceable: boolean
): ReplaceSkip {
  const prefix = content.slice(0, offset);
  const lines = prefix.split("\n");

  return {
    filePath,
    line: lines.length,
    raw,
    reason,
    contextType,
    matchedRule,
    extractable,
    replaceable
  };
}

function groupSkippedByReason(skipped: ReplaceSkip[]): Partial<Record<SkipReason, number>> {
  const counts: Partial<Record<SkipReason, number>> = {};

  for (const item of skipped) {
    counts[item.reason] = (counts[item.reason] ?? 0) + 1;
  }

  return counts;
}

function resolveTemplateAttributeTagName(content: string, attrOffset: number): string | null {
  const lineStart = content.lastIndexOf("\n", attrOffset - 1) + 1;
  const linePrefix = content.slice(lineStart, attrOffset);
  const openTagMatch = linePrefix.match(/<([A-Za-z][\w-]*)\b[^>]*$/);
  return openTagMatch ? openTagMatch[1].toLowerCase() : null;
}
