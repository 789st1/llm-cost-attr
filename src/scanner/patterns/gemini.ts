import type { CallSite, PatternScanner } from "../types.js";

const IMPORT_PATTERNS = [
  /@google\/generative-ai/,
  /google\.generativeai/,
  /from\s+["']@google\/generative-ai["']/,
  /import\s+.*GoogleGenerativeAI/,
];

const CALL_PATTERNS = [
  // generateContent calls
  { regex: /\.generateContent\s*\(/g, callType: "content-generation" as const },
  // embedContent calls
  { regex: /\.embedContent\s*\(/g, callType: "embedding" as const },
];

const MODEL_REGEX = /getGenerativeModel\s*\(\s*\{[^}]*model\s*:\s*["']([^"']+)["']/g;
const MAX_TOKENS_REGEX = /maxOutputTokens\s*:\s*(\d+)/g;

function detectLoop(lines: string[], lineIdx: number): { inLoop: boolean; multiplier: number } {
  // Look up to 30 lines above for loop constructs
  const start = Math.max(0, lineIdx - 30);
  for (let i = lineIdx - 1; i >= start; i--) {
    const line = lines[i];
    if (/\bfor\s*\(/.test(line) || /\.forEach\s*\(/.test(line) || /\.map\s*\(/.test(line) || /\bwhile\s*\(/.test(line)) {
      // Try to find loop bound
      const entriesMatch = line.match(/Object\.entries\s*\((\w+)\)/);
      if (entriesMatch) return { inLoop: true, multiplier: 5 }; // heuristic
      const ofMatch = line.match(/of\s+(\w+)/);
      if (ofMatch) return { inLoop: true, multiplier: 5 };
      return { inLoop: true, multiplier: 5 };
    }
    // Check for closing brace that might be the end of a non-loop block
    if (/^\s*\}\s*$/.test(line)) break;
  }
  return { inLoop: false, multiplier: 1 };
}

function detectCaching(lines: string[], lineIdx: number): boolean {
  const start = Math.max(0, lineIdx - 40);
  const end = Math.min(lines.length, lineIdx + 5);
  const block = lines.slice(start, end).join("\n");
  return /redis|cache|Cache|\.get\s*\(|cached|memoize|lru/i.test(block);
}

function extractModel(lines: string[], lineIdx: number): string | null {
  // Look backwards for getGenerativeModel
  const start = Math.max(0, lineIdx - 20);
  const block = lines.slice(start, lineIdx + 1).join("\n");
  const match = /model\s*:\s*["']([^"']+)["']/.exec(block);
  return match?.[1] ?? null;
}

function extractMaxTokens(lines: string[], lineIdx: number): number | null {
  const start = Math.max(0, lineIdx - 15);
  const block = lines.slice(start, lineIdx + 1).join("\n");
  const match = /maxOutputTokens\s*:\s*(\d+)/.exec(block);
  return match ? parseInt(match[1], 10) : null;
}

function estimateInputTokens(lines: string[], lineIdx: number): number | null {
  // Look for the prompt being passed to generateContent
  const line = lines[lineIdx];
  // Check for inline string
  const strMatch = line.match(/generateContent\s*\(\s*["'`]([^"'`]{10,})["'`]\s*\)/);
  if (strMatch) return Math.ceil(strMatch[1].length / 4);
  // Check for template literal or variable — look for prompt definition above
  const start = Math.max(0, lineIdx - 50);
  const block = lines.slice(start, lineIdx).join("\n");
  // Look for long string constants (system prompts, prompt templates)
  const longStrings = block.match(/["'`][^"'`]{100,}["'`]/g);
  if (longStrings) {
    const totalChars = longStrings.reduce((sum, s) => sum + s.length, 0);
    return Math.ceil(totalChars / 4);
  }
  return null;
}

export const geminiScanner: PatternScanner = {
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

        sites.push({
          file: filePath,
          line: lineIdx + 1,
          provider: "google",
          callType,
          model: extractModel(lines, lineIdx),
          maxTokens: extractMaxTokens(lines, lineIdx),
          estimatedInputTokens: estimateInputTokens(lines, lineIdx),
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
