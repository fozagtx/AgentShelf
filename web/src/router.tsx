import type { CSSProperties, ReactNode } from "react";

export function navigate(to: string) {
  history.pushState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
}

export function Link(props: { to: string; className?: string; style?: CSSProperties; title?: string; "aria-label"?: string; children: ReactNode }) {
  return (
    <a
      href={props.to}
      className={props.className}
      style={props.style}
      title={props.title}
      aria-label={props["aria-label"]}
      onClick={(e) => {
        if (e.metaKey || e.ctrlKey) return;
        e.preventDefault();
        navigate(props.to);
      }}
    >
      {props.children}
    </a>
  );
}
