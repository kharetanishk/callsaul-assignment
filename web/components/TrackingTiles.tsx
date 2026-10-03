// The tracking ID as eight tiles that fill in as the caller speaks.
const LENGTH = 8;

const TILE = "grid h-12 w-[38px] place-items-center rounded-xl font-mono text-xl font-bold transition-all max-[900px]:h-[42px] max-[900px]:w-8 max-[900px]:text-lg";
const FILLED = `${TILE} animate-pop border border-line bg-linear-to-br from-white/20 to-[#ffc896]/10 shadow-[0_8px_14px_-6px_var(--shadow),0_1px_0_rgba(255,255,255,0.35)_inset]`;

export function TrackingTiles({ id }: { id: string }) {
  return (
    <div className="mt-1 flex gap-2" aria-label={id ? `Tracking ID ${id.split("").join(" ")}` : "Tracking ID not heard yet"}>
      {Array.from({ length: LENGTH }, (_, index) => {
        const char = id[index];
        const style = !char
          ? `${TILE} bg-tile shadow-[0_2px_6px_rgba(120,80,50,0.12)_inset]`
          : index < 2
            ? `${FILLED} text-peach`
            : `${FILLED} text-[#f6c768]`;
        return (
          <span key={`${index}-${char ?? ""}`} className={style}>
            {char}
          </span>
        );
      })}
    </div>
  );
}
