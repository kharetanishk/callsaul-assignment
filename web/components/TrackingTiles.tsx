// The tracking ID as eight tiles that fill in as the caller speaks.
// Tiles with a dashed edge are what the agent heard. They turn solid gold only after the caller says yes.
const LENGTH = 8;

const TILE = "grid h-12 w-[38px] place-items-center rounded-xl font-mono text-xl font-bold transition-all max-[900px]:h-[42px] max-[900px]:w-8 max-[900px]:text-lg";
const FILLED = `${TILE} animate-pop bg-linear-to-br from-white/20 to-[#ffc896]/10`;
const HEARD = `${FILLED} border border-dashed border-peach/70 shadow-[0_8px_14px_-6px_var(--shadow)]`;
const CONFIRMED = `${FILLED} border border-gold shadow-[0_0_16px_-2px_rgba(246,199,104,0.65),0_1px_0_rgba(255,255,255,0.35)_inset]`;

type Props = { id: string; confirmed: boolean };

export function TrackingTiles({ id, confirmed }: Props) {
  const status = !id ? "" : confirmed ? "Confirmed" : "Waiting for your yes";
  return (
    <div className="mt-1 grid justify-items-center gap-2">
      <div className="flex gap-2" aria-label={id ? `Tracking ID ${id.split("").join(" ")}, ${status}` : "Tracking ID not heard yet"}>
        {Array.from({ length: LENGTH }, (_, index) => {
          const char = id[index];
          const colour = index < 2 ? "text-peach" : "text-[#f6c768]";
          const style = !char ? `${TILE} bg-tile shadow-[0_2px_6px_rgba(120,80,50,0.12)_inset]` : `${confirmed ? CONFIRMED : HEARD} ${colour}`;
          return (
            <span key={`${index}-${char ?? ""}`} className={style}>
              {char}
            </span>
          );
        })}
      </div>
      <p className={`h-4 text-xs ${confirmed ? "text-gold" : "text-peach"}`}>{status}</p>
    </div>
  );
}
