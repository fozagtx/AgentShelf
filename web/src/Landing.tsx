import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { Link } from "./router";
import { FlowCanvas } from "./FlowCanvas";
import { api, type Analytics, type Experiment, type PayPalMcpTools, type RunRow } from "./api";
import { CountUp, EASE, Item, Stagger, hoverCard } from "./motion";
import "./hero.css";

const loop = (duration: number, delay = 0) => ({ duration, delay, repeat: Infinity, ease: "easeInOut" as const });

export function Badge({ children, light }: { children: ReactNode; light?: boolean }) {
  return <span className={`x-badge${light ? " light" : ""}`}><i />{children}</span>;
}

export function Sky({ className = "" }: { className?: string }) {
  return (
    <div className={`x-sky ${className}`} aria-hidden>
      <svg width="100%" height="100%" preserveAspectRatio="none">
        <filter id="x-clouds" x="0" y="0" width="100%" height="100%">
          <feTurbulence type="fractalNoise" baseFrequency="0.0035 0.009" numOctaves="5" seed="7" />
          <feColorMatrix values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  2.4 0 0 0 -1.05" />
        </filter>
        <rect width="100%" height="100%" filter="url(#x-clouds)" />
      </svg>
    </div>
  );
}

function Nav() {
  return (
    <header className="x-nav">
      <Link to="/" className="x-brand"><span className="x-mark"><i /></span>AgentShelf</Link>
      <nav>
        <a href="#how">How it works</a>
        <a href="#findings">Research</a>
        <a href="#paypal">PayPal</a>
        <a href="#integrations">Integrations</a>
      </nav>
      <div className="x-nav-cta">
        <Link to="/app/store" className="x-btn white">Your store</Link>
        <Link to="/app" className="x-btn">Open app</Link>
      </div>
    </header>
  );
}

type Latest = { exp: Experiment; stats: Analytics; runs: RunRow[] };

function useLatestExperiment() {
  const [data, setData] = useState<Latest | null | undefined>(undefined);
  useEffect(() => {
    let live = true;
    api.experiments()
      .then(async (list) => {
        const sorted = [...list].sort((a, b) => String(b.created_at).localeCompare(String(a.created_at)));
        const pick = sorted.find((x) => x.status === "complete") ?? sorted[0];
        if (!pick) return null;
        const [exp, stats, runs] = await Promise.all([api.experiment(pick.id), api.analytics(pick.id), api.runs(pick.id)]);
        return { exp, stats, runs };
      })
      .then((d) => { if (live) setData(d); })
      .catch(() => { if (live) setData(null); });
    return () => { live = false; };
  }, []);
  return data;
}

const GHOST: [string, string][] = [["n1", "Your listing"], ["n2", "Competitor shelf"], ["n3", "Shopper fleet"], ["n4", "PayPal checkout"], ["n5", "Results"]];

function Window() {
  const data = useLatestExperiment();
  const exp = data?.exp;
  return (
    <div className="x-window">
      <div className="x-window-rail">
        <span className="x-mark"><i /></span>
        <Link to="/app" className="on" aria-label="Experiments"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M5 5h6v6H5zM13 5h6v6h-6zM5 13h6v6H5zM13 13h6v6h-6z" /></svg></Link>
        <Link to="/app/store" aria-label="Store"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6"><path d="M5 8h14l-1.2 11.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8L5 8Zm4 0V7a3 3 0 0 1 6 0v1" /></svg></Link>
      </div>
      <div className="x-window-main">
        <div className="x-window-bar">
          <span className="x-crumb">
            Experiments
            {exp && <><b>/</b><span className="x-crumb-title">{exp.query}</span><span className={`x-live ${exp.status === "complete" ? "ok" : exp.status === "failed" ? "bad" : ""}`}>{exp.status}</span></>}
          </span>
          <span className="x-window-tools">
            {exp && <Link to={`/app/experiments/${exp.id}`} className="x-btn sm white">Open</Link>}
            <Link to="/app" className="x-btn sm">Run test</Link>
          </span>
        </div>
        {data ? (
          <FlowCanvas exp={data.exp} stats={data.stats} runs={data.runs} initial="checkout" />
        ) : (
          <div className="x-ghost">
            {GHOST.map(([area, title]) => (
              <div key={title} className="x-ghost-node" style={{ gridArea: area }}><b>{title}</b><i /><i /></div>
            ))}
            {(["w1 h", "w2 h", "w3 v", "w4 h"] as const).map((w) => <span key={w} className={`x-ghost-wire ${w.split(" ")[1]}`} style={{ gridArea: w.split(" ")[0] }} />)}
            <div className="x-ghost-cta">
              {data === undefined ? <span className="meta">Loading latest experiment</span> : (
                <>
                  <b>No experiments yet</b>
                  <span className="meta">Run a shelf test and its live workflow shows up here.</span>
                  <Link to="/app" className="x-btn sm">Run your first test</Link>
                </>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function MiniFlow() {
  return (
    <div className="mini-flow">
      {[["Trigger", "Agent opens /shelf"], ["Store Sync", "Cart created"], ["PayPal", "Order approved"]].map(([t, s], i) => (
        <motion.div key={t} className="mini-node" initial={{ opacity: 0, y: 8 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.15, ease: EASE, duration: 0.6 }}>
          <b>{t}</b><span>{s}</span><em className="x-pill ok">Success</em>
        </motion.div>
      ))}
    </div>
  );
}

function Orbit() {
  const models = ["OpenAI", "Nebius", "OpenAI", "Nebius", "OpenAI", "Nebius"];
  return (
    <div className="orbit">
      <svg viewBox="0 0 300 180">{models.map((_, i) => {
        const a = (i / models.length) * Math.PI * 2;
        return <line key={i} x1="150" y1="90" x2={150 + Math.cos(a) * 110} y2={90 + Math.sin(a) * 62} />;
      })}</svg>
      <span className="orbit-core"><span className="x-mark"><i /></span></span>
      {models.map((m, i) => {
        const a = (i / models.length) * Math.PI * 2;
        return (
          <motion.span key={i} className="orbit-dot" style={{ left: `${50 + Math.cos(a) * 36.6}%`, top: `${50 + Math.sin(a) * 34.4}%` }} animate={{ y: [0, -4, 0] }} transition={loop(3, i * 0.3)}>
            {m[0]}
          </motion.span>
        );
      })}
    </div>
  );
}

function Branch() {
  return (
    <div className="branch">
      <div className="branch-head"><span>If</span> PayPal order <code>status</code> is</div>
      <div className="branch-row"><code>COMPLETED</code><em className="x-pill ok">True</em></div>
      <div className="branch-row"><code>PAYER_ACTION_REQUIRED</code><em className="x-pill run">Retry</em></div>
      <div className="branch-row"><code>INSTRUMENT_DECLINED</code><em className="x-pill bad">False</em></div>
    </div>
  );
}

function Curve() {
  return (
    <div className="curve">
      <svg viewBox="0 0 320 130" preserveAspectRatio="none">
        <defs><linearGradient id="x-fill" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#111" stopOpacity="0.12" /><stop offset="1" stopColor="#111" stopOpacity="0" /></linearGradient></defs>
        <path d="M0 112 C40 108 60 96 92 92 S150 70 180 58 S250 30 320 18 L320 130 L0 130Z" fill="url(#x-fill)" />
        <motion.path d="M0 112 C40 108 60 96 92 92 S150 70 180 58 S250 30 320 18" fill="none" stroke="#111" strokeWidth="2" initial={{ pathLength: 0 }} whileInView={{ pathLength: 1 }} viewport={{ once: true }} transition={{ duration: 1.6, ease: EASE }} />
        <path d="M0 116 C60 114 120 108 180 104 S260 98 320 96" fill="none" stroke="#bbb" strokeWidth="1.5" strokeDasharray="4 4" />
      </svg>
      <span className="curve-tip"><b>67%</b> picks after fix</span>
    </div>
  );
}

const how: { tag: string; title: string; body: string; art: ReactNode; wide?: boolean }[] = [
  { tag: "01 · Publish", title: "Your store, served to agents", body: "Products go live on PayPal Store Sync cart endpoints and a product feed any shopping agent can read.", art: <MiniFlow />, wide: true },
  { tag: "02 · Fleet", title: "A fleet of real shoppers", body: "The OpenAI and Nebius models you pick open live KERNEL browsers and shop your listing next to Channel3 competitors.", art: <Orbit /> },
  { tag: "03 · Checkout", title: "Every run pays with PayPal", body: "Agents approve and capture sandbox orders. Verify any experiment's orders against the PayPal MCP server.", art: <Branch /> },
  { tag: "04 · Results", title: "Fix what loses the sale", body: "Share of picks by model, the checkout funnel, and the listing rewrite that wins agents back.", art: <Curve />, wide: true },
];

const findings: { value: ReactNode; label: string; source: string }[] = [
  { value: <><CountUp from={62.6} to={5} suffix="%" /></>, label: "One model update cut a product's share of AI picks from 62.6% to 5%.", source: "ACES study" },
  { value: <>+<CountUp to={14.9} decimals={1} /><small>pts</small></>, label: "Editing the product description alone won up to 14.9 points of share.", source: "ACES study" },
  { value: <><CountUp to={60} />–<CountUp to={100} suffix="%" /></>, label: "Shopping agents took the first offer they saw in most runs.", source: "Microsoft Magentic Marketplace" },
];

const logos: [string, string][] = [
  ["/logos/paypal.png", "PayPal"], ["/logos/channel3.png", "Channel3"], ["/logos/kernel.svg", "KERNEL"], ["/logos/render.svg", "Render"],
  ["/logos/aggrid.svg", "AG Grid"], ["", "OpenAI"], ["", "Nebius"],
];

export function Landing() {
  const [tools, setTools] = useState<PayPalMcpTools | null>(null);
  useEffect(() => { api.paypalMcpTools().then(setTools).catch(() => {}); }, []);
  return (
    <div className="x">
      <section className="x-hero">
        <Sky />
        <Nav />
        <div className="x-hero-copy">
          <motion.h1 initial={{ opacity: 0, y: 18 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, ease: EASE }}>
            See how AI shoppers<br />pick your product
          </motion.h1>
          <div className="x-hero-side">
            <motion.p initial={{ opacity: 0 }} animate={{ opacity: 1 }} transition={{ delay: 0.3, duration: 0.8 }}>
              AgentShelf sends a fleet of AI shopping agents to your listing, puts it next to real competitors, and watches every one try to check out with PayPal.
            </motion.p>
            <div className="x-hero-cta">
              <a href="#how" className="x-btn white">Explore how it works</a>
              <Link to="/app" className="x-btn">Get started</Link>
              <span className="x-hero-chip"><span className="x-mark"><i /></span>OpenAI + Nebius models</span>
            </div>
          </div>
        </div>
        <motion.div className="x-hero-window" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.25, duration: 1, ease: EASE }}>
          <Window />
          <span className="x-cursor" aria-hidden><svg viewBox="0 0 24 24"><path d="M5 3l6.5 17 2.6-7.1L21 10.4z" /></svg></span>
        </motion.div>
      </section>

      <section className="x-sec" id="findings">
        <div className="x-sec-head split">
          <div><Badge>The problem</Badge><h2>Agents already choose<br />for your customers</h2></div>
          <p>Shopping agents compare offers in seconds and pick one. Small changes in a model or a listing swing who wins, and you can't see it from analytics.</p>
        </div>
        <Stagger className="x-stats">
          {findings.map((f) => (
            <Item key={f.label} className="x-card x-stat" {...hoverCard}>
              <div className="x-stat-num">{f.value}</div>
              <p>{f.label}</p>
              <span className="x-src">{f.source}</span>
            </Item>
          ))}
        </Stagger>
      </section>

      <section className="x-sec" id="how">
        <div className="x-sec-head center">
          <Badge>How it works</Badge>
          <h2>One canvas from listing<br />to captured order</h2>
          <p>Build a test, launch the fleet, and follow each shopper through the workflow in real time.</p>
        </div>
        <Stagger className="x-bento">
          {how.map((h) => (
            <Item key={h.tag} className={`x-card x-bento-card${h.wide ? " wide" : ""}`} {...hoverCard}>
              <div className="x-art">{h.art}</div>
              <span className="x-tag">{h.tag}</span>
              <h3>{h.title}</h3>
              <p>{h.body}</p>
            </Item>
          ))}
        </Stagger>
      </section>

      <section className="x-sec" id="paypal">
        <div className="x-paypal x-card">
          <div>
            <Badge>PayPal AI Toolkit</Badge>
            <h2>Checkout verified by PayPal's own agent tools</h2>
            <p>Orders run on PayPal Orders v2 with idempotent request IDs, <code>Retry-After</code> backoff and <code>debug_id</code> logging, following the PayPal AI Toolkit best practices. Captured orders can be re-read through the PayPal sandbox MCP server.</p>
            <Link to="/app" className="x-btn">Open the canvas</Link>
          </div>
          <div className="x-tools">
            <div className="x-tools-head"><img src="/logos/paypal.png" alt="" />paypal-sandbox <span>MCP</span><em className={`x-pill ${tools?.connected ? "ok" : "idle"}`}>{tools ? (tools.connected ? "Connected" : "Not connected") : "Checking"}</em></div>
            {(tools?.tools ?? []).map(({ name: t, description }, i) => (
              <motion.div key={t} className="x-tool" initial={{ opacity: 0, x: 12 }} whileInView={{ opacity: 1, x: 0 }} viewport={{ once: true }} transition={{ delay: i * 0.07, ease: EASE, duration: 0.5 }}>
                <code title={description}>{t}</code>
              </motion.div>
            ))}
          </div>
        </div>
      </section>

      <section className="x-sec" id="integrations">
        <div className="x-integrations">
          <div>
            <Badge>Integrations</Badge>
            <h2>Built on the stack agents already use</h2>
            <p>Real browsers, real competitors, real PayPal sandbox orders. No mocks between your listing and the agent.</p>
          </div>
          <div className="x-logos">
            {logos.map(([src, name]) => <div key={name} className="x-logo">{src && <img src={src} alt="" />}<span>{name}</span></div>)}
            <div className="x-logo hatch" />
          </div>
        </div>
      </section>

      <section className="x-sec">
        <div className="x-cta">
          <Sky className="dim" />
          <Badge light>Start now</Badge>
          <h2>Find out which agents<br />buy from you today</h2>
          <p>Pick a product, describe the shopper, and launch the fleet. Results land in minutes.</p>
          <div className="x-hero-cta"><Link to="/app" className="x-btn white">Run a shelf test</Link><Link to="/app/store" className="x-btn">Set up your store</Link></div>
        </div>
      </section>

      <footer className="x-foot">
        <div className="x-foot-brand">
          <Link to="/" className="x-brand dark"><span className="x-mark"><i /></span>AgentShelf</Link>
          <p>Shelf tests for agentic commerce, with PayPal checkout built in.</p>
        </div>
        {[["Product", [["Canvas", "/app"], ["Store", "/app/store"], ["Product feed", "/feed.csv"]]], ["Platform", [["PayPal AI Toolkit", "https://github.com/paypal/AI-Toolkit"], ["Channel3", "https://trychannel3.com"], ["KERNEL", "https://onkernel.com"]]], ["Developers", [["JWKS", "/.well-known/jwks.json"], ["Status", "/api/status"], ["GitHub", "https://github.com/fozagtx/AgentShelf"]]]].map(([h, links]) => (
          <div key={h as string} className="x-foot-col">
            <span className="x-tag">{h as string}</span>
            {(links as [string, string][]).map(([l, href]) => <a key={l} href={href}>{l}</a>)}
          </div>
        ))}
        <form className="x-foot-news" onSubmit={(e) => e.preventDefault()}>
          <b>Stay in the loop</b>
          <span>Agentic commerce research and product updates.</span>
          <div><input type="email" placeholder="Enter your work email" aria-label="Work email" /><button className="x-btn" aria-label="Subscribe">→</button></div>
        </form>
        <div className="x-foot-base"><span>© 2026 AgentShelf</span><span>PayPal sandbox · Not for live payments</span></div>
      </footer>
    </div>
  );
}
