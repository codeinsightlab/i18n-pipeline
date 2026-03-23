export interface VueBlock {
  tagName: string;
  start: number;
  contentStart: number;
  contentEnd: number;
  end: number;
  content: string;
  startLine: number;
}

export function extractFirstVueBlock(content: string, tagName: string): VueBlock | null {
  return extractAllVueBlocks(content, tagName)[0] ?? null;
}

export function extractAllVueBlocks(content: string, tagName: string): VueBlock[] {
  // 这里不用正则的最短匹配直接取块，原因是 .vue 里常见内层 <template>（如 slot-scope）会导致提前截断。
  // 采用同名标签深度计数，保证拿到“外层完整块”，这是 Phase 1 扫描/替换稳定性的关键前提。
  const normalizedTag = tagName.toLowerCase();
  const openTagRe = new RegExp(`<${normalizedTag}\\b[^>]*>`, "gi");
  const closeTagRe = new RegExp(`</${normalizedTag}\\s*>`, "gi");
  const blocks: VueBlock[] = [];

  let cursor = 0;
  while (true) {
    openTagRe.lastIndex = cursor;
    const openMatch = openTagRe.exec(content);
    if (!openMatch || openMatch.index === undefined) {
      break;
    }

    const openStart = openMatch.index;
    const openEnd = openTagRe.lastIndex;
    let depth = 1;
    let searchCursor = openEnd;
    let closeStart = -1;
    let closeEnd = -1;

    while (depth > 0) {
      openTagRe.lastIndex = searchCursor;
      const nextOpen = openTagRe.exec(content);
      const nextOpenStart = nextOpen?.index ?? Number.POSITIVE_INFINITY;
      const nextOpenEnd = nextOpen ? openTagRe.lastIndex : -1;

      closeTagRe.lastIndex = searchCursor;
      const nextClose = closeTagRe.exec(content);
      if (!nextClose || nextClose.index === undefined) {
        // 模板不闭合时不抛错：返回已成功提取的块，避免整次扫描被单文件语法噪音阻断。
        return blocks;
      }
      const nextCloseStart = nextClose.index;
      const nextCloseEnd = closeTagRe.lastIndex;

      if (nextOpenStart < nextCloseStart) {
        depth += 1;
        searchCursor = nextOpenEnd;
        continue;
      }

      depth -= 1;
      searchCursor = nextCloseEnd;
      if (depth === 0) {
        closeStart = nextCloseStart;
        closeEnd = nextCloseEnd;
      }
    }

    if (closeStart < 0 || closeEnd < 0) {
      break;
    }

    const prefix = content.slice(0, openStart);
    blocks.push({
      tagName: normalizedTag,
      start: openStart,
      contentStart: openEnd,
      contentEnd: closeStart,
      end: closeEnd,
      content: content.slice(openEnd, closeStart),
      startLine: prefix.split("\n").length - 1
    });
    cursor = closeEnd;
  }

  return blocks;
}
