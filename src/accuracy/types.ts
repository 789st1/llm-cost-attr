import type { CallSite } from "../scanner/types.js";

export interface GeminiEstimate {
  file: string;
  line: number;
  estimatedInputTokens: number;
  estimatedOutputTokens: number;
  estimatedCostPerCall: number;
  model: string;
  reasoning: string;
  loopMultiplier: number;
  cacheable: boolean;
}

export interface AccuracyScore {
  file: string;
  line: number;
  provider: string;
  model: string | null;
  scannerEstimate: {
    inputTokens: number;
    outputTokens: number;
    costPerCall: number;
    loopMultiplier: number;
  };
  geminiEstimate: {
    inputTokens: number;
    outputTokens: number;
    costPerCall: number;
    loopMultiplier: number;
  };
  errorPercent: number;
  errorCategory: "token-default" | "model-resolution" | "loop-detection" | "output-overestimate" | "caching" | "accurate";
}

export interface RoundScore {
  round: number;
  totalCallSites: number;
  meanErrorPercent: number;
  medianErrorPercent: number;
  within20Percent: number;
  within10Percent: number;
  worstOffenders: AccuracyScore[];
  improvements: string[];
}

export interface TestCase {
  name: string;
  files: { path: string; content: string }[];
  expectedCallSites: number;
  expectedProviders: string[];
}

export interface HeuristicImprovement {
  type: "token-default" | "model-alias" | "loop-heuristic" | "output-scaling" | "cache-pattern";
  description: string;
  before: string;
  after: string;
  estimatedImpact: number; // % improvement
}

export interface LoopResult {
  rounds: RoundScore[];
  finalAccuracy: number;
  converged: boolean;
  improvementsApplied: HeuristicImprovement[];
}
