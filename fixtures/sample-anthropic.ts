import Anthropic from "@anthropic-ai/sdk";

const client = new Anthropic();

async function summarize(text: string) {
  const response = await client.messages.create({
    model: "claude-haiku-4-5-20251001",
    max_tokens: 150,
    messages: [{ role: "user", content: `Summarize: ${text}` }],
    system: "You are a concise summarizer.",
  });
  return response;
}
