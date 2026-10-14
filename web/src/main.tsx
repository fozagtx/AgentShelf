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
import { Shell } from "./Shell";



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
  const known = path === "/app" || path === "/app/" || path.startsWith("/app/store") || exp;
  useEffect(() => {
    if (path.startsWith("/app") && !known) {
      history.replaceState(null, "", "/app");
      dispatchEvent(new PopStateEvent("popstate"));
    }
  }, [path, known]);

  if (!path.startsWith("/app")) return <Landing />;
  if (!known) return null;

  return (
    <Shell path={path}>
      {exp ? <ExperimentView id={exp[1]} /> : path.startsWith("/app/store") ? <Store /> : <Experiments />}
    </Shell>
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
