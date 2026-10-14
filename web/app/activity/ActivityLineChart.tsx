"use client";

import { useEffect, useRef, useState } from "react";
import type { PointerEvent } from "react";
import type { ActivityReport } from "@/lib/activity";
import styles from "./Activity.module.css";

const series = [
  { key: "sent", label: "SMTP accepted", color: "#16835d" },
  { key: "dryRun", label: "Dry run", color: "#4d78ce" },
  { key: "bounced", label: "Bounce events", color: "#ce4a60" },
  { key: "deferred", label: "Deferred", color: "#bd8418" },
  { key: "failedSuppressed", label: "Failed / suppressed", color: "#7d5fb5" },
] as const;
type SeriesKey = typeof series[number]["key"];

export default function ActivityLineChart({ daily }: { daily: ActivityReport["daily"] }) {
  const plot = useRef<HTMLDivElement>(null);
  const [width, setWidth] = useState(900);
  const [selected, setSelected] = useState<number | null>(null);
  const [hidden, setHidden] = useState<Set<SeriesKey>>(() => new Set());
  useEffect(() => {
    const element = plot.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setWidth(Math.max(280, element.clientWidth)));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  useEffect(() => { setSelected(null); }, [daily]);
  const visible = series.filter((item) => !hidden.has(item.key));
  const max = Math.max(1, ...daily.flatMap((day) => visible.map((item) => day[item.key])));
  const height = 280, left = 38, right = 12, top = 16, bottom = 30;
  const plotWidth = width-left-right, plotHeight = height-top-bottom;
  const x = (index: number) => left + index/Math.max(1, daily.length-1)*plotWidth;
  const y = (value: number) => top + plotHeight*(1-value/max);
  const active = selected === null ? null : daily[selected];
  const tickCount = width < 500 ? 4 : 5;
  const ticks = new Set(Array.from({ length: tickCount }, (_, i) => Math.round(i*(daily.length-1)/(tickCount-1))));
  const values = Array.from(new Set([0, Math.round(max/2), max]));
  function pointAt(event: PointerEvent<SVGSVGElement>) {
    const rect = event.currentTarget.getBoundingClientRect();
    const position = (event.clientX-rect.left)/rect.width*width;
    setSelected(Math.max(0, Math.min(daily.length-1, Math.round((position-left)/plotWidth*(daily.length-1)))));
  }
  return <section className={styles.chartPanel} aria-label="Daily email progress">
    <div className={styles.chartLegend}>{series.map((item) => <button type="button" key={item.key} aria-pressed={!hidden.has(item.key)} title={`Show or hide ${item.label}`} onClick={() => setHidden((current) => { const next = new Set(current); if (next.has(item.key)) next.delete(item.key); else next.add(item.key); return next; })}><i style={{ background: item.color }} />{item.label}</button>)}</div>
    <div className={styles.chartPlot} ref={plot}>
      {daily.length > 0 && visible.length > 0 ? <svg className={styles.lineChart} viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Daily email activity line chart" aria-describedby="activity-chart-help" tabIndex={0}
        onPointerMove={pointAt} onPointerDown={(event) => { event.currentTarget.focus(); pointAt(event); }}
        onPointerLeave={(event) => { if (document.activeElement !== event.currentTarget) setSelected(null); }}
        onFocus={() => setSelected((current) => current ?? daily.length-1)} onBlur={() => setSelected(null)}
        onKeyDown={(event) => {
          if (!["ArrowLeft", "ArrowRight", "Home", "End", "Escape"].includes(event.key)) return;
          event.preventDefault();
          if (event.key === "Escape") { setSelected(null); return; }
          setSelected((current) => event.key === "Home" ? 0 : event.key === "End" ? daily.length-1 : Math.max(0, Math.min(daily.length-1, (current ?? daily.length-1) + (event.key === "ArrowLeft" ? -1 : 1))));
        }}>
        <title>Daily outbound event counts. Each coloured line is a separate event series.</title>
        {values.map((value) => <g key={value}><line x1={left} y1={y(value)} x2={width-right} y2={y(value)} stroke="var(--line)" /><text x={left-7} y={y(value)+4} textAnchor="end" fill="var(--muted)" fontSize="11">{value}</text></g>)}
        {daily.map((day,index) => ticks.has(index) && <text key={day.date} x={x(index)} y={height-8} textAnchor={index===0 ? "start" : index===daily.length-1 ? "end" : "middle"} fill="var(--muted)" fontSize="11">{day.date.slice(5)}</text>)}
        {visible.map((item) => <polyline key={item.key} data-series={item.key} points={daily.map((day,index) => `${x(index)},${y(day[item.key])}`).join(" ")} fill="none" stroke={item.color} strokeWidth="2.5" strokeLinejoin="round" strokeLinecap="round" />)}
        {selected !== null && active && <g><line x1={x(selected)} y1={top} x2={x(selected)} y2={height-bottom} stroke="var(--muted)" strokeDasharray="3 4" />{visible.map((item) => <circle key={item.key} cx={x(selected)} cy={y(active[item.key])} r="4" fill={item.color} stroke="var(--sheet)" strokeWidth="1.5" />)}</g>}
      </svg> : <div className={styles.empty}>{daily.length ? "No series selected" : "No activity recorded"}</div>}
      {active && visible.length > 0 && <div className={styles.chartTooltip} role="status" aria-live="polite"><strong>{active.date}</strong>{visible.map((item) => <div key={item.key}><span><i style={{background:item.color}} />{item.label}</span><b>{active[item.key]}</b></div>)}</div>}
    </div>
    <span id="activity-chart-help" className="sr-only">Hover or tap to inspect a date. Use left and right arrows, Home or End when the chart is focused. Legend buttons toggle series.</span>
    <small>Recorded events · not delivery confirmations</small>
  </section>;
}
