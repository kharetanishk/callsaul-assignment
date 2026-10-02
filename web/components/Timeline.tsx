import { useEffect, useRef, useState } from "react";
import type { TimelineItem } from "../useCall";

const formatTime = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;

const DOT_COLOURS: Record<string, string> = {
  info: "bg-peach",
  good: "bg-good",
  warn: "bg-warn",
  backend: "bg-warn",
  bad: "bg-bad",
};

function Entry({ item }: { item: TimelineItem }) {
  if (item.kind === "user" || item.kind === "agent") {
    const mine = item.kind === "user";
    return (
      <div
        className={`animate-rise max-w-[82%] rounded-[18px] px-3.5 pt-2.5 pb-2 ${
          mine
            ? "glass justify-self-end rounded-br-md"
            : "justify-self-start rounded-bl-md border border-[#ffbe8c]/55 bg-linear-to-br from-[#ffc496]/50 to-[#ffaa8c]/25"
        }`}
      >
        <span className="mb-0.5 block text-[11px] font-bold tracking-widest text-muted uppercase">{mine ? "You" : "Agent"}</span>
        <p className="text-[14.5px]">{item.text}</p>
        <time className="mt-1 block text-[11px] text-muted tabular-nums">{formatTime(item.seconds)}</time>
      </div>
    );
  }
  const important = item.kind === "good" || item.kind === "bad";
  return (
    <div className={`animate-rise flex flex-wrap items-baseline gap-x-2 gap-y-1 rounded-xl bg-tile px-3 py-1.5 text-[13px] ${important ? "text-ink" : "text-muted"}`}>
      <span className={`size-[7px] flex-none self-center rounded-full ${DOT_COLOURS[item.kind]}`} />
      {item.kind === "backend" && <strong className="text-[11px] tracking-wider text-gold uppercase">Booking system</strong>}
      <span>{item.text}</span>
      <time className="ml-auto text-[11px] text-muted tabular-nums">{formatTime(item.seconds)}</time>
    </div>
  );
}

type Props = { items: TimelineItem[]; interim: string };

export function Timeline({ items, interim }: Props) {
  const [technical, setTechnical] = useState(false);
  const feed = useRef<HTMLDivElement>(null);
  const shown = technical ? items : items.filter((item) => !item.technical);

  // Scroll only the feed. scrollIntoView would also move the whole page.
  useEffect(() => feed.current?.scrollTo({ top: feed.current.scrollHeight, behavior: "smooth" }), [shown.length, interim]);

  return (
    <section className="glass rounded-[26px] p-5">
      <header className="mb-3 flex items-center justify-between">
        <h2 className="text-[15px] font-semibold">Call timeline</h2>
        <label className="inline-flex cursor-pointer items-center gap-2 text-[13px] text-muted">
          <input type="checkbox" className="peer sr-only" checked={technical} onChange={(event) => setTechnical(event.target.checked)} />
          <span className="relative h-5 w-9 rounded-full bg-tile shadow-[0_2px_4px_rgba(120,80,50,0.2)_inset] transition-colors after:absolute after:top-0.5 after:left-0.5 after:size-4 after:rounded-full after:bg-white after:shadow-[0_2px_4px_rgba(120,80,50,0.3)] after:transition-transform peer-checked:bg-linear-to-r peer-checked:from-gold peer-checked:to-peach peer-checked:after:translate-x-4 peer-focus-visible:outline-2 peer-focus-visible:outline-offset-2 peer-focus-visible:outline-gold" />
          Technical details
        </label>
      </header>
      <div ref={feed} className="grid max-h-[440px] gap-2.5 overflow-y-auto pr-1" aria-live="polite">
        {shown.length === 0 && !interim && <p className="py-6 text-center text-muted">The conversation will appear here as you talk.</p>}
        {shown.map((item) => (
          <Entry key={item.id} item={item} />
        ))}
        {interim && (
          <div className="glass max-w-[82%] justify-self-end rounded-[18px] rounded-br-md px-3.5 pt-2.5 pb-2 italic opacity-60">
            <span className="mb-0.5 block text-[11px] font-bold tracking-widest text-muted uppercase not-italic">You</span>
            <p className="text-[14.5px]">{interim}</p>
          </div>
        )}
      </div>
    </section>
  );
}
