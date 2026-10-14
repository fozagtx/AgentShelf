import { useEffect, useMemo, useRef, useState } from "react";
import { api, type Channel3Hit, type Product } from "./api";

type Option =
  | { kind: "store"; key: string; product: Product }
  | { kind: "channel3"; key: string; hit: Channel3Hit }
  | { kind: "url"; key: string; url: string };

const money = (n: number | undefined) => (typeof n === "number" ? `$${n.toFixed(2)}` : "");

export function ProductPicker({
  products,
  value,
  onChange,
  onImported,
}: {
  products: Product[];
  value: string;
  onChange: (id: string) => void;
  onImported: (p: Product) => void;
}) {
  const selected = products.find((p) => p.id === value);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<Channel3Hit[] | null>(null);
  const [fetching, setFetching] = useState(false);
  const [searched, setSearched] = useState(false);
  const [error, setError] = useState("");
  const [importing, setImporting] = useState<string | null>(null);
  const [active, setActive] = useState(0);
  const requestId = useRef(0);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listId = "product-picker-list";

  const existing = useMemo(
    () => new Set(products.map((p) => p.channel3_id).filter(Boolean)),
    [products],
  );

  const storeMatches = useMemo(() => {
    const tokens = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (!tokens.length) return products;
    return products.filter((p) => {
      const hay = `${p.title} ${p.brand}`.toLowerCase();
      return tokens.every((token) => hay.includes(token));
    });
  }, [products, query]);

  const isUrl = query.trim().startsWith("http");

  const options = useMemo<Option[]>(() => {
    if (isUrl) return [{ kind: "url", key: "url", url: query.trim() }];
    return [
      ...storeMatches.map((product) => ({ kind: "store" as const, key: `s:${product.id}`, product })),
      ...(hits ?? []).map((hit) => ({ kind: "channel3" as const, key: `c:${hit.channel3Id}`, hit })),
    ];
  }, [isUrl, query, storeMatches, hits]);

  useEffect(() => {
    const q = query.trim();
    setError("");
    if (isUrl || q.length < 3) {
      requestId.current += 1;
      setHits(null);
      setFetching(false);
      setSearched(false);
      return;
    }
    const id = ++requestId.current;
    const timer = setTimeout(() => {
      setFetching(true);
      setSearched(false);
      api.searchChannel3(q)
        .then((results) => {
          if (id !== requestId.current) return;
          setHits(results.filter((h) => !existing.has(h.channel3Id)));
          setSearched(true);
        })
        .catch((e) => {
          if (id !== requestId.current) return;
          setHits([]);
          setSearched(true);
          setError(e instanceof Error ? e.message : String(e));
        })
        .finally(() => {
          if (id === requestId.current) setFetching(false);
        });
    }, 400);
    return () => clearTimeout(timer);
  }, [query, isUrl, existing]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) {
        setOpen(false);
        if (selected) { setSearching(false); setQuery(""); }
      }
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, [open]);

  const openSearch = () => {
    setSearching(true);
    setOpen(true);
    requestAnimationFrame(() => inputRef.current?.focus());
  };

  const pickStore = (product: Product) => {
    onChange(product.id);
    setOpen(false);
    setSearching(false);
    setQuery("");
  };

  const doImport = async (body: { channel3Id?: string; url?: string }, key: string) => {
    setImporting(key);
    setError("");
    try {
      const product = await api.importProduct(body);
      onImported(product);
      onChange(product.id);
      setOpen(false);
      setSearching(false);
      setQuery("");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setImporting(null);
    }
  };

  const pick = (option: Option) => {
    if (importing) return;
    if (option.kind === "store") pickStore(option.product);
    else if (option.kind === "channel3") void doImport({ channel3Id: option.hit.channel3Id }, option.key);
    else void doImport({ url: option.url }, option.key);
  };

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowUp") {
      e.preventDefault();
      if (!open) { setOpen(true); return; }
      const delta = e.key === "ArrowDown" ? 1 : -1;
      setActive((a) => options.length ? (a + delta + options.length) % options.length : 0);
    } else if (e.key === "Enter") {
      if (open && options[active]) {
        e.preventDefault();
        pick(options[active]);
      }
    } else if (e.key === "Escape") {
      setOpen(false);
      if (selected) { setSearching(false); setQuery(""); }
    }
  };

  if (selected && !searching) {
    return (
      <div className="product-pick">
        <div className="product-pick-card">
          {selected.image_url ? (
            <img src={`/api/img/product/${selected.id}`} alt="" className="product-pick-thumb" />
          ) : (
            <span className="product-pick-thumb product-pick-noimg" aria-hidden />
          )}
          <div className="product-pick-meta">
            <div className="product-pick-title">{selected.title}</div>
            <div className="meta">{selected.brand}{selected.brand ? " · " : ""}{money(selected.price)}</div>
          </div>
          <button type="button" className="btn ghost sm" onClick={openSearch}>Change</button>
        </div>
      </div>
    );
  }

  const optionIndex = new Map(options.map((o, i) => [o.key, i]));

  return (
    <div className="product-pick" ref={rootRef}>
      <input
        ref={inputRef}
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-activedescendant={open && options[active] ? `${listId}-${active}` : undefined}
        placeholder="Search your store or Channel3, or paste a product URL"
        value={query}
        onFocus={() => setOpen(true)}
        onChange={(e) => { setQuery(e.target.value); setOpen(true); setActive(0); }}
        onKeyDown={onKeyDown}
      />
      {open && (
        <div className="product-pick-drop" id={listId} role="listbox">
          {isUrl ? (
            <div
              id={`${listId}-${optionIndex.get("url")}`}
              role="option"
              aria-selected={options[active]?.key === "url"}
              className={`product-pick-row${options[active]?.key === "url" ? " active" : ""}${importing ? " disabled" : ""}`}
              onMouseDown={(e) => { e.preventDefault(); pick(options[0]); }}
            >
              <span className="product-pick-row-text">
                {importing === "url" ? "Importing" : "Import this product page"}
              </span>
              <code>{query.trim()}</code>
            </div>
          ) : (
            <>
              <div className="product-pick-head">In your store</div>
              {storeMatches.length === 0 && <div className="product-pick-empty">No store products match.</div>}
              {storeMatches.map((product) => {
                const key = `s:${product.id}`;
                const isActive = options[active]?.key === key;
                return (
                  <div
                    key={key}
                    id={`${listId}-${optionIndex.get(key)}`}
                    role="option"
                    aria-selected={isActive}
                    className={`product-pick-row${isActive ? " active" : ""}${importing ? " disabled" : ""}`}
                    onMouseDown={(e) => { e.preventDefault(); pick({ kind: "store", key, product }); }}
                  >
                    {product.image_url ? (
                      <img src={`/api/img/product/${product.id}`} alt="" className="product-pick-thumb" />
                    ) : (
                      <span className="product-pick-thumb product-pick-noimg" aria-hidden />
                    )}
                    <span className="product-pick-row-text">
                      <span className="product-pick-row-title">{product.title}</span>
                      <span className="meta">{product.brand}{product.brand ? " · " : ""}{money(product.price)}</span>
                    </span>
                  </div>
                );
              })}
              <div className="product-pick-head">From Channel3</div>
              {fetching && <div className="product-pick-empty">Searching Channel3</div>}
              {!fetching && searched && !error && (hits ?? []).length === 0 && (
                <div className="product-pick-empty">Nothing found on Channel3.</div>
              )}
              {!fetching && !searched && !error && query.trim().length < 3 && (
                <div className="product-pick-empty">Type at least 3 characters to search Channel3.</div>
              )}
              {(hits ?? []).map((hit) => {
                const key = `c:${hit.channel3Id}`;
                const isActive = options[active]?.key === key;
                return (
                  <div
                    key={key}
                    id={`${listId}-${optionIndex.get(key)}`}
                    role="option"
                    aria-selected={isActive}
                    className={`product-pick-row${isActive ? " active" : ""}${importing && importing !== key ? " disabled" : ""}`}
                    onMouseDown={(e) => { e.preventDefault(); pick({ kind: "channel3", key, hit }); }}
                  >
                    {hit.imageUrl ? (
                      <img src={hit.imageUrl} alt="" className="product-pick-thumb" />
                    ) : (
                      <span className="product-pick-thumb product-pick-noimg" aria-hidden />
                    )}
                    <span className="product-pick-row-text">
                      <span className="product-pick-row-title">{importing === key ? "Importing" : hit.title}</span>
                      <span className="meta">{hit.brand}{hit.brand ? " · " : ""}{money(hit.price)}</span>
                    </span>
                  </div>
                );
              })}
            </>
          )}
          {error && <div className="product-pick-empty product-pick-error">{error}</div>}
        </div>
      )}
    </div>
  );
}
