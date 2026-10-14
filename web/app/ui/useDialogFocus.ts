"use client";

import { useEffect, useRef } from "react";

/** Native controls remain keyboard-operable inside a confirmation dialog. */
export function useDialogFocus(open: boolean | string, busy: boolean, close: () => void) {
  const closeRef = useRef(close);
  const busyRef = useRef(busy);
  closeRef.current = close;
  busyRef.current = busy;
  useEffect(() => {
    if (!open) return;
    const previous = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    const dialog = document.querySelector<HTMLElement>('[role="alertdialog"]') || document.querySelector<HTMLElement>('[role="dialog"]');
    if (!dialog) return;
    const controls = () => Array.from(dialog.querySelectorAll<HTMLElement>('button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), a[href], summary')).filter((element) => element.checkVisibility() && element.getClientRects().length > 0);
    (dialog.querySelector<HTMLElement>('[data-autofocus]') || controls()[0])?.focus({ preventScroll: true });
    const keydown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab") return;
      const items = controls();
      if (!items.length) { event.preventDefault(); return; }
      const first = items[0]; const last = items[items.length - 1];
      if (event.shiftKey && (document.activeElement === first || !dialog.contains(document.activeElement))) { event.preventDefault(); last.focus(); }
      if (!event.shiftKey && (document.activeElement === last || !dialog.contains(document.activeElement))) { event.preventDefault(); first.focus(); }
    };
    document.body.style.overflow = "hidden";
    window.addEventListener("keydown", keydown);
    return () => {
      document.body.style.overflow = previousOverflow;
      window.removeEventListener("keydown", keydown);
      if (previous?.isConnected) previous.focus({ preventScroll: true });
    };
  }, [open]);
}
