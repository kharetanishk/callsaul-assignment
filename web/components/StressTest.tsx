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

const SEGMENT = "cursor-pointer rounded-full px-3.5 py-2 text-[13px] transition-all hover:-translate-y-px focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold";

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
    <section className="glass rounded-[26px] p-5">
      <h2 className="mb-3.5 text-[15px] font-semibold">Stress test the booking system</h2>
      <div className="flex flex-wrap gap-2" role="radiogroup" aria-label="Booking system behaviour">
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
      <p className="mt-3 min-h-10 text-[13.5px] text-muted">{selected?.hint}</p>
    </section>
  );
}
