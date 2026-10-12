import { StrictMode, useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import { MotionConfig } from "motion/react";
import Lenis from "lenis";
import "lenis/dist/lenis.css";
import "./styles.css";
import { Experiments } from "./Experiments";
import { ExperimentView } from "./ExperimentView";
import { Store } from "./Store";
import { Landing } from "./Landing";
import { Link } from "./router";



function usePath() {
  const [path, setPath] = useState(location.pathname);
  useEffect(() => {
    const on = () => setPath(location.pathname);
    addEventListener("popstate", on);
    return () => removeEventListener("popstate", on);
  }, []);
  return path;
}

function App() {
  const path = usePath();
  const exp = path.match(/^\/app\/experiments\/([^/]+)/);
  if (!path.startsWith("/app")) return <Landing />;

  return (
    <div className="frame">
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
            <Link to="/app" className={path === "/app" || exp ? "on" : ""}>Experiments</Link>
            <Link to="/app/store" className={path.startsWith("/app/store") ? "on" : ""}>Store</Link>
          </nav>
          <Link to="/app" className="btn top-cta">Run a test <span className="arrow">→</span></Link>
        </div>
      </header>
      <main className="page" key={path}>
        {exp ? <ExperimentView id={exp[1]} /> : path.startsWith("/app/store") ? <Store /> : <Experiments />}
      </main>
    </div>
  );
}

if (!matchMedia("(prefers-reduced-motion: reduce)").matches) new Lenis({ autoRaf: true, lerp: 0.09, anchors: true });

createRoot(document.getElementById("root")!).render(
  <MotionConfig reducedMotion="user">
    <StrictMode>
      <App />
    </StrictMode>
  </MotionConfig>,
);
