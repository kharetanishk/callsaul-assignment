// Lets a reviewer make the fake booking system misbehave on purpose and see how the agent copes.
import { useEffect, useState } from "react";

const OPTIONS = [
  { mode: "random", label: "Random", hint: "Each booking request misbehaves at random: fast, slow, failing, or losing its reply." },
  { mode: "ok", label: "Always works", hint: "Every request answers quickly. The normal happy path." },
  { mode: "slow", label: "Slow (6 s)", hint: "The booking request takes about 6 seconds. The agent says it is still checking, then succeeds." },
  { mode: "fail", label: "Fails", hint: "The booking request errors every time. The agent retries, then says nothing was booked." },
  { mode: "lostack", label: "Loses the reply", hint: "The booking is saved but the confirmation is lost. The agent retries safely and still books exactly once." },
  { mode: "hang", label: "Never answers", hint: "The booking request never replies. The agent gives up cleanly after about 17 seconds." },
];

const SEGMENT = "cursor-pointer rounded-full px-3 py-1 text-xs transition-all hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";

export function StressTest() {
  const [mode, setMode] = useState("random");

  // The server remembers the setting, so ask it instead of assuming.
  useEffect(() => {
    fetch("/api/chaos")
      .then((response) => response.json())
      .then((data) => setMode(data.mode))
      .catch(() => {});
  }, []);

  const choose = (next: string) => {
    setMode(next);
    fetch(`/api/chaos?mode=${next}`).catch(() => {});
  };

  const selected = OPTIONS.find((option) => option.mode === mode);

  return (
    <section className="glass flex-none rounded-[22px] px-4 py-3">
      <div className="flex flex-wrap items-center gap-1.5" role="radiogroup" aria-label="Booking system behaviour">
        <h2 className="mr-1.5 text-[11px] font-semibold tracking-wider text-muted uppercase">Booking system</h2>
        {OPTIONS.map((option) => (
          <button
            key={option.mode}
            type="button"
            role="radio"
            aria-checked={option.mode === mode}
            onClick={() => choose(option.mode)}
            className={
              option.mode === mode
                ? `${SEGMENT} gold-surface font-semibold`
                : `${SEGMENT} glass text-ink shadow-[0_6px_12px_-8px_var(--shadow)]`
            }
          >
            {option.label}
          </button>
        ))}
      </div>
      <p className="mt-1.5 truncate text-xs text-muted" title={selected?.hint}>{selected?.hint}</p>
    </section>
  );
}
