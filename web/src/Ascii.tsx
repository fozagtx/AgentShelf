import { useEffect, useRef, useState } from "react";

const RAMP = " .:-=+*#%@";

const FIELD_RAMP = " .:-=+*#%@";

export function AsciiField({ className }: { className?: string }) {
  const ref = useRef<HTMLPreElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const reduce = matchMedia("(prefers-reduced-motion: reduce)").matches;
    let raf = 0;
    let t = 0;
    const draw = () => {
      const cols = Math.ceil(el.clientWidth / 7.2);
      const rows = Math.ceil(el.clientHeight / 13);
      let out = "";
      for (let y = 0; y < rows; y++) {
        for (let x = 0; x < cols; x++) {
          const v = Math.sin(x * 0.11 + t) + Math.sin(y * 0.17 - t * 0.7) + Math.sin((x + y) * 0.06 + t * 0.4);
          out += FIELD_RAMP[Math.max(0, Math.min(FIELD_RAMP.length - 1, Math.floor(((v + 3) / 6) * FIELD_RAMP.length)))];
        }
        out += "\n";
      }
      el.textContent = out;
      t += 0.02;
      if (!reduce) raf = requestAnimationFrame(() => setTimeout(draw, 60));
    };
    draw();
    return () => cancelAnimationFrame(raf);
  }, []);
  return <pre ref={ref} aria-hidden className={`ascii-field ${className ?? ""}`} />;
}

export function AsciiImage({ src, alt }: { src: string; alt?: string }) {
  const [art, setArt] = useState("");
  const [ok, setOk] = useState(true);
  useEffect(() => {
    let alive = true;
    const img = new Image();
    img.onload = () => {
      const cols = 64;
      const rows = Math.round((cols * img.height) / img.width / 2);
      const c = document.createElement("canvas");
      c.width = cols;
      c.height = rows;
      const ctx = c.getContext("2d");
      if (!ctx) return;
      ctx.drawImage(img, 0, 0, cols, rows);
      try {
        const d = ctx.getImageData(0, 0, cols, rows).data;
        let out = "";
        for (let y = 0; y < rows; y++) {
          for (let x = 0; x < cols; x++) {
            const i = (y * cols + x) * 4;
            const lum = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
            out += RAMP[Math.floor((1 - lum) * (RAMP.length - 1))];
          }
          out += "\n";
        }
        if (alive) setArt(out);
      } catch { /* cross-origin pixels: show the photo only */ }
    };
    img.onerror = () => alive && setOk(false);
    img.src = src;
    return () => { alive = false; };
  }, [src]);
  return (
    <div className="ascii-img">
      {art && <pre aria-hidden>{art}</pre>}
      {ok ? <img src={src} alt={alt ?? ""} /> : !art && <span className="meta">No image</span>}
    </div>
  );
}
