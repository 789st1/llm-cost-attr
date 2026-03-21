import type { CallSite, PatternScanner } from "../types.js";

const IMPORT_PATTERNS = [
  /from\s+["']openai["']/,
  /import\s+OpenAI/,
  /require\s*\(\s*["']openai["']\s*\)/,
];

const CALL_PATTERNS = [
  { regex: /\.chat\.completions\.create\s*\(/g, callType: "chat" as const },
  { regex: /\.embeddings\.create\s*\(/g, callType: "embedding" as const },
];

function buildLineIndex(content: string): number[] {
  const offsets = [0];
  for (let i = 0; i < content.length; i++) {
    if (content[i] === "\n") offsets.push(i + 1);
  }
  return offsets;
}

function offsetToLine(offsets: number[], offset: number): number {
  let lo = 0, hi = offsets.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (offsets[mid] <= offset) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function detectLoop(lines: string[], lineIdx: number): { inLoop: boolean; multiplier: number } {
  const start = Math.max(0, lineIdx - 30);
  let braceDepth = 0;
  for (let i = lineIdx - 1; i >= start; i--) {
    for (const ch of lines[i]) {
      if (ch === '}') braceDepth++;
      if (ch === '{') braceDepth--;
    }
    if (braceDepth < 0) break;
    if (/\bfor\s*\(/.test(lines[i]) || /\.forEach\s*\(/.test(lines[i]) || /\.map\s*\(/.test(lines[i])) {
      return { inLoop: true, multiplier: 5 };
    }
  }
  return { inLoop: false, multiplier: 1 };
}

function detectCaching(lines: string[], lineIdx: number): boolean {
  const start = Math.max(0, lineIdx - 50);
  const block = lines.slice(start, lineIdx + 5).join("\n");
  return /redis|cache|Cache|\.get\s*\(.*key|cached|memoize/i.test(block);
}

export const openaiScanner: PatternScanner = {
  detectImports(content: string): boolean {
    return IMPORT_PATTERNS.some((p) => p.test(content));
  },

  findCallSites(filePath: string, content: string, lines: string[]): CallSite[] {
    const sites: CallSite[] = [];
    const lineIndex = buildLineIndex(content);

    for (const { regex, callType } of CALL_PATTERNS) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const lineIdx = offsetToLine(lineIndex, match.index);
        const snippet = lines.slice(Math.max(0, lineIdx - 1), lineIdx + 2).join("\n");
        const loop = detectLoop(lines, lineIdx);

        const blockStart = Math.max(0, lineIdx - 5);
        const block = lines.slice(blockStart, lineIdx + 10).join("\n");
        const modelMatch = /model\s*:\s*["']([^"']+)["']/.exec(block);
        const maxTokensMatch = /max_tokens\s*:\s*(\d+)/.exec(block);

        sites.push({
          file: filePath,
          line: lineIdx + 1,
          provider: "openai",
          callType,
          model: modelMatch?.[1] ?? null,
          maxTokens: maxTokensMatch ? parseInt(maxTokensMatch[1], 10) : null,
          estimatedInputTokens: null,
          inLoop: loop.inLoop,
          loopMultiplier: loop.multiplier,
          hasCaching: detectCaching(lines, lineIdx),
          confidence: "high",
          rawSnippet: snippet,
        });
      }
    }

    return sites;
  },
};
