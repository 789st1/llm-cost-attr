import type { AccuracyScore, HeuristicImprovement, RoundScore } from "./types.js";
import { DEFAULT_TOKENS } from "../estimator/tokens.js";

/**
 * Analyzes accuracy scores and proposes concrete heuristic improvements.
 * This is the "learning" step of the adversarial loop.
 */
export function synthesizeImprovements(
  scores: AccuracyScore[],
  roundScore: RoundScore,
): HeuristicImprovement[] {
  const improvements: HeuristicImprovement[] = [];

  // Group scores by error category
  const byCategory = new Map<string, AccuracyScore[]>();
  for (const s of scores) {
    if (s.errorCategory === "accurate") continue;
    const list = byCategory.get(s.errorCategory) ?? [];
    list.push(s);
    byCategory.set(s.errorCategory, list);
  }

  // Analyze token-default errors
  const tokenErrors = byCategory.get("token-default") ?? [];
  if (tokenErrors.length > 0) {
    // Calculate what the defaults SHOULD be based on Gemini's estimates
    const chatInputs = tokenErrors
      .filter(s => s.geminiEstimate.inputTokens > 0)
      .map(s => s.geminiEstimate.inputTokens);
    const chatOutputs = tokenErrors
      .filter(s => s.geminiEstimate.outputTokens > 0)
      .map(s => s.geminiEstimate.outputTokens);

    if (chatInputs.length > 0) {
      const avgInput = Math.round(chatInputs.reduce((a, b) => a + b, 0) / chatInputs.length);
      const currentDefault = DEFAULT_TOKENS.chat.input;

      if (Math.abs(avgInput - currentDefault) / currentDefault > 0.2) {
        improvements.push({
          type: "token-default",
          description: `Chat input token default is ${currentDefault}, but Gemini estimates average ${avgInput}`,
          before: `DEFAULT_TOKENS.chat.input = ${currentDefault}`,
          after: `DEFAULT_TOKENS.chat.input = ${avgInput}`,
          estimatedImpact: Math.min(30, Math.abs(avgInput - currentDefault) / currentDefault * 100),
        });
      }
    }

    if (chatOutputs.length > 0) {
      const avgOutput = Math.round(chatOutputs.reduce((a, b) => a + b, 0) / chatOutputs.length);
      const currentDefault = DEFAULT_TOKENS.chat.output;

      if (Math.abs(avgOutput - currentDefault) / currentDefault > 0.2) {
        improvements.push({
          type: "token-default",
          description: `Chat output token default is ${currentDefault}, but Gemini estimates average ${avgOutput}`,
          before: `DEFAULT_TOKENS.chat.output = ${currentDefault}`,
          after: `DEFAULT_TOKENS.chat.output = ${avgOutput}`,
          estimatedImpact: Math.min(30, Math.abs(avgOutput - currentDefault) / currentDefault * 100),
        });
      }
    }
  }

  // Analyze output-overestimate errors
  const outputErrors = byCategory.get("output-overestimate") ?? [];
  if (outputErrors.length > 0) {
    // Calculate the ratio of actual to max_tokens
    const ratios = outputErrors
      .filter(s => s.scannerEstimate.outputTokens > 0 && s.geminiEstimate.outputTokens > 0)
      .map(s => s.geminiEstimate.outputTokens / s.scannerEstimate.outputTokens);

    if (ratios.length > 0) {
      const avgRatio = Math.round(ratios.reduce((a, b) => a + b, 0) / ratios.length * 100) / 100;
      improvements.push({
        type: "output-scaling",
        description: `When max_tokens is set, actual output averages ${Math.round(avgRatio * 100)}% of max_tokens. Apply scaling factor.`,
        before: `outputTokens = site.maxTokens`,
        after: `outputTokens = site.maxTokens * ${avgRatio}`,
        estimatedImpact: Math.min(40, (1 - avgRatio) * 100),
      });
    }
  }

  // Analyze loop detection errors
  const loopErrors = byCategory.get("loop-detection") ?? [];
  if (loopErrors.length > 0) {
    for (const s of loopErrors) {
      const scannerMult = s.scannerEstimate.loopMultiplier;
      const geminiMult = s.geminiEstimate.loopMultiplier;
      if (scannerMult !== geminiMult) {
        improvements.push({
          type: "loop-heuristic",
          description: `${s.file}:${s.line} — scanner says ${scannerMult}x, Gemini says ${geminiMult}x loop multiplier`,
          before: `loopMultiplier = ${scannerMult}`,
          after: `loopMultiplier = ${geminiMult}`,
          estimatedImpact: Math.abs(scannerMult - geminiMult) * 10,
        });
      }
    }
  }

  // Analyze caching errors
  const cacheErrors = byCategory.get("caching") ?? [];
  if (cacheErrors.length > 0) {
    improvements.push({
      type: "cache-pattern",
      description: `${cacheErrors.length} call sites have undetected caching patterns`,
      before: "hasCaching = false",
      after: "Expand cache detection regex",
      estimatedImpact: cacheErrors.length * 5,
    });
  }

  return improvements;
}

/**
 * Apply token default improvements by returning updated default values.
 * The caller is responsible for updating the actual DEFAULT_TOKENS object.
 */
export function computeUpdatedDefaults(
  scores: AccuracyScore[],
): { chat: { input: number; output: number }; embedding: { input: number; output: number } } {
  const chatScores = scores.filter(s =>
    s.errorCategory !== "accurate" &&
    s.geminiEstimate.inputTokens > 0
  );

  const embeddingScores = scores.filter(s =>
    s.provider === "openai" || s.provider === "google"
  ).filter(s => s.model?.includes("embed"));

  const chatInputAvg = chatScores.length > 0
    ? Math.round(chatScores.reduce((sum, s) => sum + s.geminiEstimate.inputTokens, 0) / chatScores.length)
    : DEFAULT_TOKENS.chat.input;

  const chatOutputAvg = chatScores.length > 0
    ? Math.round(chatScores.reduce((sum, s) => sum + s.geminiEstimate.outputTokens, 0) / chatScores.length)
    : DEFAULT_TOKENS.chat.output;

  const embInputAvg = embeddingScores.length > 0
    ? Math.round(embeddingScores.reduce((sum, s) => sum + s.geminiEstimate.inputTokens, 0) / embeddingScores.length)
    : DEFAULT_TOKENS.embedding.input;

  return {
    chat: { input: chatInputAvg, output: chatOutputAvg },
    embedding: { input: embInputAvg, output: 0 },
  };
}
