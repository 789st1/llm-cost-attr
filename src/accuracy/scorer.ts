import type { CostEstimate } from "../estimator/index.js";
import type { GeminiEstimate, AccuracyScore, RoundScore } from "./types.js";

function categorizeError(
  scanner: { inputTokens: number; outputTokens: number; costPerCall: number; loopMultiplier: number },
  gemini: { inputTokens: number; outputTokens: number; costPerCall: number; loopMultiplier: number },
): AccuracyScore["errorCategory"] {
  if (gemini.costPerCall === 0) return "accurate"; // Can't compare

  const inputRatio = scanner.inputTokens / Math.max(1, gemini.inputTokens);
  const outputRatio = scanner.outputTokens / Math.max(1, gemini.outputTokens);
  const loopDiff = Math.abs(scanner.loopMultiplier - gemini.loopMultiplier);

  // Loop detection error dominates
  if (loopDiff >= 2) return "loop-detection";

  // Output overestimate (using max_tokens when actual is much lower)
  if (outputRatio > 2.0) return "output-overestimate";

  // Input token default is way off
  if (inputRatio > 2.0 || inputRatio < 0.3) return "token-default";

  // Everything is close enough
  const costError = Math.abs(scanner.costPerCall - gemini.costPerCall) / Math.max(0.000001, gemini.costPerCall);
  if (costError <= 0.2) return "accurate";

  return "token-default"; // Generic fallback
}

export function scoreAccuracy(
  estimates: CostEstimate[],
  geminiEstimates: GeminiEstimate[],
): AccuracyScore[] {
  const geminiMap = new Map<string, GeminiEstimate>();
  for (const ge of geminiEstimates) {
    geminiMap.set(`${ge.file}:${ge.line}`, ge);
  }

  const scores: AccuracyScore[] = [];

  for (const est of estimates) {
    const key = `${est.callSite.file}:${est.callSite.line}`;
    const gemini = geminiMap.get(key);
    if (!gemini) continue;

    const scannerData = {
      inputTokens: est.inputTokens,
      outputTokens: est.outputTokens,
      costPerCall: est.costPerCall,
      loopMultiplier: est.callsPerInvocation,
    };

    const geminiData = {
      inputTokens: gemini.estimatedInputTokens,
      outputTokens: gemini.estimatedOutputTokens,
      costPerCall: gemini.estimatedCostPerCall,
      loopMultiplier: gemini.loopMultiplier,
    };

    const errorPercent = gemini.estimatedCostPerCall > 0
      ? Math.abs(est.costPerCall - gemini.estimatedCostPerCall) / gemini.estimatedCostPerCall * 100
      : 0;

    scores.push({
      file: est.callSite.file,
      line: est.callSite.line,
      provider: est.callSite.provider,
      model: est.callSite.model,
      scannerEstimate: scannerData,
      geminiEstimate: geminiData,
      errorPercent,
      errorCategory: categorizeError(scannerData, geminiData),
    });
  }

  return scores;
}

export function summarizeRound(round: number, scores: AccuracyScore[]): RoundScore {
  const errors = scores.map(s => s.errorPercent).sort((a, b) => a - b);
  const within20 = scores.filter(s => s.errorPercent <= 20).length;
  const within10 = scores.filter(s => s.errorPercent <= 10).length;

  const mean = errors.length > 0 ? errors.reduce((a, b) => a + b, 0) / errors.length : 0;
  const median = errors.length > 0 ? errors[Math.floor(errors.length / 2)] : 0;

  const worstOffenders = [...scores]
    .sort((a, b) => b.errorPercent - a.errorPercent)
    .slice(0, 5);

  // Identify improvements needed
  const improvements: string[] = [];
  const categoryCounts: Record<string, number> = {};
  for (const s of scores) {
    categoryCounts[s.errorCategory] = (categoryCounts[s.errorCategory] ?? 0) + 1;
  }

  for (const [category, count] of Object.entries(categoryCounts)) {
    if (category !== "accurate" && count > 0) {
      const pct = Math.round(count / scores.length * 100);
      improvements.push(`${category}: ${count} sites (${pct}%) — needs improvement`);
    }
  }

  return {
    round,
    totalCallSites: scores.length,
    meanErrorPercent: Math.round(mean * 10) / 10,
    medianErrorPercent: Math.round(median * 10) / 10,
    within20Percent: within20,
    within10Percent: within10,
    worstOffenders,
    improvements,
  };
}
