import chalk from "chalk";
import Table from "cli-table3";
import path from "path";
import type { CostReport } from "../estimator/index.js";
import type { Recommendation } from "../analyzer/index.js";

function formatCost(amount: number): string {
  if (amount < 0.01) return "$" + amount.toFixed(4);
  if (amount < 1) return "$" + amount.toFixed(3);
  if (amount < 100) return "$" + amount.toFixed(2);
  return "$" + Math.round(amount).toLocaleString();
}

export function printReport(report: CostReport, recommendations: Recommendation[] = []): void {
  const { root, filesScanned, totalCallSites, estimates, totalMonthlyCost, byProvider, byFile } = report;

  console.log("");
  console.log(chalk.bold.cyan("  LLM Cost Attribution Report"));
  console.log(chalk.gray("  " + "━".repeat(50)));
  console.log(chalk.gray(`  Root: ${root}`));
  console.log(`  Scanned: ${chalk.white(filesScanned.toString())} files | Found: ${chalk.yellow(totalCallSites.toString())} LLM call sites`);
  console.log(`  Estimated monthly cost: ${chalk.bold.green(formatCost(totalMonthlyCost))} @ 1K invocations/month`);
  console.log("");

  if (estimates.length === 0) {
    console.log(chalk.gray("  No LLM API calls detected."));
    return;
  }

  // Per-file breakdown
  const fileTable = new Table({
    head: ["File", "Provider", "Model", "$/call", "Loop", "$/month"].map((h) => chalk.bold(h)),
    colWidths: [45, 12, 25, 10, 6, 12],
    style: { head: [], border: [] },
  });

  for (const est of estimates.sort((a, b) => b.monthlyCost - a.monthlyCost)) {
    const relFile = est.callSite.file.replace(root + "/", "");
    const fileWithLine = `${relFile}:${est.callSite.line}`;
    const truncFile = fileWithLine.length > 42 ? "..." + fileWithLine.slice(-39) : fileWithLine;

    fileTable.push([
      truncFile,
      est.callSite.provider,
      est.pricing?.model ?? chalk.red("unknown"),
      formatCost(est.costPerCall),
      est.callSite.inLoop ? chalk.yellow(`${est.callSite.loopMultiplier}x`) : "",
      formatCost(est.monthlyCost),
    ]);
  }

  console.log(fileTable.toString());
  console.log("");

  // Provider breakdown
  console.log(chalk.bold("  Cost by Provider:"));
  for (const [prov, cost] of Object.entries(byProvider).sort((a, b) => b[1] - a[1])) {
    const pct = ((cost / totalMonthlyCost) * 100).toFixed(0);
    console.log(`    ${prov.padEnd(12)} ${formatCost(cost).padStart(10)}  (${pct}%)`);
  }
  console.log("");

  // Optimization recommendations
  if (recommendations.length > 0) {
    console.log(chalk.bold.yellow("  Optimization Opportunities:"));
    for (const rec of recommendations) {
      const icon = rec.type === "model-downgrade" ? "⬇️" : rec.type === "caching" ? "💾" : "📦";
      const relFile = rec.file.replace(root + "/", "");
      console.log(`  ${icon}  ${chalk.white(relFile + ":" + rec.line)}`);
      console.log(`      ${rec.description}`);
      if (rec.estimatedSavings > 0) {
        console.log(chalk.green(`      Estimated savings: ${formatCost(rec.estimatedSavings)}/month`));
      }
      console.log("");
    }
  }

  if (report.errors.length > 0) {
    console.log(chalk.red(`  ${report.errors.length} file(s) had read errors.`));
  }
}

export function printComparison(reports: CostReport[]): void {
  console.log("");
  console.log(chalk.bold.cyan("  LLM Cost Comparison Report"));
  console.log(chalk.gray("  " + "━".repeat(50)));
  console.log("");

  const table = new Table({
    head: ["Repository", "Files", "Call Sites", "Providers", "Est. $/month"].map((h) => chalk.bold(h)),
    colWidths: [35, 8, 12, 20, 14],
    style: { head: [], border: [] },
  });

  let grandTotal = 0;
  for (const report of reports.sort((a, b) => b.totalMonthlyCost - a.totalMonthlyCost)) {
    const name = path.basename(path.dirname(report.root)) + "/" + path.basename(report.root);
    const providers = Object.keys(report.byProvider).join(", ");
    table.push([
      name.length > 32 ? "..." + name.slice(-29) : name,
      report.filesScanned.toString(),
      report.totalCallSites.toString(),
      providers,
      formatCost(report.totalMonthlyCost),
    ]);
    grandTotal += report.totalMonthlyCost;
  }

  console.log(table.toString());
  console.log("");
  console.log(chalk.bold(`  Grand total: ${chalk.green(formatCost(grandTotal))}/month @ 1K invocations each`));
  console.log("");
}
