import type { CallSite, PatternScanner } from "../types.js";
import { escapeRegex } from "../../utils/escape.js";

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

/** Pre-compute line start offsets for O(log N) line lookups. */
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

function detectLoop(lines: string[], lineIdx: number, content: string): { inLoop: boolean; multiplier: number } {
  const start = Math.max(0, lineIdx - 30);
  let braceDepth = 0;
  for (let i = lineIdx - 1; i >= start; i--) {
    const line = lines[i];
    for (const ch of line) {
      if (ch === '}') braceDepth++;
      if (ch === '{') braceDepth--;
    }
    if (braceDepth < 0) break;

    if (/\bfor\s*\(/.test(line) || /\.forEach\s*\(/.test(line) || /\.map\s*\(/.test(line) || /\bwhile\s*\(/.test(line)) {
      const entriesMatch = line.match(/Object\.entries\s*\((\w+)\)/);
      if (entriesMatch) {
        const objName = entriesMatch[1];
        const objDef = content.match(new RegExp(`(?:const|let|var)\\s+${escapeRegex(objName)}[^=]*=\\s*\\{([^}]*)\\}`, 's'));
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

function detectCaching(lines: string[], lineIdx: number): boolean {
  const start = Math.max(0, lineIdx - 50);
  const end = Math.min(lines.length, lineIdx + 5);
  const block = lines.slice(start, end).join("\n");
  return /redis|cache|Cache|\.get\s*\(.*key|cached|memoize|lru/i.test(block);
}

function extractModel(content: string, lines: string[], lineIdx: number): string | null {
  const line = lines[lineIdx];
  const varMatch = line.match(/(?:await\s+)?(\w+)\.(?:generateContent|embedContent)/);
  const modelVar = varMatch?.[1] ?? "model";

  for (let i = lineIdx - 1; i >= Math.max(0, lineIdx - 30); i--) {
    const assignLine = lines[i];
    if (assignLine.includes(modelVar) && assignLine.includes("getGenerativeModel")) {
      const modelNameMatch = assignLine.match(/model\s*:\s*["']([^"']+)["']/);
      if (modelNameMatch) return modelNameMatch[1];
    }
    if (assignLine.includes("getGenerativeModel")) {
      const block = lines.slice(i, Math.min(i + 8, lines.length)).join("\n");
      const modelNameMatch = block.match(/model\s*:\s*["']([^"']+)["']/);
      if (modelNameMatch) return modelNameMatch[1];
    }
  }

  const blockAbove = lines.slice(Math.max(0, lineIdx - 20), lineIdx + 1).join("\n");
  const matches = [...blockAbove.matchAll(/getGenerativeModel\s*\(\s*\{[^}]*model\s*:\s*["']([^"']+)["']/g)];
  if (matches.length > 0) return matches[matches.length - 1][1];
  return null;
}

function extractMaxTokens(lines: string[], lineIdx: number): number | null {
  const block = lines.slice(Math.max(0, lineIdx - 20), lineIdx + 1).join("\n");
  const match = /maxOutputTokens\s*:\s*(\d+)/.exec(block);
  return match ? parseInt(match[1], 10) : null;
}

function estimateInputTokens(lines: string[], lineIdx: number): number | null {
  const line = lines[lineIdx];
  const strMatch = line.match(/generateContent\s*\(\s*["'`]([^"'`]{10,})["'`]\s*\)/);
  if (strMatch) return Math.ceil(strMatch[1].length / 4);

  const varMatch = line.match(/generateContent\s*\(\s*(\w+)\s*\)/);
  if (varMatch) {
    const varName = varMatch[1];
    for (let i = lineIdx - 1; i >= Math.max(0, lineIdx - 100); i--) {
      if (lines[i].includes(varName) && /=/.test(lines[i])) {
        const block = lines.slice(i, lineIdx).join("\n");
        const longStrings = block.match(/["'`][^"'`]{50,}["'`]/g);
        if (longStrings) return Math.ceil(longStrings.reduce((sum, s) => sum + s.length, 0) / 4);
      }
    }
  }

  const start = Math.max(0, lineIdx - 60);
  const block = lines.slice(start, lineIdx).join("\n");
  const longStrings = block.match(/["'`][^"'`]{100,}["'`]/g);
  if (longStrings) return Math.ceil(longStrings.reduce((sum, s) => sum + s.length, 0) / 4);
  return null;
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
      const result = detectLoop(lines, i, content);
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
    const lineIndex = buildLineIndex(content);

    for (const { regex, callType } of CALL_PATTERNS) {
      regex.lastIndex = 0;
      let match: RegExpExecArray | null;
      while ((match = regex.exec(content)) !== null) {
        const lineIdx = offsetToLine(lineIndex, match.index);
        const snippet = lines.slice(Math.max(0, lineIdx - 1), lineIdx + 2).join("\n");

        let loop = detectLoop(lines, lineIdx, content);
        if (!loop.inLoop) {
          const callerLoop = detectCallerLoop(content, lines, lineIdx);
          if (callerLoop) loop = callerLoop;
        }

        const model = extractModel(content, lines, lineIdx);

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
