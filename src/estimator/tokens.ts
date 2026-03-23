/**
 * Simple token estimation. Uses chars/4 heuristic (close enough for cost estimation).
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Default token estimates when we can't extract from code.
 * Calibrated by adversarial accuracy loop (March 2026) against 4 real repos:
 *   - canary (TS, Anthropic+Google+OpenAI)
 *   - claimreaper (Python, LangChain+Gemini)
 *   - shopify-review-responder (TS, Google GenAI)
 *   - idea-generation (Python, Claude CLI)
 */
export const DEFAULT_TOKENS: Record<string, { input: number; output: number }> = {
  chat: { input: 625, output: 400 },
  "content-generation": { input: 625, output: 400 },
  embedding: { input: 256, output: 0 },
  "tool-use": { input: 800, output: 500 },
};

/**
 * When max_tokens is explicitly set in code, actual output is typically
 * much less than the max. This scaling factor was calibrated by comparing
 * scanner estimates (using raw max_tokens) vs. Gemini's analysis of
 * expected output length.
 *
 * 0.40 = actual output averages 40% of max_tokens across real codebases.
 */
export const OUTPUT_SCALING_FACTOR = 0.40;
