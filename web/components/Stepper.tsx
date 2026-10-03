import type { Stage } from "../../server/session";

const STEPS = ["Tracking ID", "Confirm ID", "Pick a slot", "Confirm slot", "Booked"];
const ACTIVE_STEP: Record<Stage, number> = { ASK_ID: 0, CONFIRM_ID: 1, OFFER_SLOTS: 2, CONFIRM_SLOT: 3, BOOKING: 4, DONE: 5 };

const DOT = "relative z-10 size-3 rounded-full transition-all duration-300";

export function Stepper({ stage }: { stage?: Stage }) {
  const active = stage ? ACTIVE_STEP[stage] : -1;
  return (
    <ol className="flex" aria-label="Progress">
      {STEPS.map((name, index) => {
        const done = index < active;
        const current = index === active;
        return (
          <li
            key={name}
            className={`relative grid flex-1 justify-items-center gap-1 text-center text-[11px] whitespace-nowrap before:absolute before:top-[5px] before:right-1/2 before:h-0.5 before:w-full first:before:hidden ${
              done || current ? "before:bg-linear-to-r before:from-gold before:to-peach" : "before:bg-tile"
            } ${current ? "font-semibold text-ink" : "text-muted"}`}
          >
            <span
              className={
                done
                  ? `${DOT} bg-[radial-gradient(circle_at_35%_30%,#fff,var(--color-gold)_60%,#d98543)] shadow-[0_4px_8px_-2px_var(--shadow)]`
                  : current
                    ? `${DOT} animate-current bg-[radial-gradient(circle_at_35%_30%,#fff,var(--color-peach)_60%,#e08a52)] shadow-[0_0_0_4px_rgba(255,182,140,0.3),0_4px_10px_-2px_var(--shadow)]`
                    : `${DOT} bg-tile shadow-[0_2px_4px_rgba(120,80,50,0.2)_inset]`
              }
            />
            <span>{name}</span>
          </li>
        );
      })}
    </ol>
  );
}
