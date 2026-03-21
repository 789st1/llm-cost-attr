import type { CostReport } from "../estimator/index.js";
import type { Recommendation } from "../analyzer/index.js";

export function generateJsonReport(report: CostReport, recommendations: Recommendation[] = []): string {
  return JSON.stringify({
    root: report.root,
    filesScanned: report.filesScanned,
    totalCallSites: report.totalCallSites,
    totalMonthlyCost: Math.round(report.totalMonthlyCost * 100) / 100,
    byProvider: report.byProvider,
    byFile: report.byFile,
    callSites: report.estimates.map((e) => ({
      file: e.callSite.file.replace(report.root + "/", ""),
      line: e.callSite.line,
      provider: e.callSite.provider,
      model: e.pricing?.model ?? e.callSite.model ?? "unknown",
      callType: e.callSite.callType,
      costPerCall: Math.round(e.costPerCall * 1_000_000) / 1_000_000,
      monthlyCost: Math.round(e.monthlyCost * 100) / 100,
      inLoop: e.callSite.inLoop,
      loopMultiplier: e.callSite.loopMultiplier,
      hasCaching: e.callSite.hasCaching,
      confidence: e.confidence,
    })),
    recommendations: recommendations.map((r) => ({
      type: r.type,
      file: r.file.replace(report.root + "/", ""),
      line: r.line,
      description: r.description,
      estimatedSavings: Math.round(r.estimatedSavings * 100) / 100,
    })),
    errors: report.errors,
  }, null, 2);
}
