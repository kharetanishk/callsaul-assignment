// Text-only version of the agent. Type what the caller would say.
import { createInterface } from "node:readline/promises";
import { greet, handleTurn } from "./brain";
import { createBackend } from "./fakeBackend";
import { createLlm, modelsFromEnv } from "./llm";
import { newSession } from "./session";

const dim = (text: string) => `\x1b[2m${text}\x1b[0m`;

const apiKey = process.env.OPENROUTER_API_KEY;
const deps = {
  backend: createBackend(),
  say: (text: string) => console.log(`Agent: ${text}`),
  log: (kind: string, text: string) => console.log(dim(`  [${kind}] ${text}`)),
  llm: apiKey ? createLlm(apiKey, modelsFromEnv(process.env.OPENROUTER_MODEL)) : undefined,
};

const session = newSession("text-chat");
const input = createInterface({ input: process.stdin, output: process.stdout });

greet(session, deps);
while (session.stage !== "DONE") {
  const text = await input.question("You: ");
  await handleTurn(session, text, deps);
}
input.close();
