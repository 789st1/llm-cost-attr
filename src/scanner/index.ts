import path from "path";
import { walkFiles, readFile } from "../utils/file-walker.js";
import type { CallSite, ScanResult, PatternScanner } from "./types.js";
import { geminiScanner } from "./patterns/gemini.js";
import { anthropicScanner } from "./patterns/anthropic.js";
import { openaiScanner } from "./patterns/openai.js";
import { langchainScanner } from "./patterns/langchain.js";
import { claudeCliScanner } from "./patterns/claude-cli.js";

const SCANNERS: PatternScanner[] = [
  geminiScanner,
  anthropicScanner,
  openaiScanner,
  langchainScanner,
  claudeCliScanner,
];

export async function scanDirectory(root: string): Promise<ScanResult> {
  const absRoot = path.resolve(root);
  const files = await walkFiles(absRoot);
  const allSites: CallSite[] = [];
  const errors: string[] = [];

  for (const file of files) {
    try {
      const content = await readFile(file);
      const lines = content.split("\n");

      for (const scanner of SCANNERS) {
        if (scanner.detectImports(content)) {
          const sites = scanner.findCallSites(file, content, lines);
          allSites.push(...sites);
        }
      }
    } catch (err: any) {
      errors.push(`${file}: ${err.message}`);
    }
  }

  // Deduplicate (same file+line)
  const seen = new Set<string>();
  const deduplicated = allSites.filter((site) => {
    const key = `${site.file}:${site.line}:${site.provider}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return {
    root: absRoot,
    files: files.length,
    callSites: deduplicated,
    errors,
  };
}

export type { CallSite, ScanResult } from "./types.js";
