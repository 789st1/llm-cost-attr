export type Provider = "openai" | "anthropic" | "google" | "langchain" | "claude-cli";
export type CallType = "chat" | "embedding" | "content-generation" | "tool-use";
export type Confidence = "high" | "medium" | "low";

export interface CallSite {
  file: string;
  line: number;
  provider: Provider;
  callType: CallType;
  model: string | null;
  maxTokens: number | null;
  estimatedInputTokens: number | null;
  inLoop: boolean;
  loopMultiplier: number;
  hasCaching: boolean;
  confidence: Confidence;
  rawSnippet: string;
}

export interface ScanResult {
  root: string;
  files: number;
  callSites: CallSite[];
  errors: string[];
}

export interface PatternScanner {
  /** Check if this file uses the provider (import detection) */
  detectImports(content: string): boolean;
  /** Find all call sites in the file */
  findCallSites(filePath: string, content: string, lines: string[]): CallSite[];
}
