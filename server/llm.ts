export type ChatTurn = { role: "user" | "assistant"; content: string };
export type Llm = (system: string, turns: ChatTurn[]) => Promise<string>;

// The whole answer must arrive within this, or the agent carries on without it.
const TIMEOUT_MS = 4500;
// One model gets this long before the next one is tried.
const PER_MODEL_MS = 2200;
const MAX_TOKENS = 160;
// A model that says it is rate limited is skipped for this long.
const COOL_DOWN_MS = 60_000;

// Free models are rate limited and sometimes slow, so they are tried one after another, fastest first, each with a
// short time limit. Asking them all at once would use up the free quota several times faster.
// Reasoning is switched off: it adds seconds and can use up the whole token budget before any answer is written.
export function createLlm(apiKey: string, models: string[]): Llm {
  const restingUntil = new Map<string, number>();

  return async (system, turns) => {
    const deadline = Date.now() + TIMEOUT_MS;
    const failures: string[] = [];
    const ready = models.filter((model) => (restingUntil.get(model) ?? 0) < Date.now());

    for (const model of ready.length ? ready : models) {
      const timeLeft = deadline - Date.now();
      if (timeLeft <= 0) break;
      try {
        const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
          method: "POST",
          headers: { Authorization: `Bearer ${apiKey}`, "Content-Type": "application/json" },
          body: JSON.stringify({
            model,
            max_tokens: MAX_TOKENS,
            temperature: 0.2,
            reasoning: { enabled: false },
            messages: [{ role: "system", content: system }, ...turns],
          }),
          signal: AbortSignal.timeout(Math.min(PER_MODEL_MS, timeLeft)),
        });
        if (response.status === 429) restingUntil.set(model, Date.now() + COOL_DOWN_MS);
        if (!response.ok) throw new Error(`answered ${response.status}`);
        const data = (await response.json()) as { choices?: { message?: { content?: string | null } }[] };
        const answer = data.choices?.[0]?.message?.content?.trim();
        if (!answer) throw new Error("empty answer");
        return answer;
      } catch (error) {
        failures.push(`${model.split("/").pop()}: ${(error as Error).message}`);
      }
    }
    throw new Error(failures.length ? failures.join(", ") : "no model answered in time");
  };
}

// "a,b,c" from the environment, with a default list that was checked to answer quickly on the free tier.
export function modelsFromEnv(value: string | undefined): string[] {
  const list = (value ?? "").split(",").map((model) => model.trim()).filter(Boolean);
  return list.length ? list : DEFAULT_MODELS;
}

const DEFAULT_MODELS = [
  "nvidia/nemotron-3-super-120b-a12b:free",
  "nvidia/nemotron-3-nano-omni-30b-a3b-reasoning:free",
  "inclusionai/ling-3.0-flash-sante:free",
  "cohere/north-mini-code:free",
];
