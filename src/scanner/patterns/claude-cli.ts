import type { CallSite, PatternScanner } from "../types.js";

const IMPORT_PATTERNS = [
  /claude\s+-p/,
  /create_subprocess_exec/,
  /shutil\.which\s*\(\s*["']claude["']\)/,
  /subprocess.*claude/,
];

const CALL_PATTERNS = [
  // Python: asyncio.create_subprocess_exec with claude
  { regex: /create_subprocess_exec\s*\(/g },
  // Direct CLI invocation pattern
  { regex: /claude\s+-p/g },
  // The ask/ask_text method pattern
  { regex: /await\s+(?:self\.)?(?:client\.)?ask(?:_text)?\s*\(/g },
];

function extractModel(content: string): string | null {
  // Look for --model flag
  const match = content.match(/--model['"]\s*,\s*(?:self\.)?model/);
  if (match) {
    // Look for model default
    const defaultMatch = content.match(/model\s*[:=]\s*["']([^"']+)["']/);
    return defaultMatch?.[1] ?? "sonnet";
  }
  const directMatch = content.match(/--model\s+(\w+)/);
  if (directMatch) return directMatch[1];
  // Check for model attribute
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

    // Look for the ask() and ask_text() method definitions or calls
    const methodRegex = /async\s+def\s+(ask|ask_text)\s*\(/g;
    let match: RegExpExecArray | null;

    while ((match = methodRegex.exec(content)) !== null) {
      const lineIdx = content.substring(0, match.index).split("\n").length - 1;
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

    // Also detect direct subprocess calls with claude
    const subprocRegex = /create_subprocess_exec\s*\(\s*\*cmd/g;
    while ((match = subprocRegex.exec(content)) !== null) {
      const lineIdx = content.substring(0, match.index).split("\n").length - 1;
      // Don't duplicate if we already found the method
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
