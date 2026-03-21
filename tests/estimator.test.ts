import { describe, it, expect } from "vitest";
import { estimateCosts } from "../src/estimator/index.js";
import type { CallSite } from "../src/scanner/types.js";

describe("Cost Estimator", () => {
  it("calculates cost for a simple call site", () => {
    const sites: CallSite[] = [{
      file: "/test/file.ts",
      line: 10,
      provider: "google",
      callType: "content-generation",
      model: "gemini-2.0-flash",
      maxTokens: 300,
      estimatedInputTokens: 500,
      inLoop: false,
      loopMultiplier: 1,
      hasCaching: false,
      confidence: "high",
      rawSnippet: "test",
    }];

    const report = estimateCosts(sites, "/test", 10, 1000);
    expect(report.totalCallSites).toBe(1);
    expect(report.totalMonthlyCost).toBeGreaterThan(0);
    expect(report.byProvider["google"]).toBeGreaterThan(0);
  });

  it("multiplies cost by loop multiplier", () => {
    const sites: CallSite[] = [{
      file: "/test/file.ts",
      line: 10,
      provider: "anthropic",
      callType: "chat",
      model: "claude-haiku-4-5-20251001",
      maxTokens: 150,
      estimatedInputTokens: 500,
      inLoop: true,
      loopMultiplier: 5,
      hasCaching: false,
      confidence: "high",
      rawSnippet: "test",
    }];

    const report = estimateCosts(sites, "/test", 10, 1000);
    const singleCall = report.estimates[0].costPerCall;
    expect(report.totalMonthlyCost).toBeCloseTo(singleCall * 5 * 1000, 4);
  });

  it("handles unknown models gracefully", () => {
    const sites: CallSite[] = [{
      file: "/test/file.ts",
      line: 10,
      provider: "openai",
      callType: "chat",
      model: "unknown-model",
      maxTokens: null,
      estimatedInputTokens: null,
      inLoop: false,
      loopMultiplier: 1,
      hasCaching: false,
      confidence: "low",
      rawSnippet: "test",
    }];

    const report = estimateCosts(sites, "/test", 10, 1000);
    expect(report.totalCallSites).toBe(1);
    expect(report.totalMonthlyCost).toBe(0); // no pricing = $0
  });
});
