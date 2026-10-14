const paths = {
  scan: "M3 5h14v10H3zM3 5l7 5 7-5M20 17a3 3 0 1 1-6 0 3 3 0 0 1 6 0Zm-1 2 3 3",
  edit: "m16 3 5 5M4 20l4-1L21 6l-5-5L3 15l-1 5Z",
  activate: "M8 5v14l11-7Z",
  pause: "M8 5v14M16 5v14",
  delete: "M3 6h18M9 6V3h6v3M5 6l1 15h12l1-15M10 10v7M14 10v7",
  // Circular arrow: restart the daily allowance, not delete anything.
  reset: "M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5",
};

export default function MailboxActionIcon({ action }: { action: keyof typeof paths }) {
  return <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d={paths[action]} /></svg>;
}
