import { useRef, useState } from "react";
import { AnimatePresence, motion, useMotionValueEvent, useScroll, useSpring } from "motion/react";
import { Link } from "./router";
import { AsciiField } from "./Ascii";
import { AsciiScene } from "./AsciiScene";
import { CountUp, EASE, Item, Stagger, Words, hoverCard } from "./motion";

const findings = [
  { value: <><CountUp to={62.6} decimals={1} suffix="%" /> → <CountUp to={5} suffix="%" /></>, label: "One model update cut a product's share of AI picks from 62.6% to 5%.", source: "ACES study" },
  { value: <>+<CountUp to={14.9} decimals={1} suffix=" pts" /></>, label: "Editing the product description alone won up to 14.9 points of share.", source: "ACES study" },
  { value: <><CountUp to={60} />–<CountUp to={100} suffix="%" /></>, label: "Shopping agents took the first offer they saw in most runs.", source: "Microsoft Magentic Marketplace" },
];

const steps = [
  { img: "/iso/store.webp", title: "Publish your store", body: "Your products go live on a store that speaks PayPal's Store Sync cart API, so any agent can build a cart and pay." },
  { img: "/iso/agents.webp", title: "Send a fleet of shoppers", body: "Agents on Claude, GPT, Nova and Mistral open real browsers and shop your listing next to live competitors from Channel3." },
  { img: "/iso/checkout.webp", title: "Watch them check out", body: "Every agent tries to pay with PayPal sandbox. You watch each browser live and replay the exact step where checkout broke." },
  { img: "/iso/results.webp", title: "Fix what loses the sale", body: "See your share of picks by model, the funnel, and which rewrite of your title and description wins agents back." },
];

const loop = (duration: number, delay = 0) => ({ duration, delay, repeat: Infinity, ease: "easeInOut" as const });
const BARS: [string, number][] = [["Claude", 0.82], ["GPT", 0.58], ["Nova", 0.34], ["Mistral", 0.66]];

function SceneFx({ i }: { i: number }) {
  if (i === 0)
    return <motion.img className="fx" src="/sprites/sweater.webp" alt="" style={{ left: "58%", top: "6%", width: "20%" }} animate={{ y: [-34, 0, 0, -34], opacity: [0, 1, 1, 0], rotate: [-10, 0, 0, 8] }} transition={{ ...loop(3.4), times: [0, 0.3, 0.75, 1] }} />;
  if (i === 1)
    return <motion.img className="fx" src="/sprites/walk-r.webp" alt="" style={{ left: "0%", bottom: "4%", width: "17%" }} animate={{ x: ["0%", "170%"], opacity: [0, 1, 1, 0] }} transition={{ x: loop(5.5), opacity: { ...loop(5.5), times: [0, 0.12, 0.85, 1] } }} />;
  if (i === 2)
    return (
      <>
        <motion.img className="fx" src="/sprites/card.webp" alt="" style={{ left: "2%", top: "18%", width: "20%" }} animate={{ x: ["-30%", "45%", "45%"], rotate: [-14, 0, 0], opacity: [0, 1, 0] }} transition={{ ...loop(3.2), times: [0, 0.4, 1] }} />
        <motion.img className="fx" src="/sprites/check.webp" alt="" style={{ right: "6%", top: "4%", width: "16%" }} animate={{ scale: [0, 0, 1.18, 1, 1, 0], opacity: [0, 0, 1, 1, 1, 0] }} transition={{ ...loop(3.2), times: [0, 0.4, 0.5, 0.6, 0.9, 1] }} />
      </>
    );
  return (
    <div className="fx fx-bars" style={{ left: "2%", bottom: "4%" }}>
      {BARS.map(([m, v], k) => (
        <div key={m} className="fx-bar">
          <motion.span className={k === 0 ? "red" : ""} style={{ originY: 1 }} animate={{ scaleY: [0.15, v, v, 0.15] }} transition={{ ...loop(3.6, k * 0.15), times: [0, 0.35, 0.85, 1] }} />
          <em>{m}</em>
        </div>
      ))}
    </div>
  );
}

function HowItWorks() {
  const ref = useRef<HTMLDivElement>(null);
  const [active, setActive] = useState(0);
  const { scrollYProgress } = useScroll({ target: ref, offset: ["start 30%", "end 70%"] });
  const bar = useSpring(scrollYProgress, { stiffness: 120, damping: 24 });
  useMotionValueEvent(scrollYProgress, "change", (v) => setActive(Math.min(steps.length - 1, Math.max(0, Math.floor(v * steps.length)))));

  return (
    <div ref={ref} className="how">
      <div className="how-steps">
        {steps.map((s, i) => (
          <motion.div key={s.title} className={`how-step ${i === active ? "on" : ""}`} animate={{ opacity: i === active ? 1 : 0.32 }} transition={{ duration: 0.4, ease: EASE }}>
            <span className="step-n">{String(i + 1).padStart(2, "0")}</span>
            <h3>{s.title}</h3>
            <p>{s.body}</p>
            <div className="how-mobile-img how-scene-m"><img src={s.img} alt="" /><SceneFx i={i} /></div>
          </motion.div>
        ))}
      </div>
      <div className="how-stage">
        <div className="how-sticky">
          <div className="how-track"><motion.div className="how-bar" style={{ scaleY: bar }} /></div>
          <AnimatePresence mode="popLayout">
            <motion.div
              key={active}
              className="how-scene"
              initial={{ opacity: 0, y: 60, rotateX: 28, rotateZ: -6, scale: 0.86, filter: "blur(8px)" }}
              animate={{ opacity: 1, y: 0, rotateX: 0, rotateZ: 0, scale: 1, filter: "blur(0px)" }}
              exit={{ opacity: 0, y: -50, rotateX: -18, scale: 0.92, filter: "blur(6px)" }}
              transition={{ duration: 0.75, ease: EASE }}
            >
              <img src={steps[active].img} alt={steps[active].title} />
              <SceneFx i={active} />
            </motion.div>
          </AnimatePresence>
          <motion.div className="how-shadow" animate={{ scaleX: [1, 0.86, 1], opacity: [0.5, 0.3, 0.5] }} transition={{ duration: 4, repeat: Infinity, ease: "easeInOut" }} />
        </div>
      </div>
    </div>
  );
}

const LOGOS: [string, string][] = [["PayPal", "paypal.png"], ["Channel3", "channel3.png"], ["KERNEL", "kernel.svg"], ["Render", "render.svg"], ["Elastic", "elastic.svg"], ["AG Grid", "aggrid.svg"], ["Astropods", "astropods.svg"]];

function Logos() {
  return (
    <Stagger className="logos">
      {LOGOS.map(([name, file]) => (
        <Item key={file} className="logo">
          <img src={`/logos/${file}`} alt={name} loading="lazy" />
          {file === "channel3.png" && <span>Channel3</span>}
        </Item>
      ))}
    </Stagger>
  );
}

export function Landing() {
  return (
    <div className="frame landing">
      <header className="top">
        <div className="top-in">
          <Link to="/" className="brand">
            <span className="brand-mark">
              <svg width="12" height="12" viewBox="0 0 32 32" aria-hidden>
                <path d="M6 22h20M6 15h20M10 8h12" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" />
              </svg>
            </span>
            AgentShelf
          </Link>
          <nav className="nav">
            <a href="#problem">Problem</a>
            <a href="#how">How it works</a>
          </nav>
          <Link to="/app" className="btn top-cta">Start now <span className="arrow">→</span></Link>
        </div>
      </header>

      <section className="hero land-hero">
        <AsciiField />
        <Words className="display" text="AI shoppers are choosing for your customers" />
        <Stagger inView={false} delay={0.45} className="hero-sub">
          <Item><p className="lede">Find out which models pick your product, where their checkout fails, and which listing changes bring them back.</p></Item>
          <Item><motion.div {...hoverCard} style={{ display: "inline-block" }}><Link to="/app" className="btn land-cta">Start now <span className="arrow">→</span></Link></motion.div></Item>
        </Stagger>
        <motion.div className="scene-wrap" initial={{ opacity: 0, y: 30 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.6, ease: EASE }}>
          <AsciiScene src="/iso/hero.webp" />
        </motion.div>
      </section>
      <Logos />

      <section id="problem" className="land-section">
        <Stagger><Item><h2 className="section center">A model update can erase your sales overnight</h2></Item></Stagger>
        <Stagger className="grid3 findings" gap={0.12}>
          {findings.map((f) => (
            <Item key={f.source + f.label}>
              <motion.div className="card finding" {...hoverCard}>
                <div className="finding-value">{f.value}</div>
                <p>{f.label}</p>
                <span className="meta">{f.source}</span>
              </motion.div>
            </Item>
          ))}
        </Stagger>
      </section>

      <section id="how" className="land-section">
        <Stagger><Item><h2 className="section center">How it works</h2></Item></Stagger>
        <HowItWorks />
      </section>

      <section className="land-section land-end">
        <Stagger className="end-in">
          <Item><h2 className="section center">Run your first shelf test</h2></Item>
          <Item><motion.div {...hoverCard} style={{ display: "inline-block" }}><Link to="/app" className="btn land-cta">Start now <span className="arrow">→</span></Link></motion.div></Item>
        </Stagger>
      </section>
    </div>
  );
}
