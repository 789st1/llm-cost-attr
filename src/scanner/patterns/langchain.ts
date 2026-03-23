import type { CallSite, PatternScanner } from "../types.js";

const IMPORT_PATTERNS = [
  /from\s+langchain/,
  /import\s+.*langchain/,
  /ChatGoogleGenerativeAI/,
  /ChatVertexAI/,
  /ChatOpenAI/,
  /ChatAnthropic/,
];

// More specific patterns — only match on known LLM variable patterns
const LLM_CALL_PATTERNS = [
  { regex: /(?:llm|chat_model|model|chain|agent|graph)\s*\.\s*invoke\s*\(/g, callType: "chat" as const },
  { regex: /(?:llm|chat_model|model|chain|agent|graph)\s*\.\s*ainvoke\s*\(/g, callType: "chat" as const },
  { regex: /(?:llm|chat_model|model|chain|agent|graph)\s*\.\s*stream\s*\(/g, callType: "chat" as const },
  { regex: /(?:llm|chat_model|model|chain|agent|graph)\s*\.\s*astream\s*\(/g, callType: "chat" as const },
  // Direct self.llm.invoke patterns
  { regex: /self\.\w*(?:llm|model|chain|agent)\w*\.invoke\s*\(/g, callType: "chat" as const },
  { regex: /self\.\w*(?:llm|model|chain|agent)\w*\.ainvoke\s*\(/g, callType: "chat" as const },
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

function resolveProvider(content: string): string {
  if (/ChatGoogleGenerativeAI|ChatVertexAI|gemini/i.test(content)) return "google";
  if (/ChatOpenAI|gpt-|openai/i.test(content)) return "openai";
  if (/ChatAnthropic|claude/i.test(content)) return "anthropic";
  return "langchain";
}

function extractModelFromFile(content: string): string | null {
  for (const pattern of [
    /model\s*=\s*["']([^"']+)["']/,
    /model_name\s*=\s*["']([^"']+)["']/,
    /gemini_model\s*[=:]\s*["']([^"']+)["']/,
  ]) {
    const match = pattern.exec(content);
    if (match) return match[1];
  }
  return null;
}

export const langchainScanner: PatternScanner = {
  detectImports(content: string): boolean {
    return IMPORT_PATTERNS.some((p) => p.test(content));
  },

  findCallSites(filePath: string, content: string, lines: string[]): CallSite[] {
    const sites: CallSite[] = [];
    const model = extractModelFromFile(content);
    const provider = resolveProvider(content);
    const lineIndex = buildLineIndex(content);

    for (const { regex, callType } of LLM_CALL_PATTERNS) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const lineIdx = offsetToLine(lineIndex, match.index);
        const line = lines[lineIdx];

        // Skip comments
        if (/^\s*#/.test(line)) continue;

        const snippet = lines.slice(Math.max(0, lineIdx - 1), lineIdx + 2).join("\n");

        // Detect loop
        let inLoop = false;
        let multiplier = 1;
        const start = Math.max(0, lineIdx - 20);
        for (let i = lineIdx - 1; i >= start; i--) {
          if (/\bfor\s+/.test(lines[i]) || /\bwhile\s+/.test(lines[i]) || /async\s+for/.test(lines[i])) {
            inLoop = true;
            multiplier = 5;
            break;
          }
        }

        sites.push({
          file: filePath,
          line: lineIdx + 1,
          provider,
          callType,
          model,
          maxTokens: null,
          estimatedInputTokens: null,
          inLoop,
          loopMultiplier: multiplier,
          hasCaching: false,
          confidence: "medium",
          rawSnippet: snippet,
        });
      }
    }

    // Detect factory instantiation calls (e.g., get_chat_llm())
    const factoryRegex = /get_chat_llm\s*\(/g;
    let fMatch: RegExpExecArray | null;
    while ((fMatch = factoryRegex.exec(content)) !== null) {
      const lineIdx = offsetToLine(lineIndex, fMatch.index);
      const snippet = lines.slice(Math.max(0, lineIdx - 1), lineIdx + 2).join("\n");
      const blockLines = lines.slice(Math.max(0, lineIdx - 2), lineIdx + 5).join("\n");
      const maxTokensMatch = /max_output_tokens\s*=\s*(\d+)/.exec(blockLines);

      sites.push({
        file: filePath,
        line: lineIdx + 1,
        provider,
        callType: "chat",
        model,
        maxTokens: maxTokensMatch ? parseInt(maxTokensMatch[1], 10) : null,
        estimatedInputTokens: null,
        inLoop: false,
        loopMultiplier: 1,
        hasCaching: false,
        confidence: "medium",
        rawSnippet: snippet,
      });
    }

    return sites;
  },
};
