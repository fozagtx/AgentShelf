import { useEffect, useState, type ReactNode } from "react";
import { motion } from "motion/react";
import { api, type Experiment, type PayPalMcpTools, type Product } from "./api";
import { Link, navigate } from "./router";
import { EASE } from "./motion";
import { useCrumb } from "./Shell";

const FLEET = ["claude-sonnet-4-6", "gpt-5-6-terra", "nova-pro", "mistral-large-3"];

function Waiting() {
  return <span className="mark waiting" aria-hidden />;
}

function Check() {
  return <svg className="mark done" width="14" height="14" viewBox="0 0 16 16" aria-hidden><path d="M3 8.5 6.5 12 13 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>;
}

function Link2({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div className={`wire h ${ok ? "done" : "waiting"} dash-wire`} aria-hidden>
      <motion.i className="wire-line" initial={{ scaleX: 0 }} animate={{ scaleX: 1 }} transition={{ duration: 0.6, ease: EASE, delay: 0.3 }} />
      <span className="wire-plus">+</span>
      <span className={`pill ${ok ? "done" : "waiting"}`}>{label}</span>
    </div>
  );
}

function DashNode({ icon, title, sub, chips, children, index }: { icon: ReactNode; title: string; sub: string; chips?: ReactNode; children: ReactNode; index: number }) {
  return (
    <motion.div className="node dash-node" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.55, ease: EASE, delay: index * 0.12 }}>
      <div className="node-head">
        <span className="node-ico">{icon}</span>
        <div className="node-titles"><div className="node-title">{title}</div><div className="node-sub">{sub}</div></div>
        <span className="node-kebab" aria-hidden><svg width="16" height="16" viewBox="0 0 16 16"><circle cx="8" cy="3.5" r="1.3" /><circle cx="8" cy="8" r="1.3" /><circle cx="8" cy="12.5" r="1.3" /></svg></span>
      </div>
      {chips && <div className="node-chips">{chips}</div>}
      <div className="node-body">{children}</div>
    </motion.div>
  );
}

const ico = (d: string) => <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round"><path d={d} /></svg>;

export function Experiments() {
  const [experiments, setExperiments] = useState<Experiment[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [tools, setTools] = useState<PayPalMcpTools | null>(null);
  const [productId, setProductId] = useState("");
  const [query, setQuery] = useState("");
  const [reps, setReps] = useState(3);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.experiments().then(setExperiments).catch((e) => { setExperiments([]); setError(e.message); });
    api.products().then((p) => { setProducts(p); if (p[0]) setProductId(p[0].id); }).catch(() => {});
    api.paypalMcpTools().then(setTools).catch(() => {});
  }, []);

  async function start(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError("");
    try {
      const { id } = await api.createExperiment({ productId, query, reps });
      navigate(`/app/experiments/${id}`);
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  }

  const product = products.find((p) => p.id === productId);
  const runsPerModel = reps * (product?.fixed_variant ? 2 : 1);
  useCrumb({ title: "New shelf test", status: "draft" });
  const productTitle = (id: string) => products.find((p) => p.id === id)?.title ?? id;
  const steps: [string, boolean][] = [["Setup", Boolean(productId)], ["Configure", Boolean(query.trim())], ["Run", busy]];

  return (
    <div className="enter dash">
      <div className="canvas dash-canvas">
        <div className="dash-head">
          <h1>New shelf test</h1>
          <p>Every model shops your listing next to real Channel3 competitors, then tries to pay with PayPal.</p>
        </div>

        <div className="dash-flow">
          <DashNode index={0} icon={ico("M7 5v14l11-7z")} title="Start" sub="Your listing on the shelf"
            chips={<><span className="chip"><img src="/logos/channel3.png" alt="" />Channel3</span><span className="chip">{reps} reps</span></>}>
            <div className="node-panel">
              <div className="node-panel-title">{product?.title ?? "Pick a product"}</div>
              <div className="node-panel-sub">{query || "Shopper intent not set"}</div>
              <ul className="node-rows">
                <li><span className="node-row-label">Original listing</span><span className="node-row-value">{product ? `$${product.price.toFixed(2)}` : "—"}</span>{product ? <Check /> : <Waiting />}</li>
                <li><span className="node-row-label">AI-fixed listing</span><span className="node-row-value">{product?.fixed_variant ? "Included" : "Not generated"}</span>{product?.fixed_variant ? <Check /> : <Waiting />}</li>
              </ul>
            </div>
          </DashNode>
          <Link2 ok={Boolean(productId)} label={productId ? "Ready" : "Waiting"} />
          <DashNode index={1} icon={ico("M16 19v-1a4 4 0 0 0-8 0v1M12 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6M20 19v-1a3 3 0 0 0-2-2.8M4 19v-1a3 3 0 0 1 2-2.8")} title="Shopper fleet" sub="Live KERNEL browsers"
            chips={<span className="chip"><img src="/logos/kernel.svg" alt="" />{FLEET.length} models</span>}>
            <div className="node-panel">
              <div className="node-panel-title">Models</div>
              <ul className="node-rows">{FLEET.map((m) => <li key={m}><span className="node-row-label">{m}</span><span className="node-row-value">{runsPerModel} runs</span><Waiting /></li>)}</ul>
            </div>
          </DashNode>
          <Link2 ok={Boolean(query.trim())} label={query.trim() ? "Ready" : "Waiting"} />
          <DashNode index={2} icon={ico("M3 7h18v10H3zM3 11h18")} title="PayPal checkout" sub="Store Sync cart to sandbox order"
            chips={<><span className="chip"><img src="/logos/paypal.png" alt="" />Orders v2</span><span className="chip">MCP</span></>}>
            <div className={`node-info${tools?.connected ? "" : " muted"}`}>
              {tools?.connected ? `PayPal MCP connected · ${tools.tools.length} tools` : "PayPal sandbox not connected. Set PAYPAL_CLIENT_ID and PAYPAL_CLIENT_SECRET to capture orders."}
            </div>
          </DashNode>
        </div>

        <div className="dash-runs">
          <div className="dash-runs-head"><h2>Recent experiments</h2><span className="meta">{experiments?.length ?? 0} total</span></div>
          {experiments === null && <div className="node empty">Loading</div>}
          {experiments?.length === 0 && <div className="node empty">No experiments yet. Configure one on the right.</div>}
          <div className="dash-grid">
            {experiments?.map((x, i) => {
              const pct = x.run_counts?.total ? x.run_counts.done / x.run_counts.total : 0;
              const state = x.status === "complete" ? "done" : x.status === "failed" ? "failed" : "running";
              return (
                <motion.div key={x.id} initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.06, ease: EASE, duration: 0.5 }}>
                  <Link to={`/app/experiments/${x.id}`} className="node dash-exp">
                    <div className="dash-exp-top"><span className={`dash-status ${state}`}>{x.status}</span><span className="meta">{new Date(x.created_at).toLocaleDateString()}</span></div>
                    <div className="node-title">{x.query}</div>
                    <div className="node-sub">{productTitle(x.product_id)}</div>
                    <div className="dash-bar"><i style={{ width: `${pct * 100}%` }} /></div>
                    <div className="meta">{x.run_counts ? `${x.run_counts.done}/${x.run_counts.total} runs` : "Queued"} · {x.competitors.length} competitors</div>
                  </Link>
                </motion.div>
              );
            })}
          </div>
        </div>
      </div>

      <aside className="side dash-side" aria-label="Create a shelf test">
        <div className="side-head">
          <span className="node-ico">{ico("M12 5v14M5 12h14")}</span>
          <div className="side-title">Create a new shelf test</div>
          <span />
        </div>
        <ol className="side-steps">
          {steps.map(([label, ok], i) => (
            <li key={label}>{i > 0 && <span className="side-chev" aria-hidden>›</span>}{label}{ok ? <Check /> : <span className="mark waiting" />}</li>
          ))}
        </ol>
        <form className="side-body" onSubmit={start}>
          <div className="field">
            <label htmlFor="product">Your product*</label>
            <select id="product" value={productId} onChange={(e) => setProductId(e.target.value)} required>
              {products.length === 0 && <option value="">Publish a product in Store first</option>}
              {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
            </select>
          </div>
          <div className="field">
            <label htmlFor="query">Shopper intent*</label>
            <input id="query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="merino wool crew sweater under $150" required />
          </div>
          <div className="field">
            <label htmlFor="reps">Runs per model and variant</label>
            <input id="reps" type="number" min={1} max={10} value={reps} onChange={(e) => setReps(Number(e.target.value))} />
          </div>
          <div className="pfield">
            <div className="pfield-label">Checkout</div>
            <div className="pfield-box dash-pay"><img src="/logos/paypal.png" alt="" />PayPal sandbox <span className="chip">Orders v2</span></div>
          </div>
          {error && <div className="notice">{error}</div>}
          <button className="btn red dash-go" disabled={busy || !productId}>{busy ? "Starting fleet" : "Run the fleet"}</button>
        </form>

        <div className="dash-tools">
          <div className="dash-tools-head">
            <span className="pfield-label">Connected tools</span>
            <span className={`dash-status ${tools?.connected ? "done" : "waiting"}`}>{tools ? (tools.connected ? "Connected" : "Not connected") : "Checking"}</span>
          </div>
          <div className="pfield-box dash-tool-list">
            <div className="dash-tool-server"><img src="/logos/paypal.png" alt="" />paypal-sandbox<code>MCP</code></div>
            {(tools?.tools ?? []).map((t) => (
              <div key={t.name} className="dash-tool" title={t.description}><code>{t.name}</code>{tools?.connected ? <Check /> : <span className="mark waiting" />}</div>
            ))}
          </div>
          <p className="meta">From the <a href="https://github.com/paypal/AI-Toolkit" target="_blank" rel="noreferrer">PayPal AI Toolkit</a>.{!tools?.connected && " Add PayPal sandbox credentials to connect."}</p>
        </div>
      </aside>
    </div>
  );
}
