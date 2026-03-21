import type { CallSite, PatternScanner } from "../types.js";

const IMPORT_PATTERNS = [
  /from\s+["']openai["']/,
  /import\s+OpenAI/,
  /require\s*\(\s*["']openai["']\s*\)/,
];

const CALL_PATTERNS = [
  { regex: /\.chat\.completions\.create\s*\(/g, callType: "chat" as const },
  { regex: /\.embeddings\.create\s*\(/g, callType: "embedding" as const },
  { regex: /\.completions\.create\s*\(/g, callType: "chat" as const },
];

function detectLoop(lines: string[], lineIdx: number): { inLoop: boolean; multiplier: number } {
  const start = Math.max(0, lineIdx - 30);
  for (let i = lineIdx - 1; i >= start; i--) {
    if (/\bfor\s*\(/.test(lines[i]) || /\.forEach\s*\(/.test(lines[i]) || /\.map\s*\(/.test(lines[i])) {
      return { inLoop: true, multiplier: 5 };
    }
    if (/^\s*\}\s*$/.test(lines[i])) break;
  }
  return { inLoop: false, multiplier: 1 };
}

export const openaiScanner: PatternScanner = {
  detectImports(content: string): boolean {
    return IMPORT_PATTERNS.some((p) => p.test(content));
  },

  findCallSites(filePath: string, content: string, lines: string[]): CallSite[] {
    const sites: CallSite[] = [];

    for (const { regex, callType } of CALL_PATTERNS) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const lineIdx = content.substring(0, match.index).split("\n").length - 1;
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
          hasCaching: false,
          confidence: "high",
          rawSnippet: snippet,
        });
      }
    }

    return sites;
  },
};
