import type { CallSite, PatternScanner } from "../types.js";

const IMPORT_PATTERNS = [
  /@google\/generative-ai/,
  /google\.generativeai/,
  /from\s+["']@google\/generative-ai["']/,
  /import\s+.*GoogleGenerativeAI/,
];

const CALL_PATTERNS: Array<{ regex: RegExp; callType: "content-generation" | "embedding" }> = [
  { regex: /\.generateContent\s*\(/g, callType: "content-generation" },
  { regex: /\.embedContent\s*\(/g, callType: "embedding" },
];

function detectLoop(lines: string[], lineIdx: number): { inLoop: boolean; multiplier: number } {
  const start = Math.max(0, lineIdx - 30);
  let braceDepth = 0;
  for (let i = lineIdx - 1; i >= start; i--) {
    const line = lines[i];
    // Count braces to track scope
    for (const ch of line) {
      if (ch === '}') braceDepth++;
      if (ch === '{') braceDepth--;
    }
    if (braceDepth < 0) break; // exited enclosing scope

    if (/\bfor\s*\(/.test(line) || /\.forEach\s*\(/.test(line) || /\.map\s*\(/.test(line) || /\bwhile\s*\(/.test(line)) {
      // Try to extract loop bound
      const entriesMatch = line.match(/Object\.entries\s*\((\w+)\)/);
      if (entriesMatch) {
        // Look for the object definition to count keys
        const objName = entriesMatch[1];
        const objDef = lines.join("\n").match(new RegExp(`(?:const|let|var)\\s+${objName}[^=]*=\\s*\\{([^}]*)\\}`, 's'));
        if (objDef) {
          const keyCount = (objDef[1].match(/\w+\s*:/g) || []).length;
          if (keyCount > 0) return { inLoop: true, multiplier: keyCount };
        }
        return { inLoop: true, multiplier: 5 };
      }
      // Check for .length or numeric bound
      const numMatch = line.match(/;\s*\w+\s*<\s*(\d+)/);
      if (numMatch) return { inLoop: true, multiplier: parseInt(numMatch[1], 10) };
      return { inLoop: true, multiplier: 5 };
    }
  }
  return { inLoop: false, multiplier: 1 };
}

function detectCaching(lines: string[], lineIdx: number): boolean {
  const start = Math.max(0, lineIdx - 50);
  const end = Math.min(lines.length, lineIdx + 5);
  const block = lines.slice(start, end).join("\n");
  return /redis|cache|Cache|\.get\s*\(.*key|cached|memoize|lru/i.test(block);
}

/**
 * Extract model specifically for this call site by tracing the model variable.
 * For embedContent, look for the specific getGenerativeModel call that created this model.
 */
function extractModel(content: string, lines: string[], lineIdx: number, callType: string): string | null {
  // Strategy 1: Look for the variable assigned from getGenerativeModel
  const line = lines[lineIdx];
  // Find what variable .generateContent/.embedContent is called on
  const varMatch = line.match(/(?:const|let|var)?\s*(?:await\s+)?(\w+)\.(?:generateContent|embedContent)/);
  const modelVar = varMatch?.[1] ?? "model";

  // Search backwards for where this variable was assigned
  for (let i = lineIdx - 1; i >= Math.max(0, lineIdx - 30); i--) {
    const assignLine = lines[i];
    // Direct: const model = client.getGenerativeModel({ model: "..." })
    if (assignLine.includes(modelVar) && assignLine.includes("getGenerativeModel")) {
      const modelNameMatch = assignLine.match(/model\s*:\s*["']([^"']+)["']/);
      if (modelNameMatch) return modelNameMatch[1];
    }
    // Multi-line: getGenerativeModel on previous lines
    if (assignLine.includes("getGenerativeModel")) {
      // Look at surrounding lines for model: "..."
      const block = lines.slice(i, Math.min(i + 8, lines.length)).join("\n");
      const modelNameMatch = block.match(/model\s*:\s*["']([^"']+)["']/);
      if (modelNameMatch) return modelNameMatch[1];
    }
  }

  // Strategy 2: Look for the nearest getGenerativeModel with model in multiline block
  const blockAbove = lines.slice(Math.max(0, lineIdx - 20), lineIdx + 1).join("\n");
  const matches = [...blockAbove.matchAll(/getGenerativeModel\s*\(\s*\{[^}]*model\s*:\s*["']([^"']+)["']/g)];
  if (matches.length > 0) return matches[matches.length - 1][1]; // Take the closest

  return null;
}

function extractMaxTokens(lines: string[], lineIdx: number): number | null {
  // Look backwards for the getGenerativeModel config
  const block = lines.slice(Math.max(0, lineIdx - 20), lineIdx + 1).join("\n");
  const match = /maxOutputTokens\s*:\s*(\d+)/.exec(block);
  return match ? parseInt(match[1], 10) : null;
}

function estimateInputTokens(lines: string[], lineIdx: number): number | null {
  const line = lines[lineIdx];
  // Check for inline string
  const strMatch = line.match(/generateContent\s*\(\s*["'`]([^"'`]{10,})["'`]\s*\)/);
  if (strMatch) return Math.ceil(strMatch[1].length / 4);

  // Check for variable reference and trace it
  const varMatch = line.match(/generateContent\s*\(\s*(\w+)\s*\)/);
  if (varMatch) {
    const varName = varMatch[1];
    // Search backwards for the variable assignment
    for (let i = lineIdx - 1; i >= Math.max(0, lineIdx - 100); i--) {
      if (lines[i].includes(varName) && /=/.test(lines[i])) {
        // Look for string content in the assignment block
        const block = lines.slice(i, lineIdx).join("\n");
        const longStrings = block.match(/["'`][^"'`]{50,}["'`]/g);
        if (longStrings) {
          return Math.ceil(longStrings.reduce((sum, s) => sum + s.length, 0) / 4);
        }
      }
    }
  }

  // Look for system prompt / long strings above
  const start = Math.max(0, lineIdx - 60);
  const block = lines.slice(start, lineIdx).join("\n");
  const longStrings = block.match(/["'`][^"'`]{100,}["'`]/g);
  if (longStrings) {
    return Math.ceil(longStrings.reduce((sum, s) => sum + s.length, 0) / 4);
  }
  return null;
}

/**
 * Detect if a function that wraps an LLM call is called inside a loop elsewhere in the file.
 * This handles the pattern where scoreDimensionGemini() is called inside a for-loop in scoreFeedbackWithLLM().
 */
function detectCallerLoop(content: string, lines: string[], lineIdx: number): { inLoop: boolean; multiplier: number } | null {
  // Find what function this call site is in
  let funcName: string | null = null;
  for (let i = lineIdx - 1; i >= 0; i--) {
    const funcMatch = lines[i].match(/(?:async\s+)?function\s+(\w+)|(?:const|let|var)\s+(\w+)\s*=\s*(?:async\s+)?\(/);
    if (funcMatch) {
      funcName = funcMatch[1] || funcMatch[2];
      break;
    }
  }
  if (!funcName) return null;

  // Search file for calls to this function inside loops
  for (let i = 0; i < lines.length; i++) {
    if (i === lineIdx) continue;
    if (lines[i].includes(funcName + "(") || lines[i].includes(`await ${funcName}(`)) {
      // Check if THIS call is inside a loop
      const result = detectLoop(lines, i);
      if (result.inLoop) return result;
    }
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

        // Direct loop detection
        let loop = detectLoop(lines, lineIdx);
        // Cross-function loop detection
        if (!loop.inLoop) {
          const callerLoop = detectCallerLoop(content, lines, lineIdx);
          if (callerLoop) loop = callerLoop;
        }

        const model = extractModel(content, lines, lineIdx, callType);

        sites.push({
          file: filePath,
          line: lineIdx + 1,
          provider: "google",
          callType,
          model,
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
