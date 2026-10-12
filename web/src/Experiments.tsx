import { useEffect, useState } from "react";
import { api, type Experiment, type Product } from "./api";
import { Link, navigate } from "./router";
import { Item, Stagger, hoverCard } from "./motion";

export function Experiments() {
  const [experiments, setExperiments] = useState<Experiment[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [productId, setProductId] = useState("");
  const [query, setQuery] = useState("");
  const [reps, setReps] = useState(3);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.experiments().then(setExperiments).catch((e) => { setExperiments([]); setError(e.message); });
    api.products().then((p) => { setProducts(p); if (p[0]) setProductId(p[0].id); }).catch(() => {});
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

  const productTitle = (id: string) => products.find((p) => p.id === id)?.title ?? id;

  return (
    <div className="enter">
      <section className="hero">
        <h1 className="display">See how AI shoppers treat your listing</h1>
        <p className="lede">Shopping agents on every major model compare your product with real competitors, try to check out, and show you what to fix.</p>
      </section>
      <div className="gap-xl" />

      <form className="card form" onSubmit={start}>
        <div className="field">
          <label htmlFor="product">Your product</label>
          <select id="product" value={productId} onChange={(e) => setProductId(e.target.value)} required>
            {products.length === 0 && <option value="">Publish a product in Store first</option>}
            {products.map((p) => <option key={p.id} value={p.id}>{p.title}</option>)}
          </select>
        </div>
        <div className="field">
          <label htmlFor="query">Shopper intent</label>
          <input id="query" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="merino wool crew sweater under $150" required />
        </div>
        <div className="field">
          <label htmlFor="reps">Runs per model and variant</label>
          <input id="reps" type="number" min={1} max={10} value={reps} onChange={(e) => setReps(Number(e.target.value))} />
        </div>
        <div className="field" style={{ justifyContent: "flex-end" }}>
          <button className="btn red" disabled={busy || !productId}>{busy ? "Starting fleet" : "Run the fleet"}</button>
        </div>
        {error && <div className="notice full">{error}</div>}
      </form>

      <div className="gap-xl" />
      <div className="spread"><h2 className="section">Experiments</h2></div>
      <div style={{ height: 16 }} />
      <Stagger className="card list">
        {experiments === null && <div className="empty">Loading</div>}
        {experiments?.length === 0 && <div className="empty">No experiments yet.</div>}
        {experiments?.map((x) => (
          <Item key={x.id} className="list-row" {...hoverCard}>
            <Link to={`/app/experiments/${x.id}`} className="list-row-link" style={{ display: "contents" }}>
              <div>
                <div className="product-title">{x.query}</div>
                <div className="meta">{productTitle(x.product_id)}</div>
              </div>
              <span className="meta">{x.run_counts ? `${x.run_counts.done}/${x.run_counts.total} runs` : ""}</span>
              <span className={`tag ${x.status === "running" ? "red" : ""}`}>{x.status}</span>
            </Link>
          </Item>
        ))}
      </Stagger>
    </div>
  );
}
