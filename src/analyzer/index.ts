import type { CostEstimate } from "../estimator/index.js";

export interface Recommendation {
  type: "model-downgrade" | "caching" | "batching";
  file: string;
  line: number;
  description: string;
  estimatedSavings: number; // monthly
}

export function analyzeOptimizations(
  estimates: CostEstimate[],
  volume: number = 1000,
): Recommendation[] {
  const recs: Recommendation[] = [];

  for (const est of estimates) {
    // Model downgrade: premium model for what looks like simple extraction
    if (est.pricing?.category === "premium") {
      const economyPrice = est.pricing.provider === "anthropic"
        ? 0.80 / 1_000_000
        : est.pricing.provider === "openai"
        ? 0.15 / 1_000_000
        : 0.10 / 1_000_000;
      const potentialInputCost = est.inputTokens * economyPrice;
      const potentialOutputCost = est.outputTokens * (economyPrice * 4);
      const potentialCostPerCall = potentialInputCost + potentialOutputCost;
      const savings = (est.costPerCall - potentialCostPerCall) * est.callsPerInvocation * volume;

      if (savings > 0.50) { // Only recommend if saves >$0.50/month
        recs.push({
          type: "model-downgrade",
          file: est.callSite.file,
          line: est.callSite.line,
          description: `Using ${est.pricing.model} (${est.pricing.category}). Consider economy tier for ${Math.round(((est.costPerCall - potentialCostPerCall) / est.costPerCall) * 100)}% cost reduction.`,
          estimatedSavings: savings,
        });
      }
    }

    // Caching: no cache detected + appears to have static/semi-static prompts
    if (!est.callSite.hasCaching && est.callSite.callType !== "embedding") {
      // If input tokens are known and relatively small (suggesting a template prompt), flag
      if (est.callSite.estimatedInputTokens && est.callSite.estimatedInputTokens > 100) {
        const savings = est.monthlyCost * 0.5; // assume 50% cache hit rate
        if (savings > 0.50) {
          recs.push({
            type: "caching",
            file: est.callSite.file,
            line: est.callSite.line,
            description: `No response caching detected. Adding cache (Redis/in-memory) could save ~50% with repeated similar requests.`,
            estimatedSavings: savings,
          });
        }
      }
    }

    // Batching: multiple calls in a loop to the same model
    if (est.callSite.inLoop && est.callSite.loopMultiplier > 1) {
      recs.push({
        type: "batching",
        file: est.callSite.file,
        line: est.callSite.line,
        description: `${est.callSite.loopMultiplier} sequential calls in a loop. Consider batching or parallel execution to reduce latency.`,
        estimatedSavings: 0, // Latency savings, not cost
      });
    }
  }

  return recs.sort((a, b) => b.estimatedSavings - a.estimatedSavings);
}
