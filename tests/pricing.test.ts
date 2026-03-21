import { describe, it, expect } from "vitest";
import { resolveModel, listPricing } from "../src/pricing/index.js";

describe("Pricing Resolver", () => {
  it("resolves exact model names", () => {
    const result = resolveModel("claude-haiku-4-5-20251001");
    expect(result).not.toBeNull();
    expect(result!.inputPer1M).toBe(0.25);
    expect(result!.outputPer1M).toBe(1.25);
  });

  it("resolves aliases", () => {
    const result = resolveModel("sonnet");
    expect(result).not.toBeNull();
    expect(result!.model).toContain("sonnet");
    expect(result!.inputPer1M).toBe(3);
  });

  it("resolves gemini flash", () => {
    const result = resolveModel("gemini-2.0-flash");
    expect(result).not.toBeNull();
    expect(result!.inputPer1M).toBe(0.10);
  });

  it("resolves text-embedding-3-small", () => {
    const result = resolveModel("text-embedding-3-small");
    expect(result).not.toBeNull();
    expect(result!.inputPer1M).toBe(0.02);
    expect(result!.outputPer1M).toBe(0);
  });

  it("returns null for unknown models", () => {
    const result = resolveModel("unknown-model-xyz");
    expect(result).toBeNull();
  });

  it("handles default for claude-cli provider", () => {
    const result = resolveModel(null, "claude-cli");
    expect(result).not.toBeNull();
    expect(result!.model).toContain("sonnet");
  });

  it("lists all pricing", () => {
    const pricing = listPricing();
    expect(pricing.length).toBeGreaterThan(10);
  });
});
