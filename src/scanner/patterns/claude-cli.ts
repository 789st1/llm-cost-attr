import type { CallSite, PatternScanner } from "../types.js";

const IMPORT_PATTERNS = [
  /claude\s+-p/,
  /create_subprocess_exec/,
  /shutil\.which\s*\(\s*["']claude["']\)/,
  /subprocess.*claude/,
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

function extractModel(content: string): string | null {
  const match = content.match(/--model['"]\s*,\s*(?:self\.)?model/);
  if (match) {
    const defaultMatch = content.match(/model\s*[:=]\s*["']([^"']+)["']/);
    return defaultMatch?.[1] ?? "sonnet";
  }
  const directMatch = content.match(/--model\s+(\w+)/);
  if (directMatch) return directMatch[1];
  const attrMatch = content.match(/self\.model\s*=\s*model|model\s*=\s*["'](\w+)["']/);
  if (attrMatch) return attrMatch[1] ?? "sonnet";
  return "sonnet";
}

export const claudeCliScanner: PatternScanner = {
  detectImports(content: string): boolean {
    return IMPORT_PATTERNS.some((p) => p.test(content));
  },

  findCallSites(filePath: string, content: string, lines: string[]): CallSite[] {
    const sites: CallSite[] = [];
    const model = extractModel(content);
    const lineIndex = buildLineIndex(content);

    // Look for async def ask/ask_text methods
    const methodRegex = /async\s+def\s+(ask|ask_text)\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = methodRegex.exec(content)) !== null) {
      const lineIdx = offsetToLine(lineIndex, match.index);
      const snippet = lines.slice(Math.max(0, lineIdx - 1), lineIdx + 2).join("\n");

      sites.push({
        file: filePath,
        line: lineIdx + 1,
        provider: "claude-cli",
        callType: "chat",
        model,
        maxTokens: null,
        estimatedInputTokens: null,
        inLoop: false,
        loopMultiplier: 1,
        hasCaching: false,
        confidence: "high",
        rawSnippet: snippet,
      });
    }

    // Direct subprocess calls
    const subprocRegex = /create_subprocess_exec\s*\(\s*\*cmd/g;
    while ((match = subprocRegex.exec(content)) !== null) {
      const lineIdx = offsetToLine(lineIndex, match.index);
      if (sites.some((s) => Math.abs(s.line - (lineIdx + 1)) < 15)) continue;

      const snippet = lines.slice(Math.max(0, lineIdx - 1), lineIdx + 2).join("\n");
      sites.push({
        file: filePath,
        line: lineIdx + 1,
        provider: "claude-cli",
        callType: "chat",
        model,
        maxTokens: null,
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
