// The agent's face: a glowing orb that behaves differently when connecting, listening, thinking and speaking.
import { useEffect, useRef } from "react";
import type { Levels, Phase } from "../useCall";

type Props = { phase: Phase; levels: Levels };

// How the orb should look in each phase. The drawing code eases towards these numbers.
type Look = { wobble: number; spin: number; glow: number; size: number; ripples: number; comet: number; swirl: number };

const LOOKS: Record<Phase, Look> = {
  idle: { wobble: 0.012, spin: 0.15, glow: 0.35, size: 1, ripples: 0, comet: 0, swirl: 0 },
  connecting: { wobble: 0.01, spin: 1.4, glow: 0.5, size: 0.94, ripples: 0, comet: 1, swirl: 0 },
  reconnecting: { wobble: 0.01, spin: 1.4, glow: 0.4, size: 0.92, ripples: 0, comet: 1, swirl: 0 },
  listening: { wobble: 0.02, spin: 0.25, glow: 0.55, size: 1, ripples: 1, comet: 0, swirl: 0 },
  thinking: { wobble: 0.035, spin: 1.8, glow: 0.7, size: 0.9, ripples: 0, comet: 0, swirl: 1 },
  speaking: { wobble: 0.05, spin: 0.6, glow: 0.8, size: 1.02, ripples: 0, comet: 0, swirl: 0 },
};

const EASING = 0.06;
const RING_POINTS = 140;
const SWIRL_DOTS = 12;
const TAU = Math.PI * 2;

const PALETTE = {
  highlight: "#fffaf2",
  peach: "#ffb68c",
  gold: "#f6c768",
  rose: "#ff958b",
  amber: "#d98543",
};

export function AgentOrb({ phase, levels }: Props) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const phaseRef = useRef(phase);
  phaseRef.current = phase;

  useEffect(() => {
    const element = canvas.current!;
    const context = element.getContext("2d")!;
    const look = { ...LOOKS.idle };
    let level = 0;
    let spinAngle = 0;
    let frame = 0;
    const startedAt = performance.now();

    const resize = () => {
      const ratio = window.devicePixelRatio || 1;
      element.width = element.clientWidth * ratio;
      element.height = element.clientHeight * ratio;
      context.setTransform(ratio, 0, 0, ratio, 0, 0);
    };
    resize();
    window.addEventListener("resize", resize);

    const draw = (now: number) => {
      const t = (now - startedAt) / 1000;
      const width = element.clientWidth;
      const height = element.clientHeight;
      const current = phaseRef.current;

      // The orb follows the agent's voice while it speaks and the caller's voice otherwise.
      const heard = current === "speaking" ? levels.agent() : current === "listening" ? levels.caller() : 0;
      level += (heard - level) * 0.25;

      const target = LOOKS[current];
      for (const key of Object.keys(target) as (keyof Look)[]) look[key] += (target[key] - look[key]) * EASING;
      spinAngle += look.spin * 0.016;

      const radius = Math.min(width, height) * 0.31 * look.size * (1 + level * 0.06);
      const centerX = width / 2;
      const centerY = height * 0.48;
      const energy = look.wobble + level * (current === "speaking" ? 0.2 : 0.1);

      context.clearRect(0, 0, width, height);
      drawFloorShadow(context, centerX, centerY, radius, look.glow);
      drawHalo(context, centerX, centerY, radius, look.glow + level * 0.4);
      drawBody(context, centerX, centerY, radius, t);
      drawRipples(context, centerX, centerY, radius, t, look.ripples, level);
      for (let layer = 0; layer < 3; layer++) drawRing(context, centerX, centerY, radius, t, spinAngle, layer, energy);
      drawComet(context, centerX, centerY, radius * 1.12, spinAngle, look.comet);
      drawSwirl(context, centerX, centerY, radius * 1.16, t, spinAngle, look.swirl);

      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);

    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("resize", resize);
    };
  }, [levels]);

  return <canvas ref={canvas} className="block size-full" role="img" aria-label={`Agent is ${phase}`} />;
}

// A soft shadow under the orb makes it look like it floats above the card.
function drawFloorShadow(c: CanvasRenderingContext2D, x: number, y: number, r: number, glow: number) {
  c.save();
  c.translate(x, y + r * 1.5);
  c.scale(1, 0.16);
  const gradient = c.createRadialGradient(0, 0, 0, 0, 0, r * 1.05);
  gradient.addColorStop(0, `rgba(160, 90, 40, ${0.28 + glow * 0.12})`);
  gradient.addColorStop(1, "rgba(160, 90, 40, 0)");
  c.fillStyle = gradient;
  c.beginPath();
  c.arc(0, 0, r * 1.05, 0, TAU);
  c.fill();
  c.restore();
}

function drawHalo(c: CanvasRenderingContext2D, x: number, y: number, r: number, strength: number) {
  const gradient = c.createRadialGradient(x, y, r * 0.5, x, y, r * 2.1);
  gradient.addColorStop(0, `rgba(255, 190, 130, ${Math.min(0.55, strength * 0.5)})`);
  gradient.addColorStop(0.5, `rgba(255, 170, 140, ${Math.min(0.2, strength * 0.2)})`);
  gradient.addColorStop(1, "rgba(255, 190, 130, 0)");
  c.fillStyle = gradient;
  c.fillRect(x - r * 2.2, y - r * 2.2, r * 4.4, r * 4.4);
}

// The sphere is a rotating dot-matrix globe lit from the top left: dots are bigger and brighter where light hits.
const DOTS = 900;
const GOLDEN = Math.PI * (3 - Math.sqrt(5));
const SPHERE = Array.from({ length: DOTS }, (_, i) => {
  const y = 1 - ((i + 0.5) / DOTS) * 2;
  const ring = Math.sqrt(1 - y * y);
  return [Math.cos(i * GOLDEN) * ring, y, Math.sin(i * GOLDEN) * ring] as const;
});

function drawBody(c: CanvasRenderingContext2D, x: number, y: number, r: number, t: number) {
  const body = r * 0.8;
  const cos = Math.cos(t * 0.3);
  const sin = Math.sin(t * 0.3);
  const dot = body * 0.017;
  for (const [px, py, pz] of SPHERE) {
    const rx = px * cos + pz * sin;
    const rz = -px * sin + pz * cos;
    const light = Math.max(0, rx * -0.4 + py * -0.5 + rz * 0.77);
    const front = rz > 0;
    const size = dot * (front ? 0.6 + light * 1.1 : 0.45);
    c.fillStyle = front
      ? `rgba(${Math.round(225 + light * 30)}, ${Math.round(140 + light * 110)}, ${Math.round(95 + light * 130)}, ${0.45 + light * 0.55})`
      : "rgba(210, 130, 90, 0.16)";
    c.beginPath();
    c.arc(x + rx * body, y + py * body, size, 0, TAU);
    c.fill();
  }
}

// Expanding circles that show the orb is hearing the caller.
function drawRipples(c: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, amount: number, level: number) {
  if (amount < 0.02) return;
  for (let i = 0; i < 2; i++) {
    const progress = ((t * 0.45 + i * 0.5) % 1);
    c.strokeStyle = `rgba(246, 180, 110, ${(1 - progress) * 0.35 * amount * (0.5 + level * 2)})`;
    c.lineWidth = 2;
    c.beginPath();
    c.arc(x, y, r * (1 + progress * 0.55), 0, TAU);
    c.stroke();
  }
}

// A wobbling ring. Each layer is slightly bigger, thinner and out of step with the one before.
function drawRing(c: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, spin: number, layer: number, energy: number) {
  const base = r * (0.96 + layer * 0.055);
  const offset = layer * 1.7;
  c.beginPath();
  for (let i = 0; i <= RING_POINTS; i++) {
    const angle = (i / RING_POINTS) * TAU;
    const wave =
      Math.sin(angle * 3 + t * 1.1 + offset) * 0.5 +
      Math.sin(angle * 5 - t * 0.8 + offset * 2) * 0.3 +
      Math.sin(angle * 8 + t * 1.7 - offset) * 0.2;
    const radius = base * (1 + energy * wave);
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) c.moveTo(px, py);
    else c.lineTo(px, py);
  }
  c.closePath();

  if (layer === 0) {
    const fill = c.createRadialGradient(x, y, base * 0.3, x, y, base * 1.1);
    fill.addColorStop(0, "rgba(255, 214, 160, 0)");
    fill.addColorStop(0.8, "rgba(255, 190, 130, 0.22)");
    fill.addColorStop(1, "rgba(255, 150, 130, 0.12)");
    c.fillStyle = fill;
    c.fill();
  }

  const tilt = spin * (layer % 2 ? -1 : 1) + layer;
  const gradient = c.createLinearGradient(
    x + Math.cos(tilt) * base,
    y + Math.sin(tilt) * base,
    x - Math.cos(tilt) * base,
    y - Math.sin(tilt) * base,
  );
  gradient.addColorStop(0, PALETTE.highlight);
  gradient.addColorStop(0.3, PALETTE.gold);
  gradient.addColorStop(0.65, PALETTE.peach);
  gradient.addColorStop(1, PALETTE.rose);

  c.save();
  c.globalAlpha = 0.95 - layer * 0.25;
  c.lineWidth = 4.6 - layer * 1.3;
  c.strokeStyle = gradient;
  c.shadowColor = PALETTE.gold;
  c.shadowBlur = 22;
  c.stroke();
  c.restore();
}

// A bright arc that chases itself around the orb while connecting.
function drawComet(c: CanvasRenderingContext2D, x: number, y: number, r: number, spin: number, amount: number) {
  if (amount < 0.02) return;
  const length = 1.4;
  const segments = 24;
  for (let i = 0; i < segments; i++) {
    const from = spin * 2.2 - (i / segments) * length;
    const to = spin * 2.2 - ((i + 1) / segments) * length;
    c.strokeStyle = `rgba(226, 140, 56, ${(1 - i / segments) * amount})`;
    c.lineWidth = 6 * (1 - i / segments) + 1;
    c.lineCap = "round";
    c.beginPath();
    c.arc(x, y, r, to, from);
    c.stroke();
  }
  c.strokeStyle = `rgba(226, 150, 70, ${0.4 * amount})`;
  c.lineWidth = 1;
  c.setLineDash([2, 8]);
  c.beginPath();
  c.arc(x, y, r, 0, TAU);
  c.stroke();
  c.setLineDash([]);
}

// Sparks circling the orb while it thinks.
function drawSwirl(c: CanvasRenderingContext2D, x: number, y: number, r: number, t: number, spin: number, amount: number) {
  if (amount < 0.02) return;
  for (let i = 0; i < SWIRL_DOTS; i++) {
    const angle = spin * 1.6 + (i / SWIRL_DOTS) * TAU;
    const distance = r * (1 + 0.07 * Math.sin(t * 3 + i));
    const size = (1.6 + 1.8 * ((i % 3) / 2)) * amount;
    c.fillStyle = `rgba(230, 150, 60, ${(0.55 + 0.45 * Math.sin(t * 4 + i)) * amount})`;
    c.shadowColor = PALETTE.gold;
    c.shadowBlur = 10;
    c.beginPath();
    c.arc(x + Math.cos(angle) * distance, y + Math.sin(angle) * distance, size, 0, TAU);
    c.fill();
  }
  c.shadowBlur = 0;
}
