import type { CallSite } from "../scanner/types.js";
import { resolveModel, type ModelPricing } from "../pricing/index.js";
import { DEFAULT_TOKENS } from "./tokens.js";

export interface CostEstimate {
  callSite: CallSite;
  pricing: ModelPricing | null;
  inputTokens: number;
  outputTokens: number;
  costPerCall: number;
  callsPerInvocation: number;
  monthlyCost: number; // at given volume
  confidence: "high" | "medium" | "low";
}

export interface CostReport {
  root: string;
  filesScanned: number;
  totalCallSites: number;
  estimates: CostEstimate[];
  totalMonthlyCost: number;
  byProvider: Record<string, number>;
  byFile: Record<string, number>;
  errors: string[];
}

export function estimateCosts(
  callSites: CallSite[],
  root: string,
  filesScanned: number,
  volume: number = 1000,
  errors: string[] = [],
): CostReport {
  const estimates: CostEstimate[] = [];

  for (const site of callSites) {
    const pricing = resolveModel(site.model, site.provider);
    const defaults = DEFAULT_TOKENS[site.callType] ?? DEFAULT_TOKENS.chat;

    const inputTokens = site.estimatedInputTokens ?? defaults.input;
    const outputTokens = site.maxTokens ?? defaults.output;

    const inputCost = pricing ? (inputTokens * pricing.inputPer1M) / 1_000_000 : 0;
    const outputCost = pricing ? (outputTokens * pricing.outputPer1M) / 1_000_000 : 0;
    const costPerCall = inputCost + outputCost;

    const callsPerInvocation = site.loopMultiplier;
    const monthlyCost = costPerCall * callsPerInvocation * volume;

    estimates.push({
      callSite: site,
      pricing,
      inputTokens,
      outputTokens,
      costPerCall,
      callsPerInvocation,
      monthlyCost,
      confidence: pricing ? site.confidence : "low",
    });
  }

  // Aggregate
  const totalMonthlyCost = estimates.reduce((sum, e) => sum + e.monthlyCost, 0);

  const byProvider: Record<string, number> = {};
  const byFile: Record<string, number> = {};
  for (const e of estimates) {
    byProvider[e.callSite.provider] = (byProvider[e.callSite.provider] ?? 0) + e.monthlyCost;
    const relFile = e.callSite.file.replace(root + "/", "");
    byFile[relFile] = (byFile[relFile] ?? 0) + e.monthlyCost;
  }

  return {
    root,
    filesScanned,
    totalCallSites: callSites.length,
    estimates,
    totalMonthlyCost,
    byProvider,
    byFile,
    errors,
  };
}
