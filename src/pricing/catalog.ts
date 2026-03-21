export interface ModelPricing {
  provider: string;
  model: string;
  aliases: string[];
  inputPer1M: number;  // $ per 1M input tokens
  outputPer1M: number; // $ per 1M output tokens
  category: "premium" | "standard" | "economy" | "embedding";
}

// Pricing as of March 2026
export const PRICING_DATE = "March 2026";

export const PRICING_CATALOG: ModelPricing[] = [
  // Anthropic — updated March 2026
  { provider: "anthropic", model: "claude-opus-4-20250514", aliases: ["claude-opus-4", "claude-opus-4-6", "opus", "opus-4", "opus-4-6"], inputPer1M: 5, outputPer1M: 25, category: "premium" },
  { provider: "anthropic", model: "claude-sonnet-4-20250514", aliases: ["claude-sonnet-4", "claude-sonnet-4-6", "sonnet", "sonnet-4", "sonnet-4-6"], inputPer1M: 3, outputPer1M: 15, category: "standard" },
  { provider: "anthropic", model: "claude-haiku-4-5-20251001", aliases: ["claude-haiku-4-5", "claude-haiku-4", "haiku", "haiku-4", "haiku-4-5", "haiku-4.5"], inputPer1M: 0.25, outputPer1M: 1.25, category: "economy" },
  { provider: "anthropic", model: "claude-3-5-sonnet-20241022", aliases: ["claude-3-5-sonnet", "claude-3.5-sonnet"], inputPer1M: 3, outputPer1M: 15, category: "standard" },

  // OpenAI — updated March 2026
  { provider: "openai", model: "gpt-4.1", aliases: ["gpt-4.1-2025-04-14"], inputPer1M: 2, outputPer1M: 8, category: "standard" },
  { provider: "openai", model: "gpt-4.1-mini", aliases: ["gpt-4.1-mini-2025-04-14"], inputPer1M: 0.40, outputPer1M: 1.60, category: "economy" },
  { provider: "openai", model: "gpt-4.1-nano", aliases: ["gpt-4.1-nano-2025-04-14"], inputPer1M: 0.10, outputPer1M: 0.40, category: "economy" },
  { provider: "openai", model: "gpt-4o", aliases: ["gpt-4o-2024-08-06"], inputPer1M: 2.50, outputPer1M: 10, category: "standard" },
  { provider: "openai", model: "gpt-4o-mini", aliases: ["gpt-4o-mini-2024-07-18"], inputPer1M: 0.15, outputPer1M: 0.60, category: "economy" },
  { provider: "openai", model: "o3", aliases: ["o3-2025-04-16"], inputPer1M: 2, outputPer1M: 8, category: "standard" },
  { provider: "openai", model: "o3-mini", aliases: ["o3-mini-2025-01-31"], inputPer1M: 1.10, outputPer1M: 4.40, category: "standard" },
  { provider: "openai", model: "o4-mini", aliases: ["o4-mini-2025-04-16"], inputPer1M: 1.10, outputPer1M: 4.40, category: "standard" },
  { provider: "openai", model: "gpt-4-turbo", aliases: ["gpt-4-turbo-2024-04-09"], inputPer1M: 10, outputPer1M: 30, category: "premium" },
  { provider: "openai", model: "text-embedding-3-small", aliases: [], inputPer1M: 0.02, outputPer1M: 0, category: "embedding" },
  { provider: "openai", model: "text-embedding-3-large", aliases: [], inputPer1M: 0.13, outputPer1M: 0, category: "embedding" },

  // Google — updated March 2026
  { provider: "google", model: "gemini-2.5-pro", aliases: ["gemini-2.5-pro-preview"], inputPer1M: 1.25, outputPer1M: 10, category: "standard" },
  { provider: "google", model: "gemini-2.5-flash", aliases: ["gemini-2.5-flash-preview"], inputPer1M: 0.30, outputPer1M: 2.50, category: "economy" },
  { provider: "google", model: "gemini-2.5-flash-lite", aliases: [], inputPer1M: 0.10, outputPer1M: 0.40, category: "economy" },
  { provider: "google", model: "gemini-2.0-flash", aliases: ["gemini-flash", "models/gemini-2.0-flash"], inputPer1M: 0.10, outputPer1M: 0.40, category: "economy" },
  { provider: "google", model: "gemini-2.0-pro", aliases: ["gemini-pro"], inputPer1M: 1.25, outputPer1M: 5, category: "standard" },
  { provider: "google", model: "gemini-1.5-flash", aliases: [], inputPer1M: 0.075, outputPer1M: 0.30, category: "economy" },
  { provider: "google", model: "gemini-1.5-pro", aliases: [], inputPer1M: 1.25, outputPer1M: 5, category: "standard" },
  { provider: "google", model: "gemini-embedding-001", aliases: ["models/gemini-embedding-001", "text-embedding-004"], inputPer1M: 0, outputPer1M: 0, category: "embedding" },
];
