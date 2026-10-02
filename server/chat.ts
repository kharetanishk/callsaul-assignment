// Text-only version of the agent. Type what the caller would say.
import { createInterface } from "node:readline/promises";
import { greet, handleTurn } from "./brain";
import { createBackend } from "./fakeBackend";
import { createLlm } from "./llm";
import { newSession } from "./session";

const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;

const apiKey = process.env.OPENROUTER_API_KEY;
const deps = {
  backend: createBackend({ seed: process.env.FAKE_SEED ? Number(process.env.FAKE_SEED) : undefined }),
  say: (text: string) => console.log(`Agent: ${text}`),
  log: (kind: string, text: string) => console.log(dim(`  [${kind}] ${text}`)),
  llm: apiKey ? createLlm(apiKey, process.env.OPENROUTER_MODEL ?? "google/gemma-4-26b-a4b-it:free") : undefined,
};

const session = newSession("text-chat");
const input = createInterface({ input: process.stdin, output: process.stdout });

greet(session, deps);
while (session.stage !== "DONE") {
  const text = await input.question("You: ");
  await handleTurn(session, text, deps);
}
input.close();
