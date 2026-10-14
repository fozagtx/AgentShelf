import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import { Link } from "./router";

export type Crumb = { title: string; status: string } | null;
const CrumbContext = createContext<(c: Crumb) => void>(() => {});

export function useCrumb(crumb: Crumb) {
  const set = useContext(CrumbContext);
  const title = crumb?.title;
  const status = crumb?.status;
  useEffect(() => {
    set(title && status ? { title, status } : null);
    return () => set(null);
  }, [set, title, status]);
}

const railIcon = {
  experiments: <path d="M4 5h6v6H4zM14 5h6v6h-6zM4 15h6v4H4zM14 15h6v4h-6z" />,
  store: <path d="M5 8h14l-1.2 11.2a1 1 0 0 1-1 .8H7.2a1 1 0 0 1-1-.8L5 8Zm4 0V7a3 3 0 0 1 6 0v1" />,
  home: <path d="M4 11 12 4l8 7M6 9.5V20h12V9.5" />,
};

function RailLink({ to, label, on, icon }: { to: string; label: string; on: boolean; icon: ReactNode }) {
  return (
    <Link to={to} className={`rail-link${on ? " on" : ""}`} aria-label={label} title={label}>
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden>{icon}</svg>
    </Link>
  );
}

export function Shell({ path, children }: { path: string; children: ReactNode }) {
  const [crumb, setCrumb] = useState<Crumb>(null);
  const isExp = path.startsWith("/app/experiments/");
  const inStore = path.startsWith("/app/store");
  const section = inStore ? "Store" : "Experiments";
  const statusClass = crumb?.status === "complete" ? "ok" : crumb?.status === "failed" ? "bad" : "live";

  return (
    <CrumbContext.Provider value={setCrumb}>
      <div className="app">
        <aside className="rail">
          <Link to="/" className="rail-brand" aria-label="AgentShelf home">
            <svg width="16" height="16" viewBox="0 0 32 32" aria-hidden><path d="M6 22h20M6 15h20M10 8h12" stroke="#fff" strokeWidth="3.4" strokeLinecap="round" /></svg>
          </Link>
          <nav className="rail-nav" aria-label="App">
            <RailLink to="/app" label="Experiments" on={!inStore} icon={railIcon.experiments} />
            <RailLink to="/app/store" label="Store" on={inStore} icon={railIcon.store} />
          </nav>
          <div className="rail-end">
            <RailLink to="/" label="Back to site" on={false} icon={railIcon.home} />
          </div>
        </aside>
        <div className="app-main">
          <header className="bar">
            <Link to="/" className="bar-brand">AgentShelf</Link>
            <div className="crumbs">
              <svg width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinejoin="round" aria-hidden><path d="M3.5 7a1.5 1.5 0 0 1 1.5-1.5h4l2 2h8a1.5 1.5 0 0 1 1.5 1.5v8.5a1.5 1.5 0 0 1-1.5 1.5H5a1.5 1.5 0 0 1-1.5-1.5Z" /></svg>
              <Link to={inStore ? "/app/store" : "/app"} className="crumb-root">{section}</Link>
              {isExp && crumb && (
                <>
                  <span className="crumb-sep">/</span>
                  <span className="crumb-title" title={crumb.title}>{crumb.title}</span>
                  <span className={`crumb-status ${statusClass}`}>{crumb.status}</span>
                </>
              )}
            </div>
            <Link to="/app" className="bar-cta">Run a test</Link>
          </header>
          <main className={`page${isExp ? " wide" : ""}`} key={path}>{children}</main>
        </div>
      </div>
    </CrumbContext.Provider>
  );
}
