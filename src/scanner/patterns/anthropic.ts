import type { CallSite, PatternScanner } from "../types.js";

const IMPORT_PATTERNS = [
  /@anthropic-ai\/sdk/,
  /from\s+["']@anthropic-ai\/sdk["']/,
  /import\s+Anthropic/,
];

function detectLoop(lines: string[], lineIdx: number): { inLoop: boolean; multiplier: number } {
  const start = Math.max(0, lineIdx - 30);
  let braceDepth = 0;
  for (let i = lineIdx - 1; i >= start; i--) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '}') braceDepth++;
      if (ch === '{') braceDepth--;
    }
    if (braceDepth < 0) break;

    if (/\bfor\s*\(/.test(line) || /\.forEach\s*\(/.test(line) || /\.map\s*\(/.test(line)) {
      const entriesMatch = line.match(/Object\.entries\s*\((\w+)\)/);
      if (entriesMatch) {
        const objName = entriesMatch[1];
        const content = lines.join("\n");
        const objDef = content.match(new RegExp(`(?:const|let|var)\\s+${objName}[^=]*=\\s*\\{([^}]*)\\}`, 's'));
        if (objDef) {
          const keyCount = (objDef[1].match(/\w+\s*:/g) || []).length;
          if (keyCount > 0) return { inLoop: true, multiplier: keyCount };
        }
        return { inLoop: true, multiplier: 5 };
      }
      const numMatch = line.match(/;\s*\w+\s*<\s*(\d+)/);
      if (numMatch) return { inLoop: true, multiplier: parseInt(numMatch[1], 10) };
      return { inLoop: true, multiplier: 5 };
    }
  }
  return { inLoop: false, multiplier: 1 };
}

function detectCallerLoop(content: string, lines: string[], lineIdx: number): { inLoop: boolean; multiplier: number } | null {
  let funcName: string | null = null;
  for (let i = lineIdx - 1; i >= 0; i--) {
    const funcMatch = lines[i].match(/(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/);
    if (funcMatch) {
      funcName = funcMatch[1] || funcMatch[2];
      break;
    }
  }
  if (!funcName) return null;

  for (let i = 0; i < lines.length; i++) {
    if (i === lineIdx) continue;
    if (lines[i].includes(funcName + "(") || lines[i].includes(`await ${funcName}(`)) {
      const result = detectLoop(lines, i);
      if (result.inLoop) return result;
    }
  }
  return null;
}

function detectCaching(lines: string[], lineIdx: number): boolean {
  const start = Math.max(0, lineIdx - 50);
  const block = lines.slice(start, lineIdx + 5).join("\n");
  return /redis|cache|Cache|\.get\s*\(.*key|cached|memoize/i.test(block);
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

      // Direct + cross-function loop detection
      let loop = detectLoop(lines, lineIdx);
      if (!loop.inLoop) {
        const callerLoop = detectCallerLoop(content, lines, lineIdx);
        if (callerLoop) loop = callerLoop;
      }

      // Extract model from nearby code block
      const blockStart = Math.max(0, lineIdx - 5);
      const block = lines.slice(blockStart, lineIdx + 10).join("\n");
      const modelMatch = /model\s*:\s*["']([^"']+)["']/.exec(block);
      const maxTokensMatch = /max_tokens\s*:\s*(\d+)/.exec(block);

      // Estimate input tokens from system prompt
      let inputTokens: number | null = null;
      const systemVarMatch = /system\s*:\s*(\w+)/.exec(block);
      if (systemVarMatch) {
        const varName = systemVarMatch[1];
        const varDef = content.match(new RegExp(`(?:const|let|var)\\s+${varName}\\s*=\\s*[\`"']([\\s\\S]*?)[\`"']`));
        if (varDef) inputTokens = Math.ceil(varDef[1].length / 4);
      }
      // Also check for inline system string
      const inlineSystem = /system\s*:\s*["'`]([^"'`]{20,})["'`]/.exec(block);
      if (!inputTokens && inlineSystem) {
        inputTokens = Math.ceil(inlineSystem[1].length / 4);
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
