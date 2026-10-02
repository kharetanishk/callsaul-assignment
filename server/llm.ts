export type Llm = (system: string, user: string) => Promise<string>;

export function createLlm(apiKey: string, model: string): Llm {
  return async (system, user) => {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model,
        max_tokens: 80,
        messages: [
          { role: "system", content: system },
          { role: "user", content: user },
        ],
      }),
      signal: AbortSignal.timeout(3000),
    });
    if (!response.ok) throw new Error(`LLM error ${response.status}`);
    const data = (await response.json()) as { choices: { message: { content: string } }[] };
    return data.choices[0]!.message.content.trim();
  };
}
