"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import { useEffect, useState } from "react";
import { pageFromHash } from "@/lib/workflow-ui.mjs";

const links = [
  { href: "/#campaigns", label: "Email", iconPath: "M3 5h18v14H3z M3 5l9 7 9-7", routes: [] },
  { href: "/#prospects", label: "Prospects", iconPath: "M8 3h8l4 4v14H4V3z M8 11h8 M8 16h8", routes: ["/yc", "/import"] },
  { href: "/#dialer", label: "Call", iconPath: "M7 3h3l1 5-2 2a14 14 0 0 0 5 5l2-2 5 1v3a2 2 0 0 1-2 2A17 17 0 0 1 5 5a2 2 0 0 1 2-2", routes: [] },
  { href: "/activity", label: "Activity", iconPath: "M4 4v16h16 M8 15l4-4 3 2 5-7", routes: ["/activity"] },
  { href: "/#settings", label: "Settings", iconPath: "M12 8a4 4 0 1 0 0 8 4 4 0 0 0 0-8 M12 2v3 M12 19v3 M2 12h3 M19 12h3 M5 5l2 2 M17 17l2 2 M5 19l2-2 M17 7l2-2", routes: ["/mailboxes", "/playbooks", "/email-preflight"] },
];

export default function WorkspaceNav() {
  const pathname = usePathname();
  const [hash, setHash] = useState("");

  useEffect(() => {
    const sync = () => setHash(window.location.hash);
    sync();
    window.addEventListener("hashchange", sync);
    window.addEventListener("popstate", sync);
    return () => {
      window.removeEventListener("hashchange", sync);
      window.removeEventListener("popstate", sync);
    };
  }, [pathname]);

  return (
    <>
    <a className="skip-link" href="#main-content" onClick={(event) => {
      event.preventDefault();
      const main = document.querySelector("main");
      if (main) { main.tabIndex = -1; main.focus({ preventScroll: true }); main.scrollIntoView({ block: "start" }); }
    }}>Skip to workspace</a>
    <header className="workspace-header">
      <nav className="workspace-dock" aria-label="Workspace navigation">
        <Link className="dock-brand" href="/#campaigns" prefetch={false} aria-label="Outbounder home">
          <span className="brand-name">Outbounder</span>
        </Link>

        <div className="dock-separator" aria-hidden="true" />

        <div className="dock-links">
          {links.map((link) => {
            const isActive =
              pathname === "/"
                ? link.href === `/#${pageFromHash(hash)}`
                : link.routes.includes(pathname);

            return (
              <Link
                key={link.label}
                href={link.href}
                prefetch={false}
                className={`dock-item ${isActive ? "active" : ""}`}
                title={link.label}
                aria-label={link.label}
                aria-current={isActive ? "page" : undefined}
                onClick={(event) => {
                  if (pathname !== "/" || !link.href.startsWith("/#") || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
                  event.preventDefault();
                  const nextHash = link.href.slice(1);
                  if (window.location.hash !== nextHash) window.history.pushState(null, "", nextHash);
                  window.dispatchEvent(new HashChangeEvent("hashchange"));
                }}
              >
                <svg
                  aria-hidden="true"
                  width="17"
                  height="17"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.8"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  className="dock-icon"
                >
                  <path d={link.iconPath} />
                </svg>
                <span className="dock-label">{link.label}</span>
                {isActive && <span className="dock-active-pill" />}
              </Link>
            );
          })}
        </div>

      </nav>
    </header>
    </>
  );
}
