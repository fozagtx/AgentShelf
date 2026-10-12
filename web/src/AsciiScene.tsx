import { useEffect, useRef, useState } from "react";

const RAMP = " .'`^\",:;Il!i~+_-?][}{1)(|/tfjrxnuvczXYUJCLQ0OZmwqpdbkhao*#MW&8%B@";
const NOISE = "!<>-_\\/[]{}=+*^?#";
const COLS = 170;
const TOUCH_MS = 5000;
const TOUR: [number, number][] = [[0.23, 0.55], [0.42, 0.45], [0.55, 0.66], [0.79, 0.7], [0.5, 0.27]];

type Cell = { ch: string; red: boolean; obj: boolean };
const FIELD = " .:-=+*#%@";

export function AsciiScene({ src }: { src: string }) {
  const wrap = useRef<HTMLDivElement>(null);
  const pre = useRef<HTMLPreElement>(null);
  const [grid, setGrid] = useState<Cell[][] | null>(null);
  const [box, setBox] = useState({ h: 400, w: 0 });
  const ratio = useRef(1);
  const fitRef = useRef<() => void>(() => {});
  const [tap, setTap] = useState(0);
  const userUntil = useRef(0);

  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      ratio.current = img.height / img.width;
      const rows = Math.round(COLS * ratio.current * 0.5);
      const c = document.createElement("canvas");
      c.width = COLS;
      c.height = rows;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, COLS, rows);
      const d = ctx.getImageData(0, 0, COLS, rows).data;
      const L = new Float32Array(COLS * rows);
      const R = new Uint8Array(COLS * rows);
      for (let k = 0; k < COLS * rows; k++) {
        const [r, gr, b] = [d[k * 4], d[k * 4 + 1], d[k * 4 + 2]];
        L[k] = (0.299 * r + 0.587 * gr + 0.114 * b) / 255;
        R[k] = r > 150 && gr < 90 && b < 90 ? 1 : 0;
      }
      const at = (x: number, y: number) => L[Math.min(rows - 1, Math.max(0, y)) * COLS + Math.min(COLS - 1, Math.max(0, x))];
      const g: Cell[][] = [];
      for (let y = 0; y < rows; y++) {
        const row: Cell[] = [];
        for (let x = 0; x < COLS; x++) {
          const lum = at(x, y);
          const edge = Math.abs(at(x + 1, y) - at(x - 1, y)) + Math.abs(at(x, y + 1) - at(x, y - 1));
          const tone = lum > 0.975 ? 0 : Math.pow((0.975 - lum) / 0.975, 0.55);
          const ink = Math.min(1, Math.max(tone, edge * 2.2));
          const red = R[y * COLS + x] === 1;
          row.push({ ch: RAMP[Math.round(ink * (RAMP.length - 1))], red, obj: red || ink > 0.14 });
        }
        g.push(row);
      }
      setGrid(g);
    };
    img.src = src;
  }, [src]);

  useEffect(() => {
    const el = wrap.current;
    if (!el || !grid) return;
    const fit = () => {
      const w = el.clientWidth;
      const h = w * ratio.current;
      setBox((b) => (b.h === h && b.w === w ? b : { h, w }));
    };
    fitRef.current = fit;
    const t = setTimeout(fit, 50);
    document.fonts?.ready.then(fit);
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => { clearTimeout(t); ro.disconnect(); };
  }, [grid]);

  useEffect(() => {
    const el = pre.current;
    if (!el || !grid) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    const start = performance.now();
    const REVEAL = reduce ? 0 : 1600;
    let raf = 0;
    let last = 0;
    const render = (now: number) => {
      const t = now - start;
      let html = "";
      const w = t / 1000;
      for (let y = 0; y < grid.length; y++) {
        let run = "";
        let kind = 0;
        const flush = () => { if (run) html += kind === 0 ? `<i>${run}</i>` : kind === 2 ? `<b>${run}</b>` : run; run = ""; };
        for (let x = 0; x < grid[y].length; x++) {
          const cell = grid[y][x];
          let ch: string;
          let k: number;
          if (cell.obj) {
            k = cell.red ? 2 : 1;
            const front = ((x + y * 0.6) / (COLS + grid.length * 0.6)) * REVEAL * 1.1;
            ch = cell.ch;
            if (t < front) ch = t < front - 260 ? " " : NOISE[(Math.random() * NOISE.length) | 0];
            else if (Math.random() < 0.004) ch = NOISE[(Math.random() * NOISE.length) | 0];
          } else {
            k = 0;
            const v = Math.sin(x * 0.11 + w * 1.2) + Math.sin(y * 0.3 - w * 0.84) + Math.sin((x + y) * 0.06 + w * 0.48);
            ch = FIELD[Math.max(0, Math.min(FIELD.length - 1, Math.floor(((v + 3) / 6) * FIELD.length)))];
          }
          if (k !== kind) { flush(); kind = k; }
          run += ch === "<" ? "&lt;" : ch === ">" ? "&gt;" : ch === "&" ? "&amp;" : ch;
        }
        flush();
        html += "\n";
      }
      const first = !el.innerHTML;
      el.innerHTML = html;
      if (first) fitRef.current();
    };
    const loop = (now: number) => {
      const interval = now - start < REVEAL ? 33 : 70;
      if (now - last >= interval) { render(now); last = now; }
      if (!reduce) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    if (reduce) render(start + 1e9);
    return () => cancelAnimationFrame(raf);
  }, [grid]);

  useEffect(() => {
    const el = wrap.current;
    if (!el || !grid) return;
    const onScroll = () => {
      const r = el.getBoundingClientRect();
      const p = Math.min(1, Math.max(0, (innerHeight - r.top) / (innerHeight + r.height)));
      el.style.setProperty("--grow", String(1 + p * 0.8));
    };
    onScroll();
    addEventListener("scroll", onScroll, { passive: true });
    if (matchMedia("(prefers-reduced-motion: reduce)").matches) return () => removeEventListener("scroll", onScroll);
    const timers: number[] = [];
    let i = 0;
    let alive = true;
    const later = (fn: () => void, ms: number) => timers.push(window.setTimeout(fn, ms));
    const step = () => {
      if (!alive) return;
      if (performance.now() < userUntil.current) return later(step, 800);
      const [fx, fy] = TOUR[i++ % TOUR.length];
      el.style.setProperty("--move-t", "0.9s");
      el.style.setProperty("--mx", `${fx * el.clientWidth}px`);
      el.style.setProperty("--my", `${fy * el.clientHeight}px`);
      later(() => {
        if (performance.now() < userUntil.current) return step();
        touchRef.current(fx * el.clientWidth, fy * el.clientHeight);
        later(step, TOUCH_MS + 900);
      }, 950);
    };
    later(step, 2000);
    return () => { alive = false; timers.forEach(clearTimeout); removeEventListener("scroll", onScroll); };
  }, [grid]);

  const closeTimer = useRef(0);
  const touch = (x: number, y: number) => {
    const el = wrap.current;
    if (!el) return;
    clearTimeout(closeTimer.current);
    el.style.setProperty("--mx", `${x}px`);
    el.style.setProperty("--my", `${y}px`);
    setTap((t) => t + 1);
    const full = Math.hypot(Math.max(x, el.clientWidth - x), Math.max(y, el.clientHeight - y)) / 0.7;
    el.style.setProperty("--lens-t", "1.8s");
    el.style.setProperty("--lens", `${full}px`);
    closeTimer.current = window.setTimeout(() => {
      el.style.setProperty("--lens-t", "1.6s");
      el.style.setProperty("--lens", "0px");
    }, 3400);
  };
  const touchRef = useRef(touch);
  touchRef.current = touch;
  const down = (e: React.PointerEvent) => {
    userUntil.current = performance.now() + TOUCH_MS + 1500;
    wrap.current!.style.setProperty("--move-t", "0s");
    const r = wrap.current!.getBoundingClientRect();
    touch(e.clientX - r.left, e.clientY - r.top);
  };

  return (
    <div ref={wrap} className="ascii-scene" style={{ height: box.h }} onPointerDown={down}>
      <img src={src} alt="AI shopper agents browsing a store shelf" />
      <pre ref={pre} aria-hidden style={grid && box.w ? { transform: `scale(${box.w / (COLS * 6)}, ${box.h / (grid.length * 12)})` } : undefined} />
      {tap > 0 && <span key={tap} className="tap" aria-hidden />}
    </div>
  );
}
