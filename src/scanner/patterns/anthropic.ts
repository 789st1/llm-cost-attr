import type { CallSite, PatternScanner } from "../types.js";

const IMPORT_PATTERNS = [
  /@anthropic-ai\/sdk/,
  /from\s+["']@anthropic-ai\/sdk["']/,
  /import\s+Anthropic/,
];

function detectLoop(lines: string[], lineIdx: number): { inLoop: boolean; multiplier: number } {
  const start = Math.max(0, lineIdx - 30);
  for (let i = lineIdx - 1; i >= start; i--) {
    const line = lines[i];
    if (/\bfor\s*\(/.test(line) || /\.forEach\s*\(/.test(line) || /\.map\s*\(/.test(line)) {
      const entriesMatch = line.match(/Object\.entries\s*\((\w+)\)/);
      if (entriesMatch) return { inLoop: true, multiplier: 5 };
      return { inLoop: true, multiplier: 5 };
    }
    if (/^\s*\}\s*$/.test(line)) break;
  }
  return { inLoop: false, multiplier: 1 };
}

function detectCaching(lines: string[], lineIdx: number): boolean {
  const start = Math.max(0, lineIdx - 40);
  const block = lines.slice(start, lineIdx + 5).join("\n");
  return /redis|cache|Cache|\.get\s*\(|cached|memoize/i.test(block);
}

export const anthropicScanner: PatternScanner = {
  detectImports(content: string): boolean {
    return IMPORT_PATTERNS.some((p) => p.test(content));
  },

  findCallSites(filePath: string, content: string, lines: string[]): CallSite[] {
    const sites: CallSite[] = [];
    const regex = /\.messages\.create\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = regex.exec(content)) !== null) {
      const lineIdx = content.substring(0, match.index).split("\n").length - 1;
      const snippet = lines.slice(Math.max(0, lineIdx - 1), lineIdx + 2).join("\n");
      const loop = detectLoop(lines, lineIdx);

      // Extract model from nearby code block
      const blockStart = Math.max(0, lineIdx - 5);
      const block = lines.slice(blockStart, lineIdx + 10).join("\n");
      const modelMatch = /model\s*:\s*["']([^"']+)["']/.exec(block);
      const maxTokensMatch = /max_tokens\s*:\s*(\d+)/.exec(block);

      // Estimate input tokens from system prompt
      const systemMatch = /system\s*:\s*(\w+)/.exec(block);
      let inputTokens: number | null = null;
      if (systemMatch) {
        // Look for the variable definition
        const varName = systemMatch[1];
        const varDef = content.match(new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*[\`"']([\\s\\S]*?)[\`"']`));
        if (varDef) inputTokens = Math.ceil(varDef[1].length / 4);
      }

      sites.push({
        file: filePath,
        line: lineIdx + 1,
        provider: "anthropic",
        callType: "chat",
        model: modelMatch?.[1] ?? null,
        maxTokens: maxTokensMatch ? parseInt(maxTokensMatch[1], 10) : null,
        estimatedInputTokens: inputTokens,
        inLoop: loop.inLoop,
        loopMultiplier: loop.multiplier,
        hasCaching: detectCaching(lines, lineIdx),
        confidence: "high",
        rawSnippet: snippet,
      });
    }

    return sites;
  },
};
