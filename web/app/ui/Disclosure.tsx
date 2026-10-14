import type { ReactNode } from "react";

export function Disclosure({ title, children, className = "" }: { title: ReactNode; children: ReactNode; className?: string }) {
  return <details className={`simple-disclosure ${className}`.trim()}>
    <summary>{title}</summary>
    <div className="disclosure-content">{children}</div>
  </details>;
}
