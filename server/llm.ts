export type ChatTurn = { role: "user" | "assistant"; content: string };
export type Llm = (system: string, turns: ChatTurn[]) => Promise<string>;

const TIMEOUT_MS = 4000;
const MAX_TOKENS = 120;

// OpenRouter tries the models in order, so one rate-limited free model does not break the call.
export function createLlm(apiKey: string, models: string[]): Llm {
  return async (system, turns) => {
    const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        models,
        max_tokens: MAX_TOKENS,
        temperature: 0.3,
        messages: [{ role: "system", content: system }, ...turns],
      }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`LLM error ${response.status}`);
    const data = (await response.json()) as { choices?: { message?: { content?: string | null } }[] };
    const answer = data.choices?.[0]?.message?.content?.trim();
    // Some free models answer with nothing at all. That is a failure, not an answer.
    if (!answer) throw new Error("LLM gave an empty answer");
    return answer;
  };
}

// "a,b,c" from the environment, with a default that has been checked to answer in time.
export function modelsFromEnv(value: string | undefined): string[] {
  const list = (value ?? "").split(",").map((model) => model.trim()).filter(Boolean);
  return list.length ? list : ["poolside/laguna-s-2.1:free", "google/gemma-4-26b-a4b-it:free"];
}
