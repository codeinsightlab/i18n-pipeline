export interface CommentRange {
  start: number;
  end: number;
  kind: "line_comment" | "block_comment" | "html_comment";
}

export function collectCommentRanges(content: string, includeHtmlComments: boolean): CommentRange[] {
  const ranges = collectScriptCommentRanges(content);

  if (!includeHtmlComments) {
    return ranges;
  }

  for (const match of content.matchAll(/<!--[\s\S]*?-->/g)) {
    const start = match.index ?? 0;
    ranges.push({
      start,
      end: start + match[0].length,
      kind: "html_comment"
    });
  }

  return ranges.sort((left, right) => left.start - right.start);
}

export function isInCommentRanges(position: number, ranges: CommentRange[]): boolean {
  return ranges.some((range) => position >= range.start && position < range.end);
}

function collectScriptCommentRanges(content: string): CommentRange[] {
  const ranges: CommentRange[] = [];
  let index = 0;
  let state: "normal" | "single_quote" | "double_quote" | "template_string" = "normal";

  while (index < content.length) {
    const char = content[index];
    const next = content[index + 1];

    if (state === "single_quote") {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === "'") {
        state = "normal";
      }
      index += 1;
      continue;
    }

    if (state === "double_quote") {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === "\"") {
        state = "normal";
      }
      index += 1;
      continue;
    }

    if (state === "template_string") {
      if (char === "\\") {
        index += 2;
        continue;
      }
      if (char === "`") {
        state = "normal";
      }
      index += 1;
      continue;
    }

    if (char === "'" ) {
      state = "single_quote";
      index += 1;
      continue;
    }

    if (char === "\"") {
      state = "double_quote";
      index += 1;
      continue;
    }

    if (char === "`") {
      state = "template_string";
      index += 1;
      continue;
    }

    if (char === "/" && next === "/") {
      const start = index;
      index += 2;
      while (index < content.length && content[index] !== "\n") {
        index += 1;
      }
      ranges.push({ start, end: index, kind: "line_comment" });
      continue;
    }

    if (char === "/" && next === "*") {
      const start = index;
      index += 2;
      while (index < content.length && !(content[index] === "*" && content[index + 1] === "/")) {
        index += 1;
      }
      index = Math.min(content.length, index + 2);
      ranges.push({ start, end: index, kind: "block_comment" });
      continue;
    }

    index += 1;
  }

  return ranges;
}
