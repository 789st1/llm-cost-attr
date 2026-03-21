/**
 * Simple token estimation. Uses chars/4 heuristic (close enough for cost estimation).
 * For more accuracy, integrate tiktoken later.
 */
export function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

/**
 * Default token estimates when we can't extract from code.
 */
export const DEFAULT_TOKENS = {
  chat: { input: 500, output: 300 },
  "content-generation": { input: 500, output: 300 },
  embedding: { input: 256, output: 0 },
  "tool-use": { input: 800, output: 500 },
};
