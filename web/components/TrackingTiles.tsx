// The tracking ID as eight tiles that fill in as the caller speaks.
const LENGTH = 8;

const TILE = "grid h-12 w-[38px] place-items-center rounded-xl font-mono text-xl font-bold transition-all max-[900px]:h-[42px] max-[900px]:w-8 max-[900px]:text-lg";
const FILLED = `${TILE} animate-pop border border-line bg-linear-to-br from-white/90 to-[#ffe6cd]/60 shadow-[0_8px_14px_-6px_var(--shadow),0_1px_0_#fff_inset] dusk:from-white/20 dusk:to-[#ffc896]/10`;

export function TrackingTiles({ id }: { id: string }) {
  return (
    <div className="mt-1 flex gap-2" aria-label={id ? `Tracking ID ${id.split("").join(" ")}` : "Tracking ID not heard yet"}>
      {Array.from({ length: LENGTH }, (_, index) => {
        const char = id[index];
        const style = !char
          ? `${TILE} bg-tile shadow-[0_2px_6px_rgba(120,80,50,0.12)_inset]`
          : index < 2
            ? `${FILLED} text-[#c8602f] dusk:text-peach`
            : `${FILLED} text-[#a9791d] dusk:text-[#f6c768]`;
        return (
          <span key={`${index}-${char ?? ""}`} className={style}>
            {char}
          </span>
        );
      })}
    </div>
  );
}
