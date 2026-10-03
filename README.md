# Reschedule a Delivery: a voice agent

Talk to it in your browser. It asks for your tracking ID, reads it back, offers new delivery slots, and books one when you say yes. The booking system is fake and misbehaves on purpose: it can be slow, fail, or lose its reply. The agent copes without going silent and without booking twice.

The pipeline is assembled by hand, with no voice-agent platform:

```
Browser mic ──► Deepgram (speech to text) ──► Brain (rules + LLM) ──► Fake booking system
     ▲                                             │
     └──────────── Deepgram or ElevenLabs (text to speech) ◄──┘
```

---

## Run it in under five minutes

### 1. What you need
- [Bun](https://bun.sh) 1.2 or newer: `curl -fsSL https://bun.sh/install | bash`
- Chrome, or another Chromium browser, with a microphone
- A free **Deepgram** key: <https://console.deepgram.com> (new accounts get free credit)
- A free **OpenRouter** key: <https://openrouter.ai/keys> (optional, but it makes the agent much smarter)

### 2. Install and configure
```bash
git clone <this repo> && cd voice-ai-assignment
bun install
cp .env.example .env
```
Open `.env` and fill in:
```
DEEPGRAM_API_KEY=your_deepgram_key
OPENROUTER_API_KEY=your_openrouter_key
```
Leave everything else as it is.

### 3. Start
```bash
bun run dev
```
Open **http://localhost:3000**, press **Start call**, allow the microphone, and say a tracking ID such as *"B as in Bravo, D as in Delta, four one eight two zero seven"*.

Headphones give the best results. On laptop speakers the browser's echo cancellation does most of the work, but not all of it.

### 4. Check it without a microphone (optional)
```bash
bun test            # 166 tests, no keys needed
bun run typecheck   # strict TypeScript, server and browser
bun server/chat.ts  # the same agent as a text chat in the terminal
```

---

## Things to try

| Try this | What should happen |
|---|---|
| Give a wrong letter, then say *"no, B as in Bravo, not D"* | Only that letter changes, then it reads the ID back again |
| *"the last two digits are one three"* | Fixes just those two digits |
| Talk over the agent while it is speaking | It stops at once and listens |
| *"why do you need my tracking ID?"*, *"what's the weather?"* | An honest short answer, then it carries on |
| *"hold on a second"* | It waits quietly |
| Say a completely different ID after confirming one | It reads the new one back and needs a fresh yes |
| *"you can end the call"* | It says goodbye and hangs up |
| Close the tab mid-call, reopen, press **Resume call** | *"Welcome back"*, and it carries on from the same step |

### Stress test the booking system
The bar under the timeline changes how the fake booking system behaves on the **booking request**. Everything before the booking stays normal, so you always get to see the behaviour you picked.

| Option | What the agent does |
|---|---|
| Random | Each request may be fast, slow, failing or lose its reply (slot lookups can misbehave too) |
| Always works | Books straight away |
| Slow (6 s) | Says *"one moment, still checking"*, then books |
| Fails | Retries, then says *"nothing has been booked, shall I try again?"* |
| Loses the reply | The booking is saved but the reply is lost. It retries with the same key and finds it: exactly one booking |
| Never answers | Gives up after about 17 s and says so honestly |

**Bookings made** on the page, and `http://localhost:3000/api/bookings`, show that nothing is ever booked twice.

### Free and Premium
The switch in the header picks the brain and the voice for the next call:

| | Brain | Voice | Needs |
|---|---|---|---|
| **Free** (default) | Free OpenRouter models | Deepgram | Only the free keys above |
| **Premium** | Gemini 2.5 Flash, then Claude Haiku (paid, via OpenRouter) | ElevenLabs | OpenRouter credit and `ELEVENLABS_API_KEY` |

Premium is greyed out unless its keys are set. The brief asked for free tiers only, so Free is the default and everything works on it.

---

## Settings (`.env`)

| Setting | Required | What it does |
|---|---|---|
| `DEEPGRAM_API_KEY` | yes | Speech to text, and the free voice |
| `OPENROUTER_API_KEY` | recommended | The LLM. Without it the agent still works on fixed rules only |
| `OPENROUTER_MODEL` | no | Free models, tried in order |
| `OPENROUTER_PAID_MODEL` | no | Premium models, tried in order |
| `ELEVENLABS_API_KEY` | no | Turns on Premium |
| `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL` | no | The Premium voice |
| `PORT` | no | Defaults to 3000 |

---

## How it is built

| Folder | What lives there |
|---|---|
| `server/index.ts` | Web server, WebSocket, stress test and booking endpoints |
| `server/call.ts` | One live call: listening, barge-in, background voices, silence, speaking, hang-up |
| `server/brain.ts` | The conversation. Code owns the state and the rules; the LLM only helps understand and phrase |
| `server/trackingId.ts` | Turns speech into an ID: phonetic letters, *"double five"*, corrections, *"the last digit"* |
| `server/booking.ts` | Safe booking: confirm gate, one idempotency key, timeouts, retries, status check |
| `server/fakeBackend.ts` | The misbehaving courier API |
| `server/stt.ts`, `server/tts.ts`, `server/llm.ts` | Deepgram, ElevenLabs and OpenRouter clients |
| `web/` | React + Tailwind page: the agent orb, live timeline, tracking tiles, stress test |
| `test/` | 166 tests, one file per part |

The server terminal prints one coloured line per event (`HEARD`, `AGENT`, `BRAIN`, `BACKEND`, `BARGE-IN`…), so you can follow a call from the server side as well as on the page.

For the decisions, what was cut and what is still broken, see **[ONE-PAGER.md](ONE-PAGER.md)**.
