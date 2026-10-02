// Streams caller audio (16 kHz PCM16) to Deepgram and reports what was said.

export type Stt = { send: (audio: Uint8Array) => void; close: () => void };

type Handlers = {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  // Speech that was heard but too uncertain to trust, for example in loud background noise.
  onUnclear: (text: string, confidence: number) => void;
  onError: (message: string) => void;
};

// Wrong characters in a tracking ID are worse than a repeated request, so doubtful speech is dropped.
const MIN_CONFIDENCE = 0.5;

export function createStt(apiKey: string, handlers: Handlers): Stt {
  const params = new URLSearchParams({
    model: "nova-3",
    encoding: "linear16",
    sample_rate: "16000",
    channels: "1",
    interim_results: "true",
    endpointing: "700",
    utterance_end_ms: "1500",
  });
  const socket = new WebSocket(`wss://api.deepgram.com/v1/listen?${params}`, {
    headers: { Authorization: `Token ${apiKey}` },
  });

  const waiting: Uint8Array[] = [];
  let sentence = "";

  const flush = () => {
    if (!sentence) return;
    const text = sentence;
    sentence = "";
    handlers.onFinal(text);
  };

  socket.onopen = () => {
    for (const audio of waiting.splice(0)) socket.send(audio);
  };
  socket.onerror = () => handlers.onError("Speech recognition connection error");
  socket.onclose = () => handlers.onError("Speech recognition disconnected");
  socket.onmessage = (event) => {
    const message = JSON.parse(String(event.data));
    if (message.type === "UtteranceEnd") return flush();
    if (message.type !== "Results") return;

    const alternative = message.channel.alternatives[0];
    const text: string = alternative?.transcript ?? "";
    if (!message.is_final) {
      if (text) handlers.onInterim(`${sentence} ${text}`.trim());
      return;
    }

    const confidence: number = alternative?.confidence ?? 1;
    if (text && confidence < MIN_CONFIDENCE) handlers.onUnclear(text, confidence);
    else if (text) sentence = `${sentence} ${text}`.trim();
    if (message.speech_final) flush();
  };

  return {
    send: (audio) => (socket.readyState === WebSocket.OPEN ? socket.send(audio) : waiting.push(audio)),
    close: () => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: "CloseStream" }));
      socket.onclose = null;
      socket.close();
    },
  };
}
