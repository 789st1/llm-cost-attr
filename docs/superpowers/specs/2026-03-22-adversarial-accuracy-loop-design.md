# Adversarial Accuracy Loop — Design Spec

## Problem
llm-cost-attr v0.1 uses hardcoded default token counts (input: 500, output: 300). Estimates can be off by 2-5x. No self-improvement mechanism.

## Solution
Adversarial self-improvement loop: generate test cases → estimate → Gemini audits → compare → learn → improve heuristics → repeat until ±20% accuracy (target ±10%).

## Components
1. Test Case Generator — synthetic + real repo test cases with ground truth
2. Gemini Auditor — independent "second opinion" estimates per call site
3. Accuracy Scorer — measures divergence between scanner and Gemini
4. Learnings Synthesizer — categorizes errors, proposes heuristic improvements
5. Smart Mode (--smart flag) — Gemini-augmented estimates in regular scans
6. GitHub Action — CI/CD cost budgets, PR comments

## Convergence: ≥90% call sites within ±20% of Gemini estimate, max 10 rounds.
## Cost: ~$0.15 for full loop. ~$0.005 per smart scan.
