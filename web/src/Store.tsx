import { useEffect, useState } from "react";
import { api, type Channel3Hit, type Product } from "./api";
import { AsciiImage } from "./Ascii";
import { Item, Stagger, hoverCard } from "./motion";

const blank = { title: "", description: "", brand: "", price: 0, image_url: "", inventory: 10, category: "", key_features: [] as string[] };

export function Store() {
  const [products, setProducts] = useState<Product[] | null>(null);
  const [draft, setDraft] = useState(blank);
  const [features, setFeatures] = useState("");
  const [error, setError] = useState("");
  const [fixing, setFixing] = useState("");
  const [lookup, setLookup] = useState("");
  const [hits, setHits] = useState<Channel3Hit[] | null>(null);
  const [importing, setImporting] = useState("");

  async function findOnChannel3(e: React.FormEvent) {
    e.preventDefault();
    const q = lookup.trim();
    if (!q) return;
    setError("");
    setImporting("lookup");
    try {
      if (/^https?:\/\//i.test(q)) {
        await api.importProduct({ url: q });
        setLookup("");
        setHits(null);
        load();
      } else {
        setHits(await api.searchChannel3(q));
      }
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting("");
    }
  }

  async function add(hit: Channel3Hit) {
    setError("");
    setImporting(hit.channel3Id);
    try {
      await api.importProduct({ channel3Id: hit.channel3Id });
      setHits((h) => h?.filter((x) => x.channel3Id !== hit.channel3Id) ?? null);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setImporting("");
    }
  }

  const load = () => api.products().then(setProducts).catch((e) => { setProducts([]); setError(e.message); });
  useEffect(() => { load(); }, []);

  async function publish(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    try {
      await api.createProduct({ ...draft, key_features: features.split("\n").map((f) => f.trim()).filter(Boolean) });
      setDraft(blank);
      setFeatures("");
      load();
    } catch (err) {
      setError((err as Error).message);
    }
  }

  async function fix(id: string) {
    setFixing(id);
    setError("");
    try {
      await api.fix(id);
      load();
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setFixing("");
    }
  }

  const set = (k: keyof typeof blank) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
    setDraft({ ...draft, [k]: k === "price" || k === "inventory" ? Number(e.target.value) : e.target.value });

  return (
    <div className="enter">
      <section className="hero">
      <h1 className="display">Your store, ready for agents</h1>
      <p className="lede">Every product here is served on the PayPal Store Sync cart API and in your product feed.</p>
      </section>
      <div className="row" style={{ marginTop: 18, justifyContent: "center" }}>
        <a className="btn ghost" href="/feed.csv" target="_blank" rel="noreferrer">Product feed</a>
        <a className="btn ghost" href="/.well-known/jwks.json" target="_blank" rel="noreferrer">JWKS</a>
      </div>
      <div className="gap-xl" />

      {error && <><div className="notice">{error}</div><div style={{ height: 16 }} /></>}

      <Stagger className="stack">
        {products?.map((p) => (
          <Item key={p.id} className="card" style={{ overflow: "hidden" }} {...hoverCard}>
            <div className="list-row" style={{ gridTemplateColumns: "72px 1fr auto auto" }}>
              <div className="product-img" style={{ width: 72, borderRadius: 10 }}>{p.image_url && <AsciiImage src={`/api/img/product/${p.id}`} alt={p.title} />}</div>
              <div>
                <div className="product-title">{p.title}</div>
                <div className="meta">{p.brand} · {p.inventory} in stock · {p.id}</div>
              </div>
              <span className="price">${p.price.toFixed(2)}</span>
              <button className="btn ghost" onClick={() => fix(p.id)} disabled={fixing === p.id}>
                {fixing === p.id ? "Rewriting" : p.fixed_variant ? "Rewrite again" : "Suggest a fix"}
              </button>
            </div>
            {p.fixed_variant && (
              <div className="diff" style={{ borderTop: "1px solid var(--line)" }}>
                <div>
                  <div className="eyebrow" style={{ color: "var(--muted)" }}>Original</div>
                  <p className="product-title">{p.title}</p>
                  <p className="meta">{p.description}</p>
                </div>
                <div>
                  <div className="eyebrow">Fixed</div>
                  <p className="product-title">{p.fixed_variant.title}</p>
                  <p className="meta">{p.fixed_variant.description}</p>
                  <ul className="rationale">{p.fixed_variant.rationale.map((r) => <li key={r}>{r}</li>)}</ul>
                </div>
              </div>
            )}
          </Item>
        ))}
      </Stagger>

      <div className="gap-xl" />
      <h2 className="section">Import from Channel3</h2>
      <div style={{ height: 16 }} />
      <form className="card form" onSubmit={findOnChannel3}>
        <div className="field full">
          <label>Product page URL or search</label>
          <input value={lookup} onChange={(e) => setLookup(e.target.value)} placeholder="https://yourstore.com/products/merino-crew or merino crew sweater" />
        </div>
        <div className="full"><button className="btn red" disabled={importing === "lookup"}>{importing === "lookup" ? "Looking up" : "Find product"}</button></div>
      </form>
      {hits && (
        <>
          <div style={{ height: 16 }} />
          {hits.length === 0 ? <div className="card empty">Nothing found on Channel3.</div> : (
            <Stagger className="grid3">
              {hits.map((h) => (
                <Item key={h.channel3Id} className="card product" {...hoverCard}>
                  <div className="product-img">{h.imageUrl && <img src={h.imageUrl} alt="" />}</div>
                  <div className="product-body">
                    <div className="product-title">{h.title}</div>
                    <div className="row" style={{ justifyContent: "space-between" }}>
                      <span className="price">${h.price.toFixed(2)}</span>
                      <button className="btn ghost" onClick={() => add(h)} disabled={importing === h.channel3Id}>{importing === h.channel3Id ? "Adding" : "Add to store"}</button>
                    </div>
                  </div>
                </Item>
              ))}
            </Stagger>
          )}
        </>
      )}

      <div className="gap-xl" />
      <h2 className="section">Publish a product</h2>
      <div style={{ height: 16 }} />
      <form className="card form" onSubmit={publish}>
        <div className="field full"><label>Title</label><input value={draft.title} onChange={set("title")} required /></div>
        <div className="field"><label>Brand</label><input value={draft.brand} onChange={set("brand")} required /></div>
        <div className="field"><label>Category</label><input value={draft.category} onChange={set("category")} required /></div>
        <div className="field"><label>Price (USD)</label><input type="number" step="0.01" min="0" value={draft.price || ""} onChange={set("price")} required /></div>
        <div className="field"><label>Inventory</label><input type="number" min="0" value={draft.inventory} onChange={set("inventory")} required /></div>
        <div className="field full"><label>Image URL</label><input type="url" value={draft.image_url} onChange={set("image_url")} required /></div>
        <div className="field full"><label>Description</label><textarea value={draft.description} onChange={set("description")} required /></div>
        <div className="field full"><label>Key features, one per line</label><textarea value={features} onChange={(e) => setFeatures(e.target.value)} /></div>
        <div className="full"><button className="btn red">Publish</button></div>
      </form>
    </div>
  );
}
