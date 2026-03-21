# llm-cost-attr

FinOps cost attribution tool for LLM API usage. Scans your codebase, finds every LLM API call, estimates costs, and recommends optimizations.

Think of it as a **cost linter** for AI spend.

## Install

```bash
npx llm-cost-attr scan .
```

Or install globally:

```bash
npm install -g llm-cost-attr
llm-cost-attr scan .
```

## What it does

1. **Scans** your codebase for LLM API calls across 5 providers
2. **Estimates** monthly costs based on current model pricing
3. **Detects** loops, caching patterns, and batch opportunities
4. **Recommends** optimizations (model downgrades, caching, batching)

## Supported Providers

| Provider | Detection Pattern |
|----------|------------------|
| **OpenAI** | `openai.chat.completions.create()`, `openai.embeddings.create()` |
| **Anthropic** | `client.messages.create()` |
| **Google GenAI** | `model.generateContent()`, `model.embedContent()` |
| **LangChain** | `ChatGoogleGenerativeAI`, `ChatOpenAI`, `ChatAnthropic`, `.invoke()`, `.ainvoke()` |
| **Claude CLI** | `claude -p` subprocess calls |

Works with both **TypeScript/JavaScript** and **Python** codebases.

## Usage

### Scan a repository

```bash
llm-cost-attr scan /path/to/repo
```

### Set monthly invocation volume

```bash
llm-cost-attr scan /path/to/repo --volume 10000
```

### Output formats

```bash
# Terminal (default)
llm-cost-attr scan /path/to/repo

# JSON (for CI pipelines)
llm-cost-attr scan /path/to/repo -f json -o report.json

# HTML dashboard
llm-cost-attr scan /path/to/repo -f html -o report.html
```

### Compare multiple repos

```bash
llm-cost-attr compare /repo1 /repo2 /repo3
```

### View pricing

```bash
llm-cost-attr pricing
```

## Example Output

```
  LLM Cost Attribution Report
  ━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
  Scanned: 193 files | Found: 5 LLM call sites
  Estimated monthly cost: $9.07 @ 1K invocations/month

┌──────────────────────────┬───────────┬──────────────────┬──────────┬──────┬──────────┐
│ File                     │ Provider  │ Model            │ $/call   │ Loop │ $/month  │
├──────────────────────────┼───────────┼──────────────────┼──────────┼──────┼──────────┤
│ src/aggregation.ts:232   │ anthropic │ claude-haiku-4-5 │ $0.0016  │ 5x   │ $8.00    │
│ src/llm-scorer.ts:178    │ anthropic │ claude-haiku-4-5 │ $0.0010  │ 5x   │ $5.00    │
│ src/llm-scorer.ts:163    │ google    │ gemini-2.0-flash │ $0.0001  │ 5x   │ $0.31    │
└──────────────────────────┴───────────┴──────────────────┴──────────┴──────┴──────────┘

  Optimization Opportunities:
  📦  src/aggregation.ts:232
      5 sequential calls in a loop. Consider batching or parallel execution.
```

## How it works

**Static analysis** — no runtime proxy, no API keys needed. The tool:

1. Walks your codebase (respects `.gitignore`)
2. Detects SDK imports (OpenAI, Anthropic, Google GenAI, LangChain)
3. Finds API call sites using regex + heuristic analysis
4. Extracts model names, max_tokens, prompt sizes
5. Detects loops (including cross-function call chains)
6. Checks for existing caching (Redis, in-memory)
7. Calculates costs using current provider pricing
8. Generates optimization recommendations

## Pricing Data

Built-in pricing for all major models (updated March 2026):

- **Anthropic**: Opus 4 ($15/$75), Sonnet 4 ($3/$15), Haiku 4.5 ($0.80/$4)
- **OpenAI**: GPT-4o ($2.50/$10), GPT-4o-mini ($0.15/$0.60), o1/o3
- **Google**: Gemini 2.0 Flash ($0.10/$0.40), Gemini 2.0 Pro ($1.25/$5)

Per 1M tokens (input/output). Run `llm-cost-attr pricing` for the full list.

## License

MIT
