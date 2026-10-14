import type { CSSProperties, MouseEvent, ReactNode } from "react";

export function navigate(to: string) {
  history.pushState(null, "", to);
  dispatchEvent(new PopStateEvent("popstate"));
}

export function Link(props: { to: string; className?: string; style?: CSSProperties; title?: string; "aria-label"?: string; onClick?: (e: MouseEvent<HTMLAnchorElement>) => boolean | void; children: ReactNode }) {
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
        if (props.onClick?.(e) === false) return;
        navigate(props.to);
      }}
    >
      {props.children}
    </a>
  );
}
