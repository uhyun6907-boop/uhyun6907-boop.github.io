import { useState, useEffect, useMemo, useRef, useTheme } from "./kit";
import type { ChangeEvent, KeyboardEvent, CSSProperties, ReactNode } from "react";
import { readCached, writeStore } from "./store";
import { syncRound, keyOfT, timeOfT, tOf } from "./sync";
import type { Rec, RecMap, SyncCfg, SettingsRec, PlanSeg } from "./sync";
import { normSettings } from "./sync";
import { DAY_START_HOUR, DEFAULT_GOAL, DEFAULT_SEGS, SYNC_TARGET, isMorningHour, isValidKg, isValidPer, roundKg } from "./rules";

type Entry = { id: number; t: string; w: number };
type Stamp = { meal: boolean; ex: boolean };
type SyncState = { token: string; owner: string; repo: string; meta: Record<string, number>; tomb: Record<string, Rec>; setU?: number; last?: number; err?: string; up?: number; down?: number };
type Stored = { v: number; entries: [string, number][]; goal: number; warn?: number; stamps: Record<string, Stamp>; mode?: string; sync?: SyncState; goalV?: number; plan?: PlanCfg };
type DayRec = { dk: string; n: number; am: number | null; pm: number | null; count: number };
type RangeKey = "7" | "31" | "90" | "365" | "all";

const WD = ["일", "월", "화", "수", "목", "금", "토"];

const pad = (n: number): string => (n < 10 ? "0" : "") + String(n);
const dayNum = (dk: string): number => Math.round(Date.UTC(Number(dk.slice(0, 4)), Number(dk.slice(4, 6)) - 1, Number(dk.slice(6, 8))) / 864e5);
const numToDk = (n: number): string => { const d = new Date(n * 864e5); return String(d.getUTCFullYear()) + pad(d.getUTCMonth() + 1) + pad(d.getUTCDate()); };
const wdOf = (n: number): string => WD[new Date(n * 864e5).getUTCDay()];
const isAM = (t: string): boolean => isMorningHour(Number(t.slice(8, 10)));
const fmtDay = (dk: string): string => `${dk.slice(0, 4)}.${Number(dk.slice(4, 6))}.${Number(dk.slice(6, 8))}`;
const fmtShort = (dk: string): string => `${Number(dk.slice(4, 6))}/${Number(dk.slice(6, 8))}`;
const fmtTime = (t: string): string => `${t.slice(8, 10)}:${t.slice(10, 12)}`;
const kg = (v: number): string => v.toFixed(1);
const signed = (v: number): string => { const r = roundKg(v); return (r > 0 ? "+" : r < 0 ? "−" : "±") + Math.abs(r).toFixed(1); };
const mean = (a: number[]): number | null => (a.length ? a.reduce((s: number, x: number) => s + x, 0) / a.length : null);
const todayDk = (): string => { const d = new Date(); return String(d.getFullYear()) + pad(d.getMonth() + 1) + pad(d.getDate()); };
const nowInput = (): string => { const d = new Date(); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`; };
const tToInput = (t: string): string => `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)}T${t.slice(8, 10)}:${t.slice(10, 12)}`;
const inputToT = (s: string): string => s.replace(/[^0-9]/g, "").slice(0, 12);
const tagOf = (t: string): string => (isAM(t) ? "오전 ○" : "오후 ●");
const defDate = (): string => { const d = new Date(); if (d.getHours() < DAY_START_HOUR) d.setDate(d.getDate() - 1); return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`; };
const defSlot = (): "am" | "pm" => (isMorningHour(new Date().getHours()) ? "am" : "pm");

type ImportResult = { items: [string, number][]; stamps: Record<string, Stamp>; bad: number };
function parseImport(text: string): ImportResult {
  const items: [string, number][] = []; const stamps: Record<string, Stamp> = {}; let bad = 0;
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/);
  for (const raw0 of lines) {
    const line = raw0.trim();
    if (!line) continue;
    let t = "", w = NaN;
    let m = /^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})[ T]+(\d{1,2}):(\d{2})(?::\d{2})?\s*(AM|PM|am|pm|오전|오후)?\s*[,\t; ]\s*(\d{2,3}(?:\.\d+)?)/.exec(line);
    if (m) {
      let h = Number(m[4]);
      const ap = (m[6] || "").toLowerCase();
      if ((ap === "pm" || ap === "오후") && h < 12) h += 12;
      if ((ap === "am" || ap === "오전") && h === 12) h = 0;
      t = m[1] + pad(Number(m[2])) + pad(Number(m[3])) + pad(h) + m[5]; w = Number(m[7]);
    } else {
      m = /^(\d{4})[\/.\-](\d{1,2})[\/.\-](\d{1,2})\s*[, \t]\s*(오전|오후|AM|PM|am|pm)\s*[, \t]\s*(\d{2,3}(?:\.\d+)?)/.exec(line);
      if (m) { const pmS = /오후|pm/i.test(m[4]); t = m[1] + pad(Number(m[2])) + pad(Number(m[3])) + (pmS ? "2000" : "0700"); w = Number(m[5]); }
    }
    if (!t) { if (/\d{4}[\/.\-]\d{1,2}/.test(line)) bad++; continue; }
    if (!isValidKg(w) || Number(t.slice(8, 10)) > 23 || Number(t.slice(10, 12)) > 59) { bad++; continue; }
    w = roundKg(w);
    items.push([t, w]);
    const cols = line.split(",");
    if (cols.length >= 5) { const meal = /^\s*O\s*$/i.test(cols[3]), ex = /^\s*O\s*$/i.test(cols[4]); if (meal || ex) { const dk = t.slice(0, 8); const c = stamps[dk] || { meal: false, ex: false }; stamps[dk] = { meal: c.meal || meal, ex: c.ex || ex }; } }
  }
  return { items, stamps, bad };
}
type PlanCfg = { on: boolean; start: string | null; w0: number | null; segs?: PlanSeg[] };
const PLAN_DEFAULT: PlanCfg = { on: true, start: null, w0: null, segs: DEFAULT_SEGS };
const roundPer = (n: number): number => Math.round(n * 1e4) / 1e4;
function planPoints(d0: number, w0: number, segs: PlanSeg[]): { pts: [number, number][]; at: Record<string, number> } {
  const stages: [number, number][] = [...segs].sort((a: PlanSeg, b: PlanSeg) => a.until - b.until).map((g: PlanSeg): [number, number] => [g.until, Math.max(0.1, g.per)]);
  const pts: [number, number][] = [[d0, w0]];
  const at: Record<string, number> = {};
  let d = d0, w = roundKg(w0);
  for (const [cap, per] of stages) {
    if (w < cap - 1e-9) { const steps = Math.round((cap - w) * 10); d = Math.round(d + steps * per); w = cap; pts.push([d, w]); }
    at[cap.toFixed(1)] = d;
  }
  pts.push([d + 3650, w]);
  return { pts, at };
}
const fmtPer = (n: number): string => String(Math.round(n * 100) / 100);
const fmtRate = (per: number): string => `하루 +${(0.1 / Math.max(0.1, per)).toFixed(2)}kg`;
const fmtWeek = (per: number): string => `주 +${(0.7 / Math.max(0.1, per)).toFixed(1)}kg`;
const textW = (t: string, fs: number): number => { let w = 0; for (const ch of t) w += /[\u3131-\uD79D]/.test(ch) ? fs * 0.98 : ch === " " ? fs * 0.3 : fs * 0.58; return w; };
const isoOfDk = (dk: string): string => `${dk.slice(0, 4)}-${dk.slice(4, 6)}-${dk.slice(6, 8)}`;
type PlanDraft = { start: string; w0: number; segs: PlanSeg[] };
type PlanVtx = { D: number; U: number; si: number };
// vertices of the plan line: start point, then each breakpoint where a segment reaches its 'until' (same math as planPoints)
function planVerts(c: PlanDraft): PlanVtx[] {
  const d0 = dayNum(c.start.replace(/-/g, ""));
  const order = c.segs.map((g: PlanSeg, i: number) => ({ g, i })).sort((a: { g: PlanSeg }, b: { g: PlanSeg }) => a.g.until - b.g.until);
  const vs: PlanVtx[] = [{ D: d0, U: roundKg(c.w0), si: -1 }];
  let d = d0, w = vs[0].U;
  for (const o of order) { if (w < o.g.until - 1e-9) { const steps = Math.round((o.g.until - w) * 10); d = Math.round(d + steps * Math.max(0.1, o.g.per)); w = o.g.until; vs.push({ D: d, U: w, si: o.i }); } }
  return vs;
}
// move vertex j to (day D, kg U); neighbours stay put, so the two adjacent segments get a new 'per'
function dragPlan(c: PlanDraft, j: number, D0: number, U0: number): PlanDraft {
  const vs = planVerts(c);
  if (j < 0 || j >= vs.length) return c;
  const prev = j > 0 ? vs[j - 1] : null, next = j + 1 < vs.length ? vs[j + 1] : null;
  let U = roundKg(U0), D = Math.round(D0);
  if (!prev) { const inact = c.segs.filter((g: PlanSeg) => g.until <= vs[0].U + 1e-9).reduce((m: number, g: PlanSeg) => Math.max(m, g.until), 30); U = Math.max(inact, U); }
  else U = Math.max(roundKg(prev.U + 0.1), U);
  U = Math.min(next ? roundKg(next.U - 0.1) : 250, U);
  let dmin = -Infinity, dmax = Infinity;
  if (prev) { const st = Math.round((U - prev.U) * 10); dmin = Math.max(dmin, prev.D + Math.max(1, Math.ceil(st * 0.1))); dmax = Math.min(dmax, prev.D + Math.floor(st * 99)); }
  if (next) { const st = Math.round((next.U - U) * 10); dmax = Math.min(dmax, next.D - Math.max(1, Math.ceil(st * 0.1))); dmin = Math.max(dmin, next.D - Math.floor(st * 99)); }
  if (dmin > dmax) return c;
  D = Math.max(dmin, Math.min(dmax, D));
  const nv = vs.map((v: PlanVtx) => ({ ...v }));
  nv[j] = { ...nv[j], D, U };
  const segs = c.segs.map((g: PlanSeg) => ({ ...g }));
  for (const k of [j, j + 1]) { if (k < 1 || k >= nv.length) continue; const a = nv[k - 1], b = nv[k]; const st = Math.round((b.U - a.U) * 10); segs[b.si] = { until: b.U, per: roundPer((b.D - a.D) / st) }; }
  return { start: j === 0 ? isoOfDk(numToDk(D)) : c.start, w0: j === 0 ? U : c.w0, segs };
}
const distToSeg = (px: number, py: number, ax: number, ay: number, bx: number, by: number): number => { const dx = bx - ax, dy = by - ay; const l2 = dx * dx + dy * dy; const t = l2 > 0 ? Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / l2)) : 0; return Math.hypot(px - (ax + t * dx), py - (ay + t * dy)); };
function PerField(p: { value: number; onChange: (v: number) => void; label: string; style: CSSProperties }) {
  const [txt, setTxt] = useState<string | null>(null);
  return <input type="text" inputMode="decimal" value={txt !== null ? txt : fmtPer(p.value)} onFocus={() => setTxt(fmtPer(p.value))} onBlur={() => setTxt(null)} onChange={(e: ChangeEvent<HTMLInputElement>) => { const t = e.target.value.replace(/[^0-9.]/g, "").replace(/(\..*)\./g, "$1").slice(0, 5); setTxt(t); const n = parseFloat(t); if (isValidPer(n)) p.onChange(roundPer(n)); }} aria-label={p.label} style={p.style} />;
}
function keyMapOf(es: Entry[]): Map<string, string> {
  const m = new Map<string, string>();
  [...es].sort((a: Entry, b: Entry) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.id - b.id)).forEach((e: Entry) => m.set(keyOfT(e.t), `${timeOfT(e.t)}|${roundKg(e.w)}`));
  return m;
}
function localRecs(es: Entry[], sr: { meta: Record<string, number>; tomb: Record<string, Rec> }): RecMap {
  const out: RecMap = {};
  Object.keys(sr.tomb).forEach((k: string) => { out[k] = { ...sr.tomb[k], del: true }; });
  keyMapOf(es).forEach((v: string, k: string) => { const [tm, w] = v.split("|"); out[k] = { w: Number(w), time: tm, u: sr.meta[k] || 0 }; });
  return out;
}
const SEG: Record<string, string> = { "0": "abcdef", "1": "bc", "2": "abged", "3": "abgcd", "4": "fgbc", "5": "afgcd", "6": "afgedc", "7": "abc", "8": "abcdefg", "9": "abcdfg", "-": "g" };
function Seg7(p: { text: string; h: number; color: string; ghost?: string }) {
  const h = p.h, w = h * 0.54, t = h * 0.13, g = t * 0.18, adv = w + t * 0.9, dotW = h * 0.26;
  const hz = (x0: number, x1: number, yc: number): string => `${x0},${yc} ${x0 + t / 2},${yc - t / 2} ${x1 - t / 2},${yc - t / 2} ${x1},${yc} ${x1 - t / 2},${yc + t / 2} ${x0 + t / 2},${yc + t / 2}`;
  const vt = (xc: number, y0: number, y1: number): string => `${xc},${y0} ${xc + t / 2},${y0 + t / 2} ${xc + t / 2},${y1 - t / 2} ${xc},${y1} ${xc - t / 2},${y1 - t / 2} ${xc - t / 2},${y0 + t / 2}`;
  const segPts = (s: string): string => s === "a" ? hz(t / 2 + g, w - t / 2 - g, t / 2) : s === "g" ? hz(t / 2 + g, w - t / 2 - g, h / 2) : s === "d" ? hz(t / 2 + g, w - t / 2 - g, h - t / 2)
    : s === "f" ? vt(t / 2, t / 2 + g, h / 2 - g) : s === "b" ? vt(w - t / 2, t / 2 + g, h / 2 - g) : s === "e" ? vt(t / 2, h / 2 + g, h - t / 2 - g) : vt(w - t / 2, h / 2 + g, h - t / 2 - g);
  const widthOf = (s: string): number => s.split("").reduce((a: number, ch: string) => a + (ch === "." || ch === "_" ? dotW : adv), 0);
  const draw = (s: string, color: string, all: boolean, off: number): ReactNode[] => {
    const out: ReactNode[] = []; let cx = off;
    s.split("").forEach((ch: string, i: number) => {
      if (ch === "_") { cx += dotW; return; } // blank dot-width gap (keeps integer digits aligned)
      if (ch === ".") { out.push(<rect key={"d" + i + color} x={cx + dotW * 0.1} y={h - t} width={t} height={t} fill={color} />); cx += dotW; return; }
      const on = all ? "abcdefg" : SEG[ch] || "";
      for (const sg of on) out.push(<polygon key={i + sg + color} points={segPts(sg)} transform={`translate(${cx},0)`} fill={color} />);
      cx += adv;
    });
    return out;
  };
  const tw = widthOf(p.text), gw = p.ghost ? widthOf(p.ghost) : 0, W = Math.max(tw, gw) + h * 0.12;
  return (
    <svg width={W} height={h} viewBox={`0 0 ${W} ${h}`} aria-hidden="true" style={{ display: "block", overflow: "visible" }}>
      <g transform={`skewX(-7) translate(${h * 0.1},0)`}>
        {p.ghost ? draw(p.ghost, "rgba(255,255,255,0.10)", true, W - h * 0.12 - gw) : null}
        {draw(p.text, p.color, false, W - h * 0.12 - tw)}
      </g>
    </svg>
  );
}
function IconTicket() { return <svg width="40" height="34" viewBox="0 0 40 34" aria-hidden="true"><rect x="3" y="4" width="24" height="18" rx="3" fill="#5b3a22" transform="rotate(-10 15 13)" /><path d="M10 10h26v6a3 3 0 0 0 0 6v6H10v-6a3 3 0 0 0 0-6z" fill="#8a5a33" /><path d="M29 11v16" stroke="#e9d3b8" strokeWidth="1.6" strokeDasharray="2 2" /></svg>; }
function IconTray() { return <svg width="40" height="34" viewBox="0 0 40 34" aria-hidden="true"><path d="M4 18l5-8h22l5 8v10a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2z" fill="#f6c21c" /><path d="M4 18h9l2 4h10l2-4h9" fill="none" stroke="#d99f00" strokeWidth="1.5" /><path d="M15 4v9m0-9l-3.5 3.5M15 4l3.5 3.5M25 13V4m0 9l-3.5-3.5M25 13l3.5-3.5" stroke="#3aa0e0" strokeWidth="2.2" strokeLinecap="round" fill="none" /></svg>; }
function IconGear() { const teeth = [0, 45, 90, 135, 180, 225, 270, 315]; return <svg width="40" height="34" viewBox="0 0 40 34" aria-hidden="true"><g transform="translate(20 17)">{teeth.map((a: number) => <rect key={a} x={-3} y={-15} width={6} height={7} rx={1.5} fill="#2f9be0" transform={`rotate(${a})`} />)}<circle r={10.5} fill="#2f9be0" /><circle r={4.5} fill="#ffffff" /></g></svg>; }
function IconChart() { return <svg width="40" height="34" viewBox="0 0 40 34" aria-hidden="true"><path d="M6 4v25h29" fill="none" stroke="#ee5f8c" strokeWidth="3" strokeLinecap="round" /><path d="M10 22l7-9 7 7 9-12" fill="none" stroke="#ee5f8c" strokeWidth="2.6" strokeLinejoin="round" /><circle cx="17" cy="13" r="2.6" fill="#7a4bd0" /><circle cx="24" cy="20" r="2.6" fill="#7a4bd0" /><circle cx="33" cy="8" r="2.6" fill="#7a4bd0" /></svg>; }
function IconClock() { return <svg width="40" height="34" viewBox="0 0 40 34" aria-hidden="true"><circle cx="20" cy="17" r="14" fill="#dff4f6" stroke="#3cb6c4" strokeWidth="4" /><path d="M20 9v8.5l5.5 3" stroke="#3cb6c4" strokeWidth="2.6" strokeLinecap="round" fill="none" /></svg>; }
// Keypad digits fill the integer part first: "7" = 7, "73" = 73kg, the 3rd digit is the decimal: "739" = 73.9kg (max 3 digits).
function typeDigits(v: string, key: string): string {
  if (key === "del") return v.slice(0, -1);
  if (!/^[0-9]+$/.test(key)) return v;
  let n = (v + key).replace(/^0+/, "");
  if (n.length > 3) n = v;
  return n;
}
function digitsToKg(d: string): number { return !d ? 0 : d.length <= 2 ? parseInt(d, 10) : parseInt(d, 10) / 10; }
const commitKg = digitsToKg;
// Live display: "7" -> "7", "73" -> "73", "739" -> "73.9".
function fmtDigits(d: string): string { return d.length <= 2 ? d : kg(digitsToKg(d)); }
function kgToDigits(w: number): string { const n = Math.round(w * 10); return n > 0 ? String(Math.min(n, 9999)) : ""; }
function loadStore(): Stored | null {
  return (readCached() as Stored | null) || null;
}

function WeightChart(p: { days: DayRec[]; ma: Map<number, number>; from: number; to: number; goal: number }) {
  const theme = useTheme();
  const c = theme.dataviz.categorical;
  const W = 700, H = 320, L = 40, R = 70, T = 14, B = 30;
  const shown = p.days.filter((d: DayRec) => d.n >= p.from && d.n <= p.to);
  const vals: number[] = [p.goal];
  shown.forEach((d: DayRec) => { if (d.am !== null) vals.push(d.am); if (d.pm !== null) vals.push(d.pm); });
  const lo = Math.floor(Math.min(...vals) - 0.3);
  const hi = Math.ceil(Math.max(...vals) + 0.3);
  const span = Math.max(1, p.to - p.from);
  const x = (n: number): number => L + ((n - p.from) / span) * (W - L - R);
  const y = (v: number): number => T + ((hi - v) / (hi - lo)) * (H - T - B);
  const step = hi - lo > 10 ? 2 : 1;
  const yt: number[] = [];
  for (let v = lo; v <= hi; v += step) yt.push(v);
  const xt: number[] = [];
  for (let i = 0; i <= 4; i++) xt.push(Math.round(p.from + (i * span) / 4));
  const long = span > 200;
  const xl = (n: number): string => { const dk = numToDk(n); return long ? `${dk.slice(2, 4)}.${Number(dk.slice(4, 6))}` : fmtShort(dk); };
  const nd = span + 1;
  const r = nd <= 10 ? 5 : nd <= 40 ? 4 : nd <= 100 ? 3 : 1.8;
  const maPts = shown.filter((d: DayRec) => d.am !== null && p.ma.has(d.n)).map((d: DayRec) => `${x(d.n).toFixed(1)},${y(p.ma.get(d.n) as number).toFixed(1)}`);
  const path = maPts.length > 1 ? "M" + maPts.join(" L") : "";
  const label: CSSProperties = { fontSize: 11, fill: theme.text.tertiary };
  return (
    <svg width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="체중 그래프" style={{ display: "block", fontFamily: theme.font.family }}>
      {yt.map((v: number) => (
        <g key={"y" + v}>
          <line x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={theme.border.subtle} strokeWidth={1} />
          <text x={L - 6} y={y(v) + 4} textAnchor="end" style={label}>{v}</text>
        </g>
      ))}
      {xt.map((n: number, i: number) => (
        <text key={"x" + i} x={x(n)} y={H - 8} textAnchor={i === 0 ? "start" : i === 4 ? "end" : "middle"} style={label}>{xl(n)}</text>
      ))}
      <line x1={L} x2={W - R} y1={y(p.goal)} y2={y(p.goal)} stroke={theme.dataviz.other} strokeWidth={1.5} strokeDasharray="5 4" />
      <text x={W - R + 6} y={y(p.goal) + 4} style={label}>목표 {kg(p.goal)}</text>
      {path ? <path d={path} fill="none" stroke={c[2]} strokeWidth={2} strokeLinejoin="round" /> : null}
      {shown.filter((d: DayRec) => d.pm !== null).map((d: DayRec) => (
        <circle key={"p" + d.n} cx={x(d.n)} cy={y(d.pm as number)} r={r} fill={c[1]} />
      ))}
      {shown.filter((d: DayRec) => d.am !== null).map((d: DayRec) => (
        <circle key={"a" + d.n} cx={x(d.n)} cy={y(d.am as number)} r={r} fill={theme.bg.base} stroke={c[0]} strokeWidth={1.5} />
      ))}
    </svg>
  );
}

type Reading = { x: number; w: number; am: boolean; lab?: string; id?: number };
let SAT_BG = "#ebf9ff";
let SUN_BG = "#ffeef3";
let SAT_TX = "#4cadda";
let SUN_TX = "#fa7a9f";
let WARN_C = "#ff5e5e";
const PLAN_C = "#22a05a";
let WARN_TX = "#ff3639";
let INK = "#706b66";
let GRID = "#b0adab";
let STRIPE = "#f9f9f9";
const AVG = "#fa7a9f";
let PLOT_BG = "#ffffff";
let BAND = "rgba(40,80,140,0.075)";
let VDAY = "#d9d6d3", VWEEK = "#b3afab", VMON = "#857f7a";
let BG = "#ffffff", PANEL = "#ffffff", SOFT = "#f2f2f2", CALL_BG = "#f5f8fd", CALL_BD = "#dbe6f7", HOLLOW = "#ffffff", BAR_TX = "#ffffff", DIV = "#e6e5e4", CS = "light";
const LIGHT: { bg: Record<string, string>; text: Record<string, string>; fill: Record<string, string>; border: Record<string, string> } = {
  bg: { base: "#ffffff", subtle: "#f7f7f7", elevated: "#ffffff" },
  text: { primary: "#1a1a1a", secondary: "#4a4a4a", tertiary: "#8a8a8a", onColor: "#ffffff", onPrimary: "#ffffff", accent: "#1d6fe0", success: "#1a7f37", warning: "#b25e00", danger: "#d1242f", accentDeep: "#0b4fb3", successDeep: "#116329", warningDeep: "#8a4600", dangerDeep: "#a40e26" },
  fill: { primary: "#1a1a1a", primaryHover: "#333333", secondary: "#f2f2f2", secondaryHover: "#e8e8e8", hover: "rgba(0,0,0,0.04)", pressed: "rgba(0,0,0,0.08)", accent: "#1d6fe0", controlChecked: "#1d6fe0", accentSubtle: "rgba(29,111,224,0.10)", successSubtle: "rgba(26,127,55,0.10)", warningSubtle: "rgba(178,94,0,0.10)", dangerSubtle: "rgba(209,36,47,0.10)" },
  border: { subtle: "#efefef", weak: "#e6e6e6", default: "#dddddd", strong: "#bbbbbb", focus: "#1d6fe0" },
};
const DARK: { bg: Record<string, string>; text: Record<string, string>; fill: Record<string, string>; border: Record<string, string> } = {
  bg: { base: "#1c1c1e", subtle: "#2c2c2e", elevated: "#2c2c2e" },
  text: { primary: "#f2f2f2", secondary: "#c7c7cc", tertiary: "#8e8e93", onColor: "#ffffff", onPrimary: "#1c1c1e", accent: "#4da3ff", success: "#30d158", warning: "#ffb340", danger: "#ff6961", accentDeep: "#4da3ff", successDeep: "#30d158", warningDeep: "#ffb340", dangerDeep: "#ff6961" },
  fill: { primary: "#f2f2f2", primaryHover: "#d1d1d6", secondary: "#2c2c2e", secondaryHover: "#3a3a3c", hover: "rgba(255,255,255,0.06)", pressed: "rgba(255,255,255,0.10)", accent: "#4da3ff", controlChecked: "#4da3ff", accentSubtle: "rgba(77,163,255,0.16)", successSubtle: "rgba(48,209,88,0.16)", warningSubtle: "rgba(255,179,64,0.16)", dangerSubtle: "rgba(255,105,97,0.16)" },
  border: { subtle: "#2c2c2e", weak: "#333336", default: "#3a3a3c", strong: "#545458", focus: "#4da3ff" },
};
let PAL = LIGHT;
function lightTheme<T extends { kind: string; bg: object; text: object; fill: object; border: object }>(t: T): T {
  return { ...t, bg: { ...t.bg, ...PAL.bg }, text: { ...t.text, ...PAL.text }, fill: { ...t.fill, ...PAL.fill }, border: { ...t.border, ...PAL.border } } as T;
}
function applyMode(m: string): void {
  const d = m === "dark";
  SAT_BG = d ? "#1d3242" : "#ebf9ff"; SUN_BG = d ? "#40252f" : "#ffeef3"; SAT_TX = d ? "#6cb8e6" : "#4cadda"; SUN_TX = "#fa7a9f";
  WARN_C = "#ff5e5e"; WARN_TX = d ? "#ff6b6e" : "#ff3639";
  INK = d ? "#d6d3d0" : "#706b66"; GRID = d ? "#4a4744" : "#b0adab"; STRIPE = d ? "#2c2c30" : "#ececec"; PLOT_BG = d ? "#1c1c1e" : "#ffffff";
  BG = PLOT_BG; PANEL = d ? "#2c2c2e" : "#ffffff"; SOFT = d ? "#3a3a3c" : "#f2f2f2"; CALL_BG = d ? "#1f2733" : "#f5f8fd"; CALL_BD = d ? "#34445a" : "#dbe6f7";
  BAND = d ? "rgba(255,255,255,0.07)" : "rgba(40,80,140,0.075)"; VDAY = d ? "#3a3a3c" : "#d9d6d3"; VWEEK = d ? "#5a5a5f" : "#b3afab"; VMON = d ? "#8a8a90" : "#857f7a"; HOLLOW = d ? "#1c1c1e" : "#ffffff"; BAR_TX = d ? "#1c1c1e" : "#ffffff"; DIV = d ? "#3a3a3c" : "#e6e5e4"; CS = d ? "dark" : "light";
  C.ink = d ? "#f2f2f2" : "#1a1a1a"; C.sub = d ? "#d1d1d6" : "#4a4a4a"; C.muted = d ? "#a1a1a6" : "#6e6e73"; C.border = d ? "#48484a" : "#d4d4d4"; C.line = d ? "#3a3a3c" : "#eeeeee";
  TONE.success = d ? "#30d158" : "#1a7f37"; TONE.warning = d ? "#ffb340" : "#b25e00"; TONE.danger = d ? "#ff6961" : "#d1242f";
  PAL = d ? DARK : LIGHT;
  paintDoc();
}
function paintDoc(): void {
  try {
    if (typeof document === "undefined") return;
    const root = document.documentElement, body = document.body;
    root.style.setProperty("background-color", BG, "important");
    root.style.setProperty("color-scheme", CS, "important");
    root.style.setProperty("color", C.ink);
    if (body) { body.style.setProperty("background-color", BG, "important"); body.style.setProperty("color", C.ink, "important"); body.style.setProperty("color-scheme", CS, "important"); }
    let st = document.getElementById("sd-theme") as HTMLStyleElement | null;
    if (!st) { st = document.createElement("style"); st.id = "sd-theme"; document.head.appendChild(st); }
    st.textContent = `html,body{background:${BG}!important;color:${C.ink};color-scheme:${CS}!important}#root,body>div{background:${BG}}input,textarea,select{color-scheme:${CS};color:${C.ink}}input::placeholder,textarea::placeholder{color:${C.muted}}input[type=date]::-webkit-date-and-time-value{color:${C.ink};text-align:left}input[type=date]::-webkit-calendar-picker-indicator{filter:${CS === "dark" ? "invert(1)" : "none"}}`;
    const rootEl = document.querySelector("[data-sd-root]") as HTMLElement | null;
    let anc: HTMLElement | null = rootEl ? rootEl.parentElement : null;
    while (anc) {
      anc.style.setProperty("background-color", BG, "important");
      anc.style.setProperty("color-scheme", CS, "important");
      anc = anc.parentElement;
    }
  } catch (_e) { /* host may block style changes */ }
}
type GSlot = "both" | "am" | "pm";
const GSLOT_KEY = "my-simple-diet-graph-slot";
function loadGSlot(): GSlot {
  try { const v = window.localStorage.getItem(GSLOT_KEY); if (v === "am" || v === "pm" || v === "both") return v; } catch (_e) { /* blocked */ }
  return "both";
}
function saveGSlot(v: GSlot): void { try { window.localStorage.setItem(GSLOT_KEY, v); } catch (_e) { /* blocked */ } }
const MODE_KEY = "my-simple-diet-mode";
function loadMode(): string | null {
  for (const get of [() => window.localStorage.getItem(MODE_KEY), () => window.sessionStorage.getItem(MODE_KEY)]) {
    try { const v = get(); if (v === "dark" || v === "light") return v; } catch (_e) { /* blocked */ }
  }
  try { const s = loadStore(); if (s && (s.mode === "dark" || s.mode === "light")) return s.mode; } catch (_e) { /* blocked */ }
  return null;
}
function saveMode(m: string): void {
  try { window.localStorage.setItem(MODE_KEY, m); } catch (_e) { /* blocked */ }
  try { window.sessionStorage.setItem(MODE_KEY, m); } catch (_e) { /* blocked */ }
}

const C = { ink: "#1a1a1a", sub: "#4a4a4a", muted: "#8a8a8a", border: "#dddddd", line: "#eeeeee" };
type MetricT = { value: string; label: string; detail?: string; tone?: string };
const TONE: Record<string, string> = { success: "#1a7f37", warning: "#b25e00", danger: "#d1242f" };

function KgField(p: { value: number | null; onChange: (v: number | null) => void; label: string; placeholder?: string; style: CSSProperties; allowEmpty?: boolean }) {
  const [d, setD] = useState<string>(p.value !== null ? kgToDigits(p.value) : "");
  useEffect(() => { const cur = d ? digitsToKg(d) : null; if (p.value !== cur && !(p.value === null && !d)) setD(p.value !== null ? kgToDigits(p.value) : ""); }, [p.value]);
  const w = d ? digitsToKg(d) : null;
  const bad = d !== "" && !(w !== null && w >= 20 && w <= 300);
  return <input type="text" inputMode="numeric" value={d ? fmtDigits(d) : ""} placeholder={p.placeholder} aria-label={p.label} onChange={(e: ChangeEvent<HTMLInputElement>) => { const nd = e.target.value.replace(/[^0-9]/g, "").replace(/^0+/, "").slice(0, 3); setD(nd); const nw = nd ? digitsToKg(nd) : null; if (nw === null ? p.allowEmpty : nw >= 20 && nw <= 300) p.onChange(nw); }} style={{ ...p.style, borderColor: bad ? TONE.danger : (p.style.borderColor as string | undefined) }} />;
}
const ANIM_CSS = "@keyframes sdIn{from{transform:translate3d(30%,0,0);opacity:.35}to{transform:none;opacity:1}}@keyframes sdBack{from{transform:translate3d(-30%,0,0);opacity:.35}to{transform:none;opacity:1}}.sd-in{animation:sdIn 300ms cubic-bezier(.2,.8,.2,1) both}.sd-back{animation:sdBack 300ms cubic-bezier(.2,.8,.2,1) both}@keyframes sdPulse{0%{transform:scale(1);opacity:.95}100%{transform:scale(3.2);opacity:0}}.sd-pulse{transform-box:fill-box;transform-origin:center;animation:sdPulse 900ms ease-out 300ms 3 both}@media (prefers-reduced-motion:reduce){.sd-in,.sd-back{animation:none}.sd-pulse{animation:none;opacity:.6}}";
const KEY_CSS = ".sd-key{-webkit-tap-highlight-color:transparent;touch-action:manipulation;transition:transform 120ms ease,filter 120ms ease}.sd-key.pressed{transform:scale(0.92);filter:brightness(0.86);transition:none}";
function KeyPadBtn(p: { style: CSSProperties; onClick: () => void; label: string; children: ReactNode }): ReactNode {
  const ref = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const down = (): void => {
      el.classList.add("pressed");
      try { navigator.vibrate?.(10); } catch (_e) { /* ignore */ }
    };
    const up = (): void => { el.classList.remove("pressed"); };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("pointerleave", up);
    return () => {
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("pointerleave", up);
    };
  }, []);
  return (
    <button ref={ref} type="button" className="sd-key" style={p.style} aria-label={p.label} onClick={p.onClick}>{p.children}</button>
  );
}
function Page(p: { title: string; lang?: string; width?: string; fill?: boolean; animKey?: number; anim?: string; children?: ReactNode }) {
  const theme = useTheme();
  const [fh, setFh] = useState<number>(600);
  useEffect(() => {
    const calc = (): void => {
      const ih = window.innerHeight || 700;
      const vv = window.visualViewport ? window.visualViewport.height : ih;
      const sh = (window.screen && window.screen.height) || ih;
      const h = Math.round(Math.max(320, Math.min(ih, vv || ih))); void sh;
      setFh((old: number) => (Math.abs(old - h) > 1 ? h : old));
    };
    calc();
    window.addEventListener("resize", calc);
    const de = document.documentElement, bd = document.body;
    const prev = [de.style.overflow, bd.style.overflow, bd.style.margin, de.style.overscrollBehavior];
    de.style.overflow = "hidden"; bd.style.overflow = "hidden"; bd.style.margin = "0"; de.style.overscrollBehavior = "none";
    window.scrollTo(0, 0);
    return () => {
      window.removeEventListener("resize", calc);
      de.style.overflow = prev[0]; bd.style.overflow = prev[1]; bd.style.margin = prev[2]; de.style.overscrollBehavior = prev[3];
    };
  }, []);
  const base: CSSProperties = { background: BG, color: C.ink, fontFamily: theme.font.family, boxSizing: "border-box", width: "100%" };
  return (
    <div data-sd-root="1" lang={p.lang} aria-label={p.title} style={{ colorScheme: CS,  ...base, height: fh, overflow: "hidden", display: "flex", flexDirection: "column", padding: p.fill ? "calc(6px + env(safe-area-inset-top)) calc(6px + env(safe-area-inset-right)) calc(4px + env(safe-area-inset-bottom)) calc(6px + env(safe-area-inset-left))" : "calc(8px + env(safe-area-inset-top)) calc(10px + env(safe-area-inset-right)) calc(6px + env(safe-area-inset-bottom)) calc(10px + env(safe-area-inset-left))", overscrollBehavior: "none" }}>
      <style>{ANIM_CSS + KEY_CSS}</style>
      <div key={p.animKey} className={p.anim === "back" ? "sd-back" : p.anim === "fwd" ? "sd-in" : undefined} style={{ maxWidth: p.fill ? undefined : 700, margin: "0 auto", width: "100%", flex: "1 1 0", minHeight: 0, display: "flex", flexDirection: "column", gap: 10, willChange: p.anim ? "transform, opacity" : undefined }}>
        {p.children}
      </div>
    </div>
  );
}
function Section(p: { heading?: string; id?: string; caption?: string; fixed?: boolean; children?: ReactNode }) {
  return (
    <section id={p.id} style={{ display: "flex", flexDirection: "column", gap: 8, flex: p.fixed ? "0 0 auto" : "1 1 0", minHeight: 0 }}>
      {p.heading ? <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0, color: C.ink, flex: "0 0 auto" }}>{p.heading}</h2> : null}
      {p.caption ? <p style={{ margin: 0, fontSize: 12, color: C.muted, flex: "0 0 auto" }}>{p.caption}</p> : null}
      <div style={{ flex: p.fixed ? "0 0 auto" : "1 1 0", minHeight: 0, overflowY: p.fixed ? "visible" : "auto", overscrollBehavior: "contain", display: "flex", flexDirection: "column", gap: 10 }}>
        {p.children}
      </div>
    </section>
  );
}
function Text(p: { children?: ReactNode }) {
  return <p style={{ margin: 0, fontSize: 14, lineHeight: 1.5, color: C.sub }}>{p.children}</p>;
}
function Button(p: { label: string; onClick: () => void; variant?: string; disabled?: boolean }) {
  const pri = p.variant === "primary";
  return <button onClick={p.onClick} disabled={p.disabled} style={{ minHeight: 44, padding: "0 18px", borderRadius: 10, fontSize: 15, fontWeight: 600, cursor: "pointer", fontFamily: "inherit", background: pri ? C.ink : SOFT, color: pri ? BG : C.ink, border: `1px solid ${pri ? C.ink : C.border}` }}>{p.label}</button>;
}
function Input(p: { label?: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: "text" | "number" }) {
  return (
    <label style={{ display: "flex", flexDirection: "column", gap: 6, fontSize: 13, color: C.sub }}>
      {p.label}
      <input type={p.type || "text"} inputMode={p.type === "number" ? "decimal" : undefined} value={p.value} placeholder={p.placeholder} onChange={(e: ChangeEvent<HTMLInputElement>) => p.onChange(e.target.value)} style={{ font: "inherit", fontSize: 16, padding: "10px 12px", borderRadius: 8, border: `1px solid ${C.border}`, background: PANEL, color: C.ink, colorScheme: CS }} />
    </label>
  );
}
function Metrics(p: { metrics: MetricT[] }) {
  return (
    <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(105px, 1fr))", gap: 8 }}>
      {p.metrics.map((m: MetricT, i: number) => (
        <div key={i} style={{ border: `1px solid ${C.border}`, borderRadius: 10, padding: "8px 10px", background: PANEL, display: "flex", flexDirection: "column", gap: 2 }}>
          <span style={{ fontSize: 12, color: C.muted }}>{m.label}</span>
          <span style={{ fontSize: 20, fontWeight: 700, color: C.ink }}>{m.value}</span>
          {m.detail ? <span style={{ fontSize: 11, color: m.tone && TONE[m.tone] ? TONE[m.tone] : C.muted }}>{m.detail}</span> : null}
        </div>
      ))}
    </div>
  );
}
function Callout(p: { lead?: string; tone?: string; children?: ReactNode }) {
  return (
    <div style={{ background: CALL_BG, border: `1px solid ${CALL_BD}`, borderRadius: 10, padding: 12, display: "flex", flexDirection: "column", gap: 4 }}>
      {p.lead ? <strong style={{ fontSize: 14, color: C.ink }}>{p.lead}</strong> : null}
      <div style={{ fontSize: 14, lineHeight: 1.5, color: C.sub }}>{p.children}</div>
    </div>
  );
}
function Table(p: { columns: string[]; rows: ReactNode[][]; align?: string[]; emphasis?: number }) {
  const al = (i: number): "left" | "right" => (p.align && p.align[i] === "end" ? "right" : "left");
  return (
    <div style={{ overflowX: "auto" }}>
      <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 15, color: C.ink }}>
        <thead><tr>{p.columns.map((c: string, i: number) => <th key={i} style={{ textAlign: al(i), fontSize: 13, fontWeight: 600, color: C.muted, padding: "8px 6px", borderBottom: `1px solid ${C.border}` }}>{c}</th>)}</tr></thead>
        <tbody>{p.rows.map((r: ReactNode[], ri: number) => <tr key={ri}>{r.map((c: ReactNode, i: number) => <td key={i} style={{ textAlign: al(i), padding: "9px 6px", borderBottom: `1px solid ${C.line}`, fontVariantNumeric: "tabular-nums" }}>{c}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

function GraphView(p: { readings: Reading[]; slot?: GSlot; onSlot?: (v: GSlot) => void; series?: Reading[][]; bucket?: string; note?: string; ma: Map<number, number>; showMa: boolean; goal: number; end: number; span: number; todayN: number; onView: (end: number, span: number) => void; onEdit?: (id: number) => void; onDelete?: (id: number) => void; plan?: [number, number][]; planCfg?: PlanDraft | null; onPlanCommit?: (c: PlanDraft) => void; pulse?: { x: number; w: number; at: number } | null }) {
  const theme = lightTheme(useTheme());
  const wrapRef = useRef<HTMLDivElement>(null);
  const svgRef = useRef<SVGSVGElement>(null);
  const [size, setSize] = useState<{ w: number; h: number }>({ w: 360, h: 520 });
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const measure = (): void => {
      const w = Math.max(260, Math.floor(el.clientWidth));
      const h = Math.max(220, Math.floor(el.clientHeight));
      setSize((o: { w: number; h: number }) => (o.w === w && o.h === h ? o : { w, h }));
    };
    measure();
    let ro: ResizeObserver | null = null;
    try { ro = new ResizeObserver(() => measure()); ro.observe(el); } catch (_e) { ro = null; }
    window.addEventListener("resize", measure);
    return () => { if (ro) ro.disconnect(); window.removeEventListener("resize", measure); };
  }, []);

  const W = size.w, H = size.h, L = 34, R = 2, T = 6, B = 62;
  const plotW = W - L - R, plotH = H - T - B;
  const start = p.end - p.span;
  const [tip, setTip] = useState<Reading | null>(null);
  const [hold, setHold] = useState<Reading | null>(null);
  const [holdDel, setHoldDel] = useState<boolean>(false);
  const isAvgMode = !!(p.series && p.series.length);
  // plan-line drag edit
  const [pe, setPe] = useState<boolean>(false);
  const [draft, setDraft] = useState<{ c: PlanDraft; j: number } | null>(null);
  const [undo, setUndo] = useState<PlanDraft[]>([]);
  const freeze = useRef<{ lo: number; hi: number; ystep: number } | null>(null);
  const canPlan = !!(p.planCfg && p.onPlanCommit && p.plan && p.plan.length > 1);
  const editing = pe && canPlan;
  const exitPe = (): void => { setPe(false); setDraft(null); setUndo([]); freeze.current = null; };
  type Live = { end: number; span: number; L: number; plotW: number; W: number; H: number; onView: (e: number, s: number) => void; pts: { cx: number; cy: number; r: Reading }[]; setTip: (r: Reading | null) => void; setHold: (r: Reading | null) => void; canHold: boolean;
    canPlan: boolean; editing: boolean; cfg: PlanDraft | null; planPx: [number, number][]; handles: { cx: number; cy: number; j: number }[]; inv: { start: number; span: number; L: number; plotW: number; T: number; plotH: number; lo: number; hi: number }; scale: { lo: number; hi: number; ystep: number };
    enterPe: () => void; exitPe: () => void; dragStart: (j: number) => void; dragMove: (c: PlanDraft, j: number) => void; dragEnd: (base: PlanDraft, last: PlanDraft | null, ok: boolean) => void };
  const live = useRef<Live>({ end: p.end, span: p.span, L, plotW, W, H, onView: p.onView, pts: [], setTip, setHold, canHold: false, canPlan: false, editing: false, cfg: null, planPx: [], handles: [], inv: { start: 0, span: 1, L, plotW, T, plotH, lo: 0, hi: 1 }, scale: { lo: 0, hi: 1, ystep: 1 }, enterPe: () => undefined, exitPe: () => undefined, dragStart: () => undefined, dragMove: () => undefined, dragEnd: () => undefined });
  live.current = { ...live.current, end: p.end, span: p.span, L, plotW, W, H, onView: p.onView, setTip, setHold: (r: Reading | null) => { setHold(r); setHoldDel(false); }, canHold: !isAvgMode && !!p.onEdit,
    canPlan, editing, cfg: p.planCfg || null,
    enterPe: () => { setPe(true); setTip(null); setHold(null); try { if (navigator.vibrate) navigator.vibrate(20); } catch (_e) { /* ignore */ } },
    exitPe,
    dragStart: (j: number) => { freeze.current = { ...live.current.scale }; setTip(null); setHold(null); if (p.planCfg) setDraft({ c: p.planCfg, j }); },
    dragMove: (c: PlanDraft, j: number) => setDraft({ c, j }),
    dragEnd: (base: PlanDraft, last: PlanDraft | null, ok: boolean) => {
      freeze.current = null; setDraft(null);
      if (ok && last && JSON.stringify(last) !== JSON.stringify(base) && p.onPlanCommit) { setUndo((u: PlanDraft[]) => [...u, base].slice(-30)); p.onPlanCommit(last); }
    } };
  useEffect(() => { if (pe && !canPlan) exitPe(); }, [pe, canPlan]);

  useEffect(() => {
    const el = svgRef.current;
    if (!el) return;
    const ptrs = new Map<number, number>();
    let g: { end0: number; span0: number; d0: number; m0: number } | null = null;
    const sx = (cx: number): number => { const r = el.getBoundingClientRect(); return (cx - r.left) * (live.current.W / Math.max(1, r.width)); };
    const begin = (): void => {
      const xs = Array.from(ptrs.values());
      g = xs.length ? { end0: live.current.end, span0: live.current.span, d0: xs.length >= 2 ? Math.max(10, Math.abs(xs[0] - xs[1])) : 0, m0: xs.length >= 2 ? (xs[0] + xs[1]) / 2 : xs[0] } : null;
    };
    const apply = (px0: number, end0: number, span0: number, ns: number, px: number): void => {
      const c = live.current;
      c.setHold(null);
      const anchorDay = end0 - span0 + ((px0 - c.L) / c.plotW) * span0;
      const frac = (px - c.L) / c.plotW;
      c.onView(anchorDay + (1 - frac) * ns, ns);
    };
    let tap: { id: number; x: number; y: number; t: number; ok: boolean; held: boolean } | null = null;
    let drag: { id: number; j: number; base: PlanDraft; offX: number; offY: number; last: PlanDraft | null } | null = null;
    const toSvg = (cx0: number, cy0: number): { x: number; y: number; k: number } => { const rc = el.getBoundingClientRect(); const kx = live.current.W / Math.max(1, rc.width), ky = live.current.H / Math.max(1, rc.height); return { x: (cx0 - rc.left) * kx, y: (cy0 - rc.top) * ky, k: kx }; };
    const hitHandle = (cx0: number, cy0: number): { cx: number; cy: number; j: number } | null => {
      const q = toSvg(cx0, cy0); let best: { cx: number; cy: number; j: number } | null = null, bd = Infinity;
      for (const h of live.current.handles) { const d = Math.hypot(h.cx - q.x, h.cy - q.y); if (d < bd) { bd = d; best = h; } }
      return best && bd <= 26 * q.k ? best : null;
    };
    const nearPlan = (cx0: number, cy0: number): boolean => {
      const q = toSvg(cx0, cy0); const ps = live.current.planPx;
      for (let i = 1; i < ps.length; i++) if (distToSeg(q.x, q.y, ps[i - 1][0], ps[i - 1][1], ps[i][0], ps[i][1]) <= 20 * q.k) return true;
      return false;
    };
    const startDrag = (id: number, h: { cx: number; cy: number; j: number }, cx0: number, cy0: number): void => {
      const c = live.current; if (!c.cfg) return;
      const q = toSvg(cx0, cy0);
      drag = { id, j: h.j, base: c.cfg, offX: h.cx - q.x, offY: h.cy - q.y, last: null };
      c.dragStart(h.j);
      try { if (navigator.vibrate) navigator.vibrate(10); } catch (_e) { /* ignore */ }
    };
    let holdTimer: number | null = null;
    const clearHold = (): void => { if (holdTimer !== null) { window.clearTimeout(holdTimer); holdTimer = null; } };
    const nearest = (cx0: number, cy0: number): Reading | null => {
      const rc = el.getBoundingClientRect();
      const c = live.current;
      const kx = c.W / Math.max(1, rc.width), ky = c.H / Math.max(1, rc.height);
      const px = (cx0 - rc.left) * kx, py = (cy0 - rc.top) * ky;
      let best: Reading | null = null, bd = Infinity;
      for (const q of c.pts) { const d = Math.hypot(q.cx - px, q.cy - py); if (d < bd) { bd = d; best = q.r; } }
      return best && bd <= 22 * kx ? best : null;
    };
    const down = (e: PointerEvent): void => {
      try { el.setPointerCapture(e.pointerId); } catch (_e) { g = g; }
      if (drag) return; // one handle at a time; other fingers ignored while dragging
      if (live.current.editing && ptrs.size === 0) {
        const h = hitHandle(e.clientX, e.clientY);
        if (h) { clearHold(); tap = null; startDrag(e.pointerId, h, e.clientX, e.clientY); return; }
      }
      ptrs.set(e.pointerId, sx(e.clientX));
      tap = ptrs.size === 1 ? { id: e.pointerId, x: e.clientX, y: e.clientY, t: Date.now(), ok: true, held: false } : null;
      clearHold();
      if (tap && (live.current.canHold || live.current.canPlan)) {
        const t1 = tap;
        holdTimer = window.setTimeout(() => {
          holdTimer = null;
          if (tap !== t1 || !t1.ok || ptrs.size !== 1) return;
          const c = live.current;
          const r = c.canHold ? nearest(t1.x, t1.y) : null; // data points win over the plan line
          if (r && r.id !== undefined) { t1.held = true; c.setTip(null); c.setHold(r); try { if (navigator.vibrate) navigator.vibrate(15); } catch (_e) { /* ignore */ } }
          else if (c.canPlan && !c.editing && nearPlan(t1.x, t1.y)) {
            t1.held = true; c.enterPe();
            const h = hitHandle(t1.x, t1.y);
            if (h) startDrag(t1.id, h, t1.x, t1.y);
          }
        }, 500);
      }
      begin();
    };
    const move = (e: PointerEvent): void => {
      if (drag) {
        if (e.pointerId !== drag.id) return;
        const c = live.current, iv = c.inv;
        const q = toSvg(e.clientX, e.clientY);
        const px = q.x + drag.offX, py = q.y + drag.offY;
        const day = iv.start + ((px - iv.L) / iv.plotW) * iv.span - 0.5;
        const w = iv.hi - ((py - iv.T) / iv.plotH) * (iv.hi - iv.lo);
        const nc = dragPlan(drag.base, drag.j, day, w);
        drag.last = nc; c.dragMove(nc, drag.j);
        return;
      }
      if (tap && tap.id === e.pointerId && Math.hypot(e.clientX - tap.x, e.clientY - tap.y) > 8) { if (!tap.held) { tap.ok = false; clearHold(); } }
      if (tap && tap.held) return;
      if (!ptrs.has(e.pointerId) || !g) return;
      if (tap && tap.ok) return;
      ptrs.set(e.pointerId, sx(e.clientX));
      const xs = Array.from(ptrs.values());
      if (xs.length >= 2 && g.d0 > 0) {
        const d = Math.max(10, Math.abs(xs[0] - xs[1]));
        apply(g.m0, g.end0, g.span0, (g.span0 * g.d0) / d, (xs[0] + xs[1]) / 2);
      } else if (xs.length === 1) apply(g.m0, g.end0, g.span0, g.span0, xs[0]);
    };
    const up = (e: PointerEvent): void => {
      if (drag) {
        if (e.pointerId !== drag.id) return;
        const d = drag; drag = null;
        ptrs.delete(e.pointerId); if (tap && tap.id === e.pointerId) tap = null; begin(); clearHold();
        live.current.dragEnd(d.base, d.last, e.type === "pointerup");
        return;
      }
      clearHold();
      const wasTap = e.type === "pointerup" && tap !== null && tap.id === e.pointerId && tap.ok && !tap.held && ptrs.size === 1 && Date.now() - tap.t < 600;
      ptrs.delete(e.pointerId); begin();
      if (tap && tap.id === e.pointerId) {
        const t0 = tap; tap = null;
        if (wasTap && live.current.editing) { if (!nearPlan(t0.x, t0.y)) live.current.exitPe(); }
        else if (wasTap) { live.current.setHold(null); live.current.setTip(nearest(t0.x, t0.y)); }
      }
    };
    const wheel = (e: WheelEvent): void => {
      e.preventDefault();
      live.current.setHold(null);
      const c = live.current;
      const px = sx(e.clientX);
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY) && !e.ctrlKey) apply(px, c.end, c.span, c.span, px - e.deltaX);
      else apply(px, c.end, c.span, c.span * Math.exp(e.deltaY * 0.002), px);
    };
    el.addEventListener("pointerdown", down);
    el.addEventListener("pointermove", move);
    el.addEventListener("pointerup", up);
    el.addEventListener("pointercancel", up);
    el.addEventListener("wheel", wheel, { passive: false });
    const ctx = (e: Event): void => { e.preventDefault(); };
    el.addEventListener("contextmenu", ctx);
    return () => {
      clearHold();
      el.removeEventListener("contextmenu", ctx);
      el.removeEventListener("pointerdown", down);
      el.removeEventListener("pointermove", move);
      el.removeEventListener("pointerup", up);
      el.removeEventListener("pointercancel", up);
      el.removeEventListener("wheel", wheel);
    };
  }, []);

  const x = (d: number): number => L + ((d - start) / p.span) * plotW;
  const sets = (p.series && p.series.length ? p.series : [p.readings]).map((rs: Reading[]) => {
    let a = rs.findIndex((r: Reading) => r.x >= start);
    if (a < 0) a = rs.length;
    let b = a;
    while (b < rs.length && rs[b].x <= p.end) b++;
    return { vis: rs.slice(a, b), line: rs.slice(Math.max(0, a - 1), Math.min(rs.length, b + 1)) };
  });
  const vis: Reading[] = ([] as Reading[]).concat(...sets.map((s: { vis: Reading[]; line: Reading[] }) => s.vis));
  const maPts: [number, number][] = [];
  for (let n = Math.floor(start) - 1; n <= Math.ceil(p.end); n++) { const v = p.ma.get(n); if (v !== undefined) maPts.push([n + 0.29, v]); }
  let mn = Infinity, mx = -Infinity;
  vis.forEach((r: Reading) => { mn = Math.min(mn, r.w); mx = Math.max(mx, r.w); });
  if (p.showMa) maPts.forEach((q: [number, number]) => { if (q[0] >= start && q[0] <= p.end) { mn = Math.min(mn, q[1]); mx = Math.max(mx, q[1]); } });
  if (!isFinite(mn)) { const lastR = p.readings.length ? p.readings[p.readings.length - 1].w : p.goal; mn = lastR; mx = lastR; }
  const planPts: [number, number][] = draft ? planPoints(dayNum(draft.c.start.replace(/-/g, "")), draft.c.w0, draft.c.segs).pts : p.plan || [];
  const planAt = (n: number): number | null => { for (let i = 1; i < planPts.length; i++) { const a = planPts[i - 1], b = planPts[i]; if (n >= a[0] && n <= b[0]) return a[1] + ((b[1] - a[1]) * (n - a[0])) / Math.max(1e-9, b[0] - a[0]); } return null; };
  if (planPts.length && isFinite(mn)) { [start, p.end].forEach((n: number) => { const v = planAt(n); if (v !== null) { mn = Math.min(mn, v); mx = Math.max(mx, v); } }); planPts.forEach((q: [number, number]) => { if (q[0] >= start && q[0] <= p.end) { mn = Math.min(mn, q[1]); mx = Math.max(mx, q[1]); } }); }
  if (mn - p.goal <= 1.5) mn = Math.min(mn, p.goal);
  let lo = Math.floor(mn - 0.6), hi = Math.ceil(mx + 0.6);
  if (hi - lo < 3) { const mid = (hi + lo) / 2; lo = Math.floor(mid - 1.5); hi = lo + 3; }
  const y = (v: number): number => T + ((hi - v) / (hi - lo)) * plotH;
  const pxPerKg = plotH / Math.max(1, hi - lo);
  let ystep = pxPerKg > 150 ? 0.5 : hi - lo > 30 ? 5 : hi - lo > 14 ? 2 : 1;
  if (ystep > 1) { lo = Math.floor(lo / ystep) * ystep; hi = Math.ceil(hi / ystep) * ystep; }
  if (freeze.current) { lo = freeze.current.lo; hi = freeze.current.hi; ystep = freeze.current.ystep; } // keep the y-axis still while a handle is dragged
  live.current.scale = { lo, hi, ystep };
  live.current.inv = { start, span: p.span, L, plotW, T, plotH, lo, hi };
  const yt: number[] = [];
  for (let v = lo; v <= hi + 1e-9; v += ystep) yt.push(roundKg(v));

  const colW = plotW / p.span;
  const showCols = colW >= 2.8;
  const k = colW >= 14 ? 1 : colW >= 7 ? 2 : 5;
  const cols: number[] = [];
  if (showCols) for (let n = Math.floor(start); n < Math.ceil(p.end); n++) cols.push(n);
  const dayFont = Math.max(10, Math.min(15, colW * k * 0.6));
  const isAvg = !!(p.series && p.series.length);
  const rr = isAvg ? 6.5 : colW >= 8 ? Math.max(4.5, Math.min(6, colW * 0.4)) : Math.max(1.6, colW * 0.5);
  // zoom-dependent styling: dots shrink then fade out and lines thin as days get narrow (close zoom unchanged)
  const smooth = (v: number, a: number, b: number): number => { const t = Math.max(0, Math.min(1, (v - a) / (b - a))); return t * t * (3 - 2 * t); };
  const bucketPx = colW * (p.bucket === "7" ? 7 : p.bucket === "30" ? 30.4 : p.bucket === "90" ? 91 : 1);
  const dotT = isAvg ? smooth(bucketPx, 8, 14) : smooth(colW, 8.5, 11);
  const lineT = isAvg ? smooth(bucketPx, 3, 14) : smooth(colW, 1.5, 11);
  const dotR = rr * (0.55 + 0.45 * dotT), dotOp = Math.min(1, dotT * 2), showDots = dotT > 0.01;
  const lineW = 1.25 + 1.75 * lineT, refW = 1.4 + 0.6 * lineT;
  const ringR = Math.max(showDots ? dotR : 0, 4.5);
  const showMarks = true;

  const cy = Number(numToDk(p.todayN).slice(0, 4));
  const yearMode = p.span > 400;
  const segs: { a: number; b: number; label: string }[] = [];
  const sdk = numToDk(Math.floor(start));
  let yy = Number(sdk.slice(0, 4)), mm = yearMode ? 1 : Number(sdk.slice(4, 6));
  while (segs.length < 400) {
    const a = Math.round(Date.UTC(yy, mm - 1, 1) / 864e5);
    if (a >= p.end) break;
    const ny = yearMode || mm === 12 ? yy + 1 : yy;
    const nm = yearMode || mm === 12 ? 1 : mm + 1;
    const b = Math.round(Date.UTC(ny, nm - 1, 1) / 864e5);
    segs.push({ a: Math.max(a, start), b: Math.min(b, p.end), label: yearMode ? `${yy}년` : yy === cy ? `${mm}월` : `${String(yy).slice(2)}년 ${mm}월` });
    yy = ny; mm = nm;
  }
  const ink = INK;
  const linePaths: string[] = sets.map((s: { vis: Reading[]; line: Reading[] }) => (s.line.length > 1 ? "M" + s.line.map((r: Reading) => `${x(r.x).toFixed(1)},${y(r.w).toFixed(1)}`).join(" L") : ""));
  const maPath = p.showMa && maPts.length > 1 ? "M" + maPts.map((q: [number, number]) => `${x(q[0]).toFixed(1)},${y(q[1]).toFixed(1)}`).join(" L") : "";
  const barY = T + plotH + 30;
  const crisp = (v: number): number => Math.round(v) + 0.5;
  const vlines: { x: number; c: string; w: number; lab?: string }[] = [];
  const colRects: { a: number; b: number; c: string }[] = [];
  {
    const d0 = Math.floor(start), d1 = Math.ceil(p.end);
    const monLab = (n: number): string => { const dk = numToDk(n); const m = Number(dk.slice(4, 6)); return m === 1 ? `${dk.slice(0, 4)}년` : `${m}월`; };
    if (isAvg) {
      const bset = new Set<number>();
      if (p.bucket === "7") { for (let n = p.todayN + 1 - 7 * Math.ceil((p.todayN + 1 - d0) / 7); n <= d1; n += 7) bset.add(n); }
      else {
        const step = p.bucket === "90" ? 3 : 1;
        const sd = numToDk(d0); let yy = Number(sd.slice(0, 4)), mm = Math.floor((Number(sd.slice(4, 6)) - 1) / step) * step + 1;
        for (let i = 0; i < 2000; i++) { const n = Math.round(Date.UTC(yy, mm - 1, 1) / 864e5); if (n > d1) break; bset.add(n); mm += step; if (mm > 12) { mm -= 12; yy++; } }
      }
      const bl = Array.from(bset).sort((a1: number, a2: number) => a1 - a2);
      for (let i = 0; i + 1 < bl.length; i++) {
        const a = bl[i], b2 = bl[i + 1];
        const key = p.bucket === "7" ? Math.round((p.todayN + 1 - a) / 7) : (() => { const dk = numToDk(a); return Number(dk.slice(0, 4)) * 12 + Number(dk.slice(4, 6)); })();
        const odd = p.bucket === "90" ? Math.floor(key / 3) % 2 === 0 : key % 2 === 0;
        if (odd) colRects.push({ a, b: b2, c: STRIPE });
      }
    } else {
      if (!showCols) {
        // zoomed out: alternate whole weeks (or months when weeks are too thin)
        if (7 * colW >= 4) { for (let n = d0 - ((new Date(d0 * 864e5).getUTCDay() + 6) % 7); n <= d1; n += 7) if (Math.floor(n / 7) % 2 === 0) colRects.push({ a: n, b: n + 7, c: STRIPE }); }
        else { const sd = numToDk(d0); let yy = Number(sd.slice(0, 4)), mm = Number(sd.slice(4, 6)); for (let i = 0; i < 400; i++) { const a = Math.round(Date.UTC(yy, mm - 1, 1) / 864e5); if (a > d1) break; const b2 = Math.round(Date.UTC(mm === 12 ? yy + 1 : yy, mm === 12 ? 0 : mm, 1) / 864e5); if ((yy * 12 + mm) % 2 === 0) colRects.push({ a, b: b2, c: STRIPE }); mm++; if (mm > 12) { mm = 1; yy++; } } }
      }
      if (30 * colW >= 6) for (let n = d0; n <= d1; n++) { if (new Date(n * 864e5).getUTCDate() === 1) vlines.push({ x: x(n), c: VWEEK, w: 1, lab: p.span <= 120 ? monLab(n) : undefined }); }
    }
  }
  const colBands = colRects.map((q: { a: number; b: number; c: string }, i: number) => <rect key={"cb" + i} x={x(q.a)} y={T} width={Math.max(0, x(q.b) - x(q.a))} height={plotH} fill={q.c} />);
  const vlineEls = vlines.filter((v: { x: number }) => v.x > L + 0.5 && v.x < L + plotW - 0.5).map((v: { x: number; c: string; w: number; lab?: string }, i: number) => (
    <g key={"v" + i}>
      <line x1={crisp(v.x)} x2={crisp(v.x)} y1={T} y2={T + plotH} stroke={v.c} strokeWidth={v.w} shapeRendering="crispEdges" />
      {v.lab ? <text x={crisp(v.x) + 4} y={T + plotH - 6} style={{ fontSize: 11, fontWeight: 700, fill: VMON }}>{v.lab}</text> : null}
    </g>
  ));
  const avgLabels: ReactNode[] = [];
  if (isAvg && vis.length) {
    let minGap = Infinity;
    for (let i = 1; i < vis.length; i++) minGap = Math.min(minGap, x(vis[i].x) - x(vis[i - 1].x));
    if (minGap >= 30) vis.forEach((r: Reading, i: number) => { const lx = x(r.x); if (lx < L + 12 || lx > L + plotW - 12) return; avgLabels.push(<text key={"al" + i} x={lx} y={y(r.w) - (showDots ? dotR : 2) - 6} textAnchor="middle" style={{ fontSize: 11.5, fontWeight: 700, fill: C.ink, paintOrder: "stroke", stroke: PLOT_BG, strokeWidth: 3 }}>{r.w.toFixed(1)}</text>); });
  }
  const planCur: PlanDraft | null = draft ? draft.c : p.planCfg || null;
  live.current.planPx = planPts.map((q: [number, number]): [number, number] => [x(q[0] + 0.5), y(q[1])]);
  const vtx: PlanVtx[] = canPlan && planCur ? planVerts(planCur) : [];
  live.current.handles = vtx.map((v: PlanVtx, j: number) => ({ cx: x(v.D + 0.5), cy: y(v.U), j })).filter((h: { cx: number; cy: number }) => h.cx >= L - 4 && h.cx <= L + plotW + 4 && h.cy >= T - 4 && h.cy <= T + plotH + 4);
  let planBubble: ReactNode = null;
  if (editing && draft && planCur && vtx[draft.j]) {
    const v = vtx[draft.j];
    const seg = v.si >= 0 ? planCur.segs[v.si] : null;
    const nseg = !seg && vtx[1] && vtx[1].si >= 0 ? planCur.segs[vtx[1].si] : null;
    const txt = `${kg(v.U)}kg · ${fmtShort(numToDk(v.D))}${seg ? ` (${fmtPer(seg.per)}일/0.1kg · ${fmtRate(seg.per)})` : ` 시작${nseg ? ` · ${fmtRate(nseg.per)}` : ""}`}`;
    const bw = Math.min(plotW - 4, textW(txt, 13.5) + 20), bh = 30;
    const hx = x(v.D + 0.5), hy = y(v.U);
    const bx = Math.max(L + 2, Math.min(L + plotW - bw - 2, hx - bw / 2));
    const by = hy - 22 - bh >= T + 2 ? hy - 22 - bh : Math.min(T + plotH - bh - 2, hy + 22);
    planBubble = (
      <g pointerEvents="none">
        <rect x={bx} y={by} width={bw} height={bh} rx={8} fill={PLAN_C} />
        <text x={bx + bw / 2} y={by + 20} textAnchor="middle" style={{ fontSize: 13.5, fontWeight: 700, fill: "#ffffff" }}>{txt}</text>
      </g>
    );
  }
  // per-segment slope labels (kg/day), placed on the visible part of each rising segment, avoiding dots/goal label/toolbar
  const slopeLabels: ReactNode[] = [];
  {
    const avoid: { x0: number; y0: number; x1: number; y1: number }[] = vis.map((r: Reading) => { const cx = x(r.x), cy = y(r.w); const ar = showDots ? dotR : 2; return { x0: cx - ar - 3, y0: cy - ar - 3, x1: cx + ar + 3, y1: cy + ar + 3 }; });
    if (p.goal >= lo && p.goal <= hi) { const gy = y(p.goal) - 6; avoid.push({ x0: L + plotW / 2 - 60, y0: gy - 16, x1: L + plotW / 2 + 60, y1: gy + 4 }); }
    if (editing) avoid.push({ x0: W - 250, y0: T + 20, x1: W, y1: T + 62 });
    avoid.push({ x0: L, y0: T, x1: L + 110, y1: T + 22 }); // legend
    vtx.forEach((h: PlanVtx) => { const hx = x(h.D + 0.5), hy = y(h.U); avoid.push({ x0: hx - 14, y0: hy - 14, x1: hx + 14, y1: hy + 14 }); });
    if (planBubble && draft && vtx[draft.j]) { const v = vtx[draft.j]; const hx = x(v.D + 0.5), hy = y(v.U); avoid.push({ x0: L, y0: hy - 56, x1: L + plotW, y1: hy - 18 }); }
    const usedVtx = vtx.length === planPts.length - 1;
    for (let i = 1; i < planPts.length; i++) {
      const a = planPts[i - 1], b = planPts[i];
      if (!(b[1] > a[1] + 1e-9) || b[0] <= a[0]) continue; // flat part after goal: no label
      const seg = usedVtx && vtx[i] && vtx[i].si >= 0 && planCur ? planCur.segs[vtx[i].si] : null;
      const per = seg ? seg.per : ((b[0] - a[0]) / Math.max(1e-9, b[1] - a[1])) * 0.1;
      const d0 = Math.max(a[0], start - 0.5), d1 = Math.min(b[0], p.end - 0.5);
      if (d1 <= d0) continue;
      const ax = x(a[0] + 0.5), ay = y(a[1]), bx = x(b[0] + 0.5), by = y(b[1]);
      const vx0 = x(d0 + 0.5), vx1 = x(d1 + 0.5);
      const visLen = Math.hypot(vx1 - vx0, ((vx1 - vx0) * (by - ay)) / Math.max(1e-9, bx - ax));
      const fs = 12;
      const base = fmtRate(per), full = `${base} (${fmtWeek(per)})`;
      const opts = [full, base].map((t: string) => ({ t, w: textW(t, fs) }));
      const ang = Math.atan2(by - ay, bx - ax);
      const cands = [0.5, 0.35, 0.65, 0.2, 0.8, 0.1, 0.9];
      let placed: { x: number; y: number; t: string; anchor: string } | null = null;
      for (const o of opts) {
        if (o.w > visLen + 60) continue;
        for (const f of cands) {
          const px = vx0 + (vx1 - vx0) * f; const py = ay + ((by - ay) * (px - ax)) / Math.max(1e-9, bx - ax);
          // above-left of an upward line (label right edge at the line), else below-right
          for (const side of [-1, 1]) {
            const off = 9;
            const nx = -side * Math.sin(ang), ny = side * Math.cos(ang); // unit normal (side -1 = above-left)
            const cx = px + nx * off, cyy = py + ny * off;
            const anchorEnd = side < 0; // above an up-right line: text sits to the left
            const x0 = anchorEnd ? cx - o.w : cx, x1 = anchorEnd ? cx : cx + o.w;
            const y0 = side < 0 ? cyy - fs - 2 : cyy, y1 = side < 0 ? cyy : cyy + fs + 2;
            if (x0 < L + 2 || x1 > L + plotW - 2 || y0 < T + 2 || y1 > T + plotH - 2) continue;
            if (avoid.some((r: { x0: number; y0: number; x1: number; y1: number }) => x0 < r.x1 && x1 > r.x0 && y0 < r.y1 && y1 > r.y0)) continue;
            placed = { x: cx, y: side < 0 ? cyy - 3 : cyy + fs - 1, t: o.t, anchor: anchorEnd ? "end" : "start" };
            avoid.push({ x0, y0, x1, y1 });
            break;
          }
          if (placed) break;
        }
        if (placed) break;
      }
      if (placed) slopeLabels.push(<text key={"sl" + i} x={placed.x} y={placed.y} textAnchor={placed.anchor as "end" | "start"} pointerEvents="none" style={{ fontSize: fs, fontWeight: 700, fill: PLAN_C, paintOrder: "stroke", stroke: "#ffffff", strokeWidth: 3.5, strokeLinejoin: "round" } as CSSProperties}>{placed.t}</text>);
    }
  }
  live.current.pts = vis.map((r: Reading) => ({ cx: x(r.x), cy: y(r.w), r })).filter((q: { cx: number; cy: number; r: Reading }) => q.cx >= L - 4 && q.cx <= L + plotW + 4);
  const tipOn = tip !== null && vis.some((r: Reading) => r === tip) && x(tip.x) >= L - 4 && x(tip.x) <= L + plotW + 4;
  const holdOn = hold !== null && !isAvg && hold.id !== undefined && p.readings.some((r: Reading) => r.id === hold.id && r.x === hold.x && r.w === hold.w) && x(hold.x) >= L - 4 && x(hold.x) <= L + plotW + 4;
  let bubble: ReactNode = null;
  if (tip && tipOn) {
    const tx = x(tip.x), ty = y(tip.w);
    const l1 = `${kg(tip.w)}kg`;
    const dk = numToDk(Math.floor(tip.x));
    const l2 = tip.lab ? tip.lab : `${dk.slice(0, 4) === String(cy) ? "" : dk.slice(0, 4) + "."}${Number(dk.slice(4, 6))}.${Number(dk.slice(6, 8))} (${WD[new Date(Math.floor(tip.x) * 864e5).getUTCDay()]}) ${tip.am ? "오전" : "오후"}`;
    const bw = Math.max(l1.length * 11, l2.length * 7.6) + 20, bh = 46;
    const bx = Math.max(L + 2, Math.min(L + plotW - bw - 2, tx - bw / 2));
    const above = ty - ringR - 10 - bh >= T + 2;
    const by = above ? ty - ringR - 10 - bh : ty + ringR + 10;
    const ax = Math.max(bx + 10, Math.min(bx + bw - 10, tx));
    const arrow = above ? `M${ax - 7},${by + bh} L${ax},${by + bh + 8} L${ax + 7},${by + bh} Z` : `M${ax - 7},${by} L${ax},${by - 8} L${ax + 7},${by} Z`;
    bubble = (
      <g pointerEvents="none">
        <circle cx={tx} cy={ty} r={ringR + 5} fill="none" stroke={AVG} strokeWidth={2.5} />
        {showDots ? null : <circle cx={tx} cy={ty} r={3.5} fill={isAvg ? AVG : INK} />}
        <rect x={bx} y={by} width={bw} height={bh} rx={10} fill={PANEL} stroke={INK} strokeWidth={1.5} />
        <path d={arrow} fill={PANEL} stroke={INK} strokeWidth={1.5} strokeLinejoin="round" />
        <rect x={ax - 6} y={above ? by + bh - 2 : by} width={12} height={2.5} fill={PANEL} />
        <text x={bx + bw / 2} y={by + 20} textAnchor="middle" style={{ fontSize: 18, fontWeight: 700, fill: C.ink }}>{l1}</text>
        <text x={bx + bw / 2} y={by + 38} textAnchor="middle" style={{ fontSize: 12, fontWeight: 600, fill: C.sub }}>{l2}</text>
      </g>
    );
  }

  return (
    <div ref={wrapRef} style={{ width: "100%", flex: "1 1 0", minHeight: 0, overflow: "hidden", position: "relative", WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none" } as CSSProperties}>
      <svg ref={svgRef} width="100%" viewBox={`0 0 ${W} ${H}`} role="img" aria-label="체중 그래프" style={{ display: "block", position: "absolute", top: 0, left: 0, width: "100%", height: "100%", touchAction: "none", userSelect: "none", WebkitUserSelect: "none", WebkitTouchCallout: "none", cursor: "grab", fontFamily: theme.font.family } as CSSProperties}>
        <defs><clipPath id="gv-clip"><rect x={L} y={T} width={plotW} height={plotH} /></clipPath></defs>
        <rect x={0} y={0} width={W} height={H} rx={8} fill={PLOT_BG} />
        <g clipPath="url(#gv-clip)">
          {colBands}
          {isAvg ? null : cols.map((n: number) => {
            const wd = new Date(n * 864e5).getUTCDay();
            return (
              <g key={"c" + n}>
                {wd === 6 || wd === 0 ? <rect x={x(n)} y={T} width={colW + 0.5} height={plotH} fill={wd === 6 ? SAT_BG : SUN_BG} /> : n % 2 === 0 ? <rect x={x(n)} y={T} width={colW + 0.5} height={plotH} fill={STRIPE} /> : null}
              </g>
            );
          })}
          {yt.slice(0, -1).map((v: number) => (Math.round(v / ystep) % 2 === 0 ? <rect key={"b" + v} x={L} y={y(v + ystep)} width={plotW} height={Math.max(0, y(v) - y(v + ystep))} fill={BAND} /> : null))}
          {vlineEls}
          {yt.map((v: number) => <line key={"g" + v} x1={L} x2={L + plotW} y1={y(v)} y2={y(v)} stroke={GRID} strokeWidth={1} strokeDasharray="4 4" />)}
          {p.goal >= lo && p.goal <= hi ? <line x1={L} x2={L + plotW} y1={y(p.goal)} y2={y(p.goal)} stroke={WARN_C} strokeWidth={refW} strokeDasharray="8 5" /> : null}
          {planPts.length > 1 ? (() => { const d = planPts.map((q: [number, number], i: number) => `${i ? "L" : "M"}${x(q[0] + 0.5).toFixed(1)},${y(q[1]).toFixed(1)}`).join(" "); return editing ? (<g pointerEvents="none"><path d={d} fill="none" stroke={PLAN_C} strokeOpacity={0.22} strokeWidth={12} strokeLinejoin="round" strokeLinecap="round" /><path d={d} fill="none" stroke={PLAN_C} strokeWidth={3.5} strokeDasharray="9 4" strokeLinejoin="round" /></g>) : <path d={d} fill="none" stroke={PLAN_C} strokeWidth={refW} strokeDasharray="6 4" strokeLinejoin="round" pointerEvents="none" />; })() : null}
          {slopeLabels}
          {maPath ? <path d={maPath} fill="none" stroke={AVG} strokeWidth={3} strokeLinejoin="round" strokeLinecap="round" opacity={1} /> : null}
          {linePaths.map((d: string, i: number) => (d ? <path key={"lp" + i} d={d} fill="none" stroke={isAvg ? AVG : ink} strokeWidth={lineW} strokeLinejoin="round" strokeLinecap="round" /> : null))}
          {showMarks && showDots ? <g opacity={dotOp}>{vis.map((r: Reading, i: number) => (
            isAvg ? <circle key={"m" + i} cx={x(r.x)} cy={y(r.w)} r={dotR} fill={AVG} stroke={PLOT_BG} strokeWidth={1.5} />
              : <circle key={"m" + i} cx={x(r.x)} cy={y(r.w)} r={dotR} fill={r.am ? HOLLOW : ink} stroke={ink} strokeWidth={Math.max(1, Math.min(2, dotR * 0.45))} />
          ))}</g> : null}
          {avgLabels}
          {p.pulse && !isAvg && p.pulse.x >= start && p.pulse.x <= p.end ? (
            <g key={p.pulse.at} pointerEvents="none">
              {showDots ? null : <circle cx={x(p.pulse.x)} cy={y(p.pulse.w)} r={3.5} fill={isAvg ? AVG : INK} />}
              <circle className="sd-pulse" cx={x(p.pulse.x)} cy={y(p.pulse.w)} r={ringR + 2} fill="none" stroke={AVG} strokeWidth={2.5} />
              <circle cx={x(p.pulse.x)} cy={y(p.pulse.w)} r={ringR + 4} fill="none" stroke={AVG} strokeWidth={2.5} />
            </g>
          ) : null}
        </g>
        <text x={L + 6} y={T + (p.onSlot ? 46 : 16)} style={{ fontSize: 12, fontWeight: 700, fill: isAvg ? AVG : INK }}>{p.note ? `● ${p.note} · ${p.slot === "am" ? "오전만" : p.slot === "pm" ? "오후만" : "오전+오후 전체"}` : p.slot === "am" ? "○ 오전만" : p.slot === "pm" ? "● 오후만" : "○ 오전  ● 오후"}</text>
        {yt.map((v: number) => <text key={"yl" + v} x={L - 6} y={y(v) + 5} textAnchor="end" style={{ fontSize: ystep < 1 ? 14 : 17, fontWeight: 600, fill: ink }}>{ystep < 1 ? v.toFixed(1) : v}</text>)}
        {p.goal >= lo && p.goal <= hi ? <text x={L + plotW / 2} y={y(p.goal) - 6} textAnchor="middle" style={{ fontSize: 17, fontWeight: 700, fill: WARN_TX }}>{`목표 ${kg(p.goal)}kg`}</text> : null}
        {showCols ? cols.map((n: number) => {
          const dom = new Date(n * 864e5).getUTCDate();
          if (!((dom - 1) % k === 0 && !(k > 1 && dom > 28))) return null;
          const wd = new Date(n * 864e5).getUTCDay();
          const cx = x(n + 0.5);
          if (cx < L || cx > L + plotW) return null;
          return <text key={"d" + n} x={cx} y={T + plotH + 20} textAnchor="middle" style={{ fontSize: dayFont, fontWeight: 600, fill: wd === 6 ? SAT_TX : wd === 0 ? SUN_TX : ink }}>{dom}</text>;
        }) : null}
        {segs.map((s: { a: number; b: number; label: string }, i: number) => {
          const xa = x(s.a), xb = x(s.b);
          const wpx = xb - xa;
          return (
            <g key={"s" + i}>
              <rect x={xa + 0.5} y={barY} width={Math.max(0, wpx - 1)} height={28} fill={ink} />
              {wpx > s.label.length * 8 + 8 ? <text x={(xa + xb) / 2} y={barY + 19} textAnchor="middle" style={{ fontSize: 15, fontWeight: 600, fill: BAR_TX }}>{s.label}</text> : null}
            </g>
          );
        })}
        {bubble}
        {holdOn && hold && !showDots ? <circle cx={x(hold.x)} cy={y(hold.w)} r={3.5} fill={INK} pointerEvents="none" /> : null}
        {holdOn && hold ? <circle cx={x(hold.x)} cy={y(hold.w)} r={ringR + 6} fill="none" stroke={AVG} strokeWidth={3} pointerEvents="none" /> : null}
        {editing ? live.current.handles.map((h: { cx: number; cy: number; j: number }) => { const act = !!draft && draft.j === h.j; return <g key={"ph" + h.j} pointerEvents="none"><circle cx={h.cx} cy={h.cy} r={act ? 13 : 10} fill={act ? PLAN_C : "#ffffff"} stroke={PLAN_C} strokeWidth={3} />{h.j === 0 ? <circle cx={h.cx} cy={h.cy} r={3.5} fill={act ? "#ffffff" : PLAN_C} /> : null}</g>; }) : null}
        {planBubble}
      </svg>
      {p.onSlot ? (
        <div role="group" aria-label="오전/오후 보기" style={{ position: "absolute", top: T + 4, left: L + 4, display: "flex", padding: 2, gap: 2, borderRadius: 9, background: SOFT, border: `1px solid ${DIV}`, touchAction: "manipulation" }}>
          {([["both", "같이"], ["am", "오전"], ["pm", "오후"]] as [GSlot, string][]).map((o: [GSlot, string]) => {
            const on = (p.slot || "both") === o[0];
            return <button key={o[0]} onClick={() => { setTip(null); setHold(null); if (p.onSlot) p.onSlot(o[0]); }} aria-pressed={on} style={{ height: 24, minWidth: 38, padding: "0 8px", borderRadius: 7, border: "none", background: on ? PANEL : "transparent", boxShadow: on ? "0 1px 2px rgba(0,0,0,0.18)" : "none", color: on ? C.ink : C.sub, fontSize: 12, fontWeight: on ? 700 : 600, cursor: "pointer", fontFamily: "inherit", touchAction: "manipulation" }}>{o[1]}</button>;
          })}
        </div>
      ) : null}
      {editing ? (
        <div role="toolbar" aria-label="목표 경로 편집" style={{ position: "absolute", top: T + 22, right: 6, display: "flex", alignItems: "center", gap: 6, padding: "5px 6px 5px 10px", borderRadius: 12, background: PANEL, border: `1.5px solid ${PLAN_C}`, boxShadow: "0 3px 10px rgba(0,0,0,0.18)", zIndex: 6, fontFamily: theme.font.family, WebkitUserSelect: "none", userSelect: "none" } as CSSProperties}>
          <span style={{ fontSize: 12, fontWeight: 700, color: PLAN_C, whiteSpace: "nowrap" }}>경로 편집 · 점을 끌어요</span>
          <button onClick={() => { const u = undo; if (!u.length || !p.onPlanCommit) return; const prev = u[u.length - 1]; setUndo(u.slice(0, -1)); p.onPlanCommit(prev); }} disabled={!undo.length} aria-label="되돌리기" style={{ height: 32, padding: "0 10px", borderRadius: 8, border: `1px solid ${C.border}`, background: PANEL, color: undo.length ? C.ink : C.muted, fontSize: 13, fontWeight: 700, cursor: undo.length ? "pointer" : "default", fontFamily: "inherit", touchAction: "manipulation" }}>되돌리기</button>
          <button onClick={exitPe} aria-label="완료" style={{ height: 32, padding: "0 12px", borderRadius: 8, border: "none", background: PLAN_C, color: "#ffffff", fontSize: 13, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", touchAction: "manipulation" }}>완료</button>
        </div>
      ) : null}
      {holdOn && hold ? (() => {
        const hx = x(hold.x), hy = y(hold.w);
        const pw = holdDel ? 196 : 150, ph = 74;
        const left = Math.max(4, Math.min(W - pw - 4, hx - pw / 2));
        const top = hy - ringR - 12 - ph >= 4 ? hy - ringR - 12 - ph : Math.min(H - ph - 4, hy + ringR + 12);
        const dk = numToDk(Math.floor(hold.x));
        const pb: CSSProperties = { flex: "1 1 0", height: 34, borderRadius: 8, fontSize: 14, fontWeight: 700, cursor: "pointer", fontFamily: "inherit", touchAction: "manipulation", padding: "0 8px" };
        return (
          <div role="dialog" aria-label="기록 편집 메뉴" style={{ position: "absolute", left, top, width: pw, height: ph, boxSizing: "border-box", padding: 6, borderRadius: 12, background: PANEL, border: `1.5px solid ${INK}`, boxShadow: "0 4px 14px rgba(0,0,0,0.22)", display: "flex", flexDirection: "column", gap: 5, zIndex: 5, WebkitUserSelect: "none", userSelect: "none", WebkitTouchCallout: "none", fontFamily: theme.font.family } as CSSProperties}>
            <div style={{ fontSize: 12, fontWeight: 600, color: C.sub, textAlign: "center", whiteSpace: "nowrap" }}>{holdDel ? `${Number(dk.slice(4, 6))}/${Number(dk.slice(6, 8))} ${hold.am ? "오전" : "오후"} ${kg(hold.w)}kg 삭제할까요?` : `${Number(dk.slice(4, 6))}/${Number(dk.slice(6, 8))} ${hold.am ? "오전" : "오후"} ${kg(hold.w)}kg`}</div>
            <div style={{ display: "flex", gap: 6 }}>
              {holdDel ? (<>
                <button onClick={() => { const id = hold.id as number; setHold(null); setHoldDel(false); if (p.onDelete) p.onDelete(id); }} style={{ ...pb, border: "none", background: WARN_TX, color: "#ffffff" }}>삭제</button>
                <button onClick={() => setHoldDel(false)} style={{ ...pb, border: `1px solid ${C.border}`, background: PANEL, color: C.ink }}>취소</button>
              </>) : (<>
                <button onClick={() => { const id = hold.id as number; setHold(null); if (p.onEdit) p.onEdit(id); }} style={{ ...pb, border: "none", background: AVG, color: "#ffffff" }}>편집</button>
                <button onClick={() => setHoldDel(true)} style={{ ...pb, border: `1px solid ${WARN_TX}`, background: PANEL, color: WARN_TX }}>삭제</button>
              </>)}
            </div>
          </div>
        );
      })() : null}
    </div>
  );
}

export default function App() {
  const rawTheme = useTheme();
  const [chosen, setChosen] = useState<string | null>(() => loadMode());
  const mode = chosen || "light";
  const setMode = (m: string): void => { setChosen(m); saveMode(m); };
  applyMode(mode);
  const theme = lightTheme(rawTheme);
  useEffect(() => { paintDoc(); }, [mode]);
  const [entries, setEntries] = useState<Entry[]>([]);
  const [goal, setGoal] = useState<number>(DEFAULT_GOAL);
  const [plan, setPlan] = useState<PlanCfg>(PLAN_DEFAULT);
  const setQuiet = useRef<boolean>(false);
  const prevSet = useRef<string | null>(null);
  const [stamps, setStamps] = useState<Record<string, Stamp>>({});
  const [loaded, setLoaded] = useState<boolean>(false);
  const syncRef = useRef<SyncState>({ token: "", owner: SYNC_TARGET.owner, repo: SYNC_TARGET.repo, meta: {}, tomb: {} });
  const [syncUi, setSyncUi] = useState<SyncState>(syncRef.current);
  const [syncVer, setSyncVer] = useState<number>(0);
  const [syncing, setSyncing] = useState<boolean>(false);
  const [tokIn, setTokIn] = useState<string>("");
  const [tokCopied, setTokCopied] = useState<boolean>(false);
  const copyToken = async (): Promise<void> => {
    const t = syncRef.current.token; if (!t) return;
    let ok = false;
    try { if (navigator.clipboard && navigator.clipboard.writeText) { await navigator.clipboard.writeText(t); ok = true; } } catch (_e) { ok = false; }
    if (!ok) { try { const ta = document.createElement("textarea"); ta.value = t; ta.setAttribute("readonly", ""); ta.style.position = "fixed"; ta.style.opacity = "0"; ta.style.top = "0"; document.body.appendChild(ta); ta.select(); ta.setSelectionRange(0, t.length); ok = document.execCommand("copy"); ta.remove(); } catch (_e) { ok = false; } }
    if (ok) { setTokCopied(true); window.setTimeout(() => setTokCopied(false), 1500); }
  };
  const [repoIn, setRepoIn] = useState<string>(`${SYNC_TARGET.owner}/${SYNC_TARGET.repo}`);
  const syncBusy = useRef<boolean>(false);
  const syncAgain = useRef<boolean>(false);
  const syncTimer = useRef<number | null>(null);
  const prevKeys = useRef<Map<string, string> | null>(null);
  const noStamp = useRef<Set<string>>(new Set<string>());
  const entriesRef = useRef<Entry[]>([]);
  const [storageOk, setStorageOk] = useState<boolean>(true);
  const [val, setVal] = useState<string>("");
  const [dDate, setDDate] = useState<string>(defDate());
  const [slot, setSlot] = useState<"am" | "pm">(defSlot());
  const [editId, setEditId] = useState<number | null>(null);
  const [delId, setDelId] = useState<number | null>(null);
  const [range, setRange] = useState<RangeKey>("31");
  const [listN, setListN] = useState<number>(40);
  const [showCsv, setShowCsv] = useState<boolean>(false);
  const [flash, setFlash] = useState<string>("");
  const entryRef = useRef<HTMLDivElement>(null);
  const [view, setView] = useState<string>(() => { const s0 = loadStore(); return s0 && Array.isArray(s0.entries) && s0.entries.length ? "entry" : "import"; });
  const [nav, setNav] = useState<{ n: number; dir: string }>({ n: 0, dir: "" });
  const [pulse, setPulse] = useState<{ x: number; w: number; at: number } | null>(null);
  useEffect(() => { if (!pulse) return; const tm = window.setTimeout(() => setPulse(null), 3400); return () => window.clearTimeout(tm); }, [pulse]);
  const go = (v: string): void => { if (v === "graph") resetGraph(); if (v !== view) setNav((o: { n: number; dir: string }) => ({ n: o.n + 1, dir: v === "entry" ? "back" : "fwd" })); setView(v); setDelId(null); try { window.scrollTo(0, 0); } catch (_e) { setFlash(""); } };

  useEffect(() => {
    const s = loadStore();
    if (s) {
      if (Array.isArray(s.entries) && s.entries.length) setEntries(s.entries.map((q: [string, number], i: number) => ({ id: i + 1, t: q[0], w: q[1] })));
      if (typeof s.goal === "number" && s.goalV === 2) setGoal(s.goal);
      if (s.plan) setPlan({ ...PLAN_DEFAULT, ...s.plan, segs: s.plan.segs && s.plan.segs.length ? s.plan.segs : DEFAULT_SEGS });
      if (s.stamps) setStamps(s.stamps);
      if (s.sync) { syncRef.current = { ...syncRef.current, ...s.sync, meta: s.sync.meta || {}, tomb: s.sync.tomb || {} }; setSyncUi({ ...syncRef.current }); }
    }
    setLoaded(true);
  }, []);

  useEffect(() => {
    if (!loaded) return;
    // stamp changed/removed keys with updatedAt (anything not coming from a sync merge)
    const cur = keyMapOf(entries);
    const sr = syncRef.current;
    let changed = false;
    if (prevKeys.current) {
      const now = Date.now();
      const prev = prevKeys.current;
      cur.forEach((v: string, k: string) => { if (prev.get(k) !== v) { if (noStamp.current.has(k) && !prev.has(k)) { if (!sr.meta[k]) delete sr.meta[k]; } else sr.meta[k] = now; delete sr.tomb[k]; changed = true; } });
      prev.forEach((v: string, k: string) => { if (!cur.has(k)) { const [tm, w] = v.split("|"); sr.tomb[k] = { w: Number(w), time: tm, u: now, del: true }; delete sr.meta[k]; changed = true; } });
    }
    prevKeys.current = cur;
    noStamp.current.clear();
    const setJson = JSON.stringify({ goal, plan: { on: plan.on, start: plan.start, w0: plan.w0, segs: plan.segs || DEFAULT_SEGS } });
    if (prevSet.current !== null && prevSet.current !== setJson) { if (setQuiet.current) setQuiet.current = false; else { sr.setU = Date.now(); changed = true; } }
    prevSet.current = setJson;
    writeStore({ v: 1, entries: entries.map((e: Entry): [string, number] => [e.t, e.w]), goal, goalV: 2, plan, stamps, mode: chosen || undefined, sync: sr }).then(setStorageOk);
    if (changed && sr.token) scheduleSync(2000);
  }, [entries, goal, plan, stamps, loaded, chosen, syncVer]);

  useEffect(() => {
    if (!loaded) return;
    if (syncRef.current.token) scheduleSync(300);
    const onVis = (): void => { if (document.visibilityState === "visible" && syncRef.current.token) scheduleSync(300); };
    const onOnline = (): void => { if (syncRef.current.token) scheduleSync(300); };
    document.addEventListener("visibilitychange", onVis);
    window.addEventListener("online", onOnline);
    return () => { document.removeEventListener("visibilitychange", onVis); window.removeEventListener("online", onOnline); };
  }, [loaded]);

  entriesRef.current = entries;
  const runSync = async (): Promise<void> => {
    const sr = syncRef.current;
    if (!sr.token) return;
    if (syncBusy.current) { syncAgain.current = true; return; }
    syncBusy.current = true; setSyncing(true);
    try {
      const cfg: SyncCfg = { token: sr.token, owner: sr.owner || SYNC_TARGET.owner, repo: sr.repo || SYNC_TARGET.repo, branch: SYNC_TARGET.branch, path: SYNC_TARGET.path };
      const res = await syncRound(cfg, () => localRecs(entriesRef.current, syncRef.current), () => settingsRef.current());
      if (res.settingsDown && res.settings) {
        const st = res.settings;
        const nj = JSON.stringify({ goal: st.goal, plan: { on: st.plan.on, start: st.plan.start, w0: st.plan.w0, segs: st.plan.segs.length ? st.plan.segs : DEFAULT_SEGS } });
        if (nj !== prevSet.current) setQuiet.current = true;
        syncRef.current = { ...syncRef.current, setU: st.u };
        setGoal(st.goal);
        setPlan({ on: st.plan.on, start: st.plan.start, w0: st.plan.w0, segs: st.plan.segs.length ? st.plan.segs : DEFAULT_SEGS });
      }
      const localNow = localRecs(entriesRef.current, syncRef.current);
      const dupes = entriesRef.current.length !== keyMapOf(entriesRef.current).size;
      const differs = dupes || Object.keys(res.merged).some((k: string) => { const a = res.merged[k], b = localNow[k]; return !b ? !a.del : a.w !== b.w || a.time !== b.time || a.u !== b.u || !!a.del !== !!b.del; });
      if (differs) {
        const byKey = new Map<string, number>();
        entriesRef.current.forEach((e: Entry) => byKey.set(keyOfT(e.t), e.id));
        let nid = entriesRef.current.reduce((m: number, e: Entry) => Math.max(m, e.id), 0);
        const ne: Entry[] = [];
        const meta: Record<string, number> = {}, tomb: Record<string, Rec> = {};
        Object.keys(res.merged).sort().forEach((k: string) => {
          const r = res.merged[k];
          if (r.del) { tomb[k] = r; return; }
          meta[k] = r.u;
          ne.push({ id: byKey.get(k) || ++nid, t: tOf(k, r.time), w: r.w });
        });
        syncRef.current = { ...syncRef.current, meta, tomb };
        prevKeys.current = keyMapOf(ne);
        entriesRef.current = ne;
        setEntries(ne);
      }
      syncRef.current = { ...syncRef.current, last: Date.now(), err: "", up: res.up, down: res.down };
    } catch (e) {
      syncRef.current = { ...syncRef.current, err: (e as Error).message || "동기화 실패" };
    } finally {
      syncBusy.current = false; setSyncing(false);
      setSyncUi({ ...syncRef.current }); setSyncVer((v: number) => v + 1);
      if (syncAgain.current) { syncAgain.current = false; scheduleSync(500); }
    }
  };
  const settingsRef = useRef<() => SettingsRec | null>(() => null);
  settingsRef.current = (): SettingsRec | null => normSettings({ goal, plan: { on: plan.on, start: plan.start, w0: plan.w0, segs: plan.segs || DEFAULT_SEGS }, u: syncRef.current.setU || 0 });
  const runSyncRef = useRef(runSync);
  runSyncRef.current = runSync;
  function scheduleSync(ms: number): void {
    if (syncTimer.current !== null) window.clearTimeout(syncTimer.current);
    syncTimer.current = window.setTimeout(() => { syncTimer.current = null; runSyncRef.current(); }, ms);
  }
  const S = useMemo(() => {
    const sorted = [...entries].sort((a: Entry, b: Entry) => (a.t < b.t ? -1 : a.t > b.t ? 1 : a.id - b.id));
    const map = new Map<string, DayRec>();
    for (const e of sorted) {
      const dk = e.t.slice(0, 8);
      let rec = map.get(dk);
      if (!rec) { rec = { dk, n: dayNum(dk), am: null, pm: null, count: 0 }; map.set(dk, rec); }
      rec.count++;
      if (isAM(e.t)) { if (rec.am === null) rec.am = e.w; } else rec.pm = e.w;
    }
    const days = Array.from(map.values());
    const amDays = days.filter((d: DayRec) => d.am !== null);
    const ma = new Map<number, number>();
    let j = 0, sum = 0;
    for (let i = 0; i < amDays.length; i++) {
      sum += amDays[i].am as number;
      while (amDays[j].n < amDays[i].n - 6) { sum -= amDays[j].am as number; j++; }
      ma.set(amDays[i].n, sum / (i - j + 1));
    }
    const anchor = days.length ? days[days.length - 1].n : dayNum(todayDk());
    const amIn = (a: number, b: number): number[] => sorted.filter((e: Entry) => { const n = dayNum(e.t.slice(0, 8)); return n >= a && n <= b; }).map((e: Entry) => e.w);
    const avg7 = mean(amIn(anchor - 6, anchor));
    const prev7 = mean(amIn(anchor - 13, anchor - 7));
    const base30 = mean(amIn(anchor - 36, anchor - 30));
    let low: Entry | null = null, high: Entry | null = null;
    for (const e of sorted) { if (!low || e.w < low.w) low = e; if (!high || e.w > high.w) high = e; }
    let streak = 0, k = days.length - 1, expect = anchor;
    while (k >= 0 && days[k].n === expect) { streak++; expect--; k--; }
    const gaps = days.filter((d: DayRec) => d.n >= anchor - 13 && d.am !== null && d.pm !== null).map((d: DayRec) => (d.pm as number) - (d.am as number));
    const gap = mean(gaps);
    const logged7 = days.filter((d: DayRec) => d.n >= anchor - 6).length;
    const years = new Map<string, { days: number; am: number[]; lo: number; hi: number }>();
    for (const d of days) {
      const yk = d.dk.slice(0, 4);
      const yr = years.get(yk) || { days: 0, am: [], lo: 999, hi: 0 };
      yr.days++;
      [d.am, d.pm].forEach((v: number | null) => { if (v !== null) { yr.lo = Math.min(yr.lo, v); yr.hi = Math.max(yr.hi, v); } });
      years.set(yk, yr);
    }
    for (const e of sorted) { const yr = years.get(e.t.slice(0, 4)); if (yr) { yr.am.push(e.w); yr.lo = Math.min(yr.lo, e.w); yr.hi = Math.max(yr.hi, e.w); } }
    return { sorted, days, ma, anchor, avg7, prev7, base30, low, high, streak, gap, gapDays: gaps.length, logged7, years, last: sorted.length ? sorted[sorted.length - 1] : null };
  }, [entries]);

  const planAuto = S.avg7 !== null ? roundKg(S.avg7) : null;
  const planW0 = plan.w0 !== null && plan.w0 > 20 ? plan.w0 : planAuto;
  const planD0 = plan.start !== null ? dayNum(plan.start.replace(/-/g, "")) : null;
  const planCalc = planW0 !== null && planD0 !== null ? planPoints(planD0, planW0, plan.segs && plan.segs.length ? plan.segs : DEFAULT_SEGS) : null;
  useEffect(() => { if (loaded && (plan.w0 === null || plan.start === null) && planAuto !== null) { setQuiet.current = true; setPlan((pl: PlanCfg) => ({ ...pl, w0: pl.w0 ?? planAuto, start: pl.start ?? isoOfDk(numToDk(S.anchor)) })); } }, [loaded, plan.w0, plan.start, planAuto, S.anchor]);
  const todayN = dayNum(todayDk());
  const chartTo = Math.max(S.anchor, todayN);
  const spanMap: Record<RangeKey, number> = { "7": 7, "31": 31, "90": 90, "365": 365, all: 0 };
  const [vEnd, setVEnd] = useState<number>(todayN + 1);
  const [vSpan, setVSpan] = useState<number>(31);
  const [avgMode, setAvgMode] = useState<string>("raw");
  const resetGraph = (): void => { setVEnd(todayN + 1); setVSpan(31); setAvgMode("raw"); };
  const [showMa, setShowMa] = useState<boolean>(true);
  const firstN = S.days.length ? S.days[0].n : todayN - 30;
  const maxEnd = todayN + 1;
  const maxSpan = Math.max(7, maxEnd - firstN);
  const setView2 = (end: number, span: number): void => {
    const s = Math.min(Math.max(span, 5), maxSpan);
    const e = Math.max(Math.min(end, maxEnd + 365), Math.min(maxEnd, firstN + s));
    setVSpan(s); setVEnd(e);
  };
  const zoomBy = (f: number): void => { const ns = Math.min(Math.max(vSpan * f, 5), maxSpan); setView2(vEnd - vSpan / 2 + ns / 2, ns); };
  const spanOf = (rk: RangeKey): number => (rk === "all" ? maxSpan : Number(rk));
  const isActive = (rk: RangeKey): boolean => Math.abs(vEnd - maxEnd) < 0.5 && Math.abs(vSpan - Math.min(spanOf(rk), maxSpan)) < 0.5;
  const readings = useMemo(() => S.sorted.map((e: Entry): Reading => ({ x: dayNum(e.t.slice(0, 8)) + (Number(e.t.slice(8, 10)) * 60 + Number(e.t.slice(10, 12))) / 1440, w: e.w, am: isAM(e.t), id: e.id })), [S.sorted]);
  const [gSlot, setGSlotS] = useState<GSlot>(loadGSlot);
  const setGSlot = (v: GSlot): void => { setGSlotS(v); saveGSlot(v); };
  const gReadings = useMemo(() => (gSlot === "both" ? readings : readings.filter((r: Reading) => r.am === (gSlot === "am"))), [readings, gSlot]);
  const gPulse = pulse && gSlot !== "both" && (pulse.x - Math.floor(pulse.x) < 0.5) !== (gSlot === "am") ? null : pulse;
  const avgSeries = useMemo((): Reading[][] => {
    if (avgMode === "raw") return [];
    type Bk = { s: number; c: number; a: number; b: number };
    const byKey = new Map<string, Bk>();
    for (const e of S.sorted) {
      if (gSlot !== "both" && isAM(e.t) !== (gSlot === "am")) continue;
      const dk = e.t.slice(0, 8);
      const n = dayNum(dk);
      let key: string, a: number, b: number;
      if (avgMode === "7") {
        const k = Math.floor((todayN - n) / 7);
        key = "w" + k; b = todayN - 7 * k; a = b - 6;
      } else {
        const y = Number(dk.slice(0, 4)), m = Number(dk.slice(4, 6));
        const len = avgMode === "30" ? 1 : 3;
        const sm = len === 1 ? m : Math.floor((m - 1) / 3) * 3 + 1;
        key = y + "-" + sm;
        a = Math.round(Date.UTC(y, sm - 1, 1) / 864e5);
        b = Math.round(Date.UTC(y, sm - 1 + len, 1) / 864e5) - 1;
      }
      const r: Bk = byKey.get(key) || { s: 0, c: 0, a, b };
      r.s += e.w; r.c += 1; byKey.set(key, r);
    }
    const cyr = Number(numToDk(todayN).slice(0, 4));
    const md = (n: number): string => { const d = numToDk(n); return `${Number(d.slice(4, 6))}.${Number(d.slice(6, 8))}`; };
    const labOf = (r: Bk): string => {
      const d = numToDk(r.a); const yy = Number(d.slice(0, 4)), mm = Number(d.slice(4, 6));
      const yp = yy === cyr ? "" : `${yy}년 `;
      const head = avgMode === "7" ? `${yy === cyr ? "" : yy + "."}${md(r.a)}~${md(r.b)} 평균` : avgMode === "30" ? `${yp}${mm}월 평균` : `${yy}년 ${Math.floor((mm - 1) / 3) + 1}분기 평균`;
      return `${head} · ${r.c}회`;
    };
    const out: Reading[] = Array.from(byKey.values()).map((r: Bk): Reading => ({ x: (r.a + r.b + 1) / 2, w: Math.round((r.s / r.c) * 100) / 100, am: false, lab: labOf(r) })).sort((p1: Reading, p2: Reading) => p1.x - p2.x);
    return [out];
  }, [S.sorted, avgMode, todayN, gSlot]);
  const vFrom = vEnd - vSpan;
  const rangeDays = S.days.filter((d: DayRec) => d.n + 1 > vFrom && d.n < vEnd);
  const calBtn = (rk: RangeKey, label: string) => {
    const on = isActive(rk);
    const ink = on ? theme.text.accent : theme.text.tertiary;
    return (
      <button key={rk} onClick={() => setView2(maxEnd, spanOf(rk))} aria-label={`${label} 보기`} style={{ background: "transparent", border: "none", padding: 0, cursor: "pointer", flex: "0 0 auto" }}>
        <svg width="32" height="38" viewBox="0 -1 46 48" aria-hidden="true">
          <rect x="4" y="9" width="38" height="33" rx="6" fill={on ? theme.fill.accentSubtle : theme.bg.base} stroke={ink} strokeWidth={2} />
          <rect x="4" y="9" width="38" height="9" rx="4" fill={ink} />
          <line x1="15" y1="5" x2="15" y2="13" stroke={ink} strokeWidth={3} strokeLinecap="round" />
          <line x1="31" y1="5" x2="31" y2="13" stroke={ink} strokeWidth={3} strokeLinecap="round" />
          <text x="23" y="35" textAnchor="middle" style={{ fontSize: 14, fontWeight: 600, fill: on ? theme.text.accent : theme.text.secondary, fontFamily: theme.font.family }}>{label}</text>
        </svg>
      </button>
    );
  };
  const roundBtn = (txt: string, aria: string, onClick: () => void) => (
    <button key={aria} onClick={onClick} aria-label={aria} style={{ flex: "0 0 auto", width: 38, height: 38, padding: 0, borderRadius: theme.radius.full, border: `1px solid ${theme.border.default}`, background: theme.bg.base, color: theme.text.primary, fontSize: 20, lineHeight: "20px", cursor: "pointer", fontFamily: theme.font.family }}>{txt}</button>
  );
  const rangeAm = rangeDays.filter((d: DayRec) => d.am !== null).map((d: DayRec) => d.am as number);
  const rangeAvg = mean(rangeAm);

  const weekStamps = Array.from({ length: 7 }, (_v: unknown, i: number) => numToDk(todayN - i));
  const mealCnt = weekStamps.filter((dk: string) => stamps[dk] && stamps[dk].meal).length;
  const exCnt = weekStamps.filter((dk: string) => stamps[dk] && stamps[dk].ex).length;

  const remaining = S.avg7 !== null ? S.avg7 - goal : null;
  const feedback: string[] = [];
  if (S.avg7 !== null && S.prev7 !== null) {
    const d = S.avg7 - S.prev7;
    if (d <= -0.25) feedback.push(`이번 주 평균은 ${kg(S.avg7)}kg으로 지난주보다 ${kg(-d)}kg 내려갔어요. 좋은 흐름이에요.`);
    else if (d >= 0.25) feedback.push(`이번 주 평균은 ${kg(S.avg7)}kg으로 지난주보다 ${kg(d)}kg 올라갔어요. 식사량을 한 번 점검해 볼 때예요.`);
    else feedback.push(`이번 주 평균은 ${kg(S.avg7)}kg으로 지난주(${kg(S.prev7)}kg)와 거의 같아요. 안정적으로 유지 중이에요.`);
  }
  if (S.gap !== null) {
    if (S.gap >= 0.8) feedback.push(`오전·오후 차이가 평균 ${kg(S.gap)}kg로 큰 편이에요. 늦은 식사와 짠 음식을 줄여 보세요.`);
    else if (S.gap >= 0.4) feedback.push(`오전·오후 차이는 평균 ${kg(S.gap)}kg로 보통 수준이에요.`);
    else feedback.push(`오전·오후 차이가 평균 ${kg(S.gap)}kg로 작아요. 하루 변동 관리가 잘 되고 있어요.`);
  }
  if (remaining !== null) {
    if (remaining > 0) {
      const pace = S.prev7 !== null && S.avg7 !== null ? S.prev7 - S.avg7 : 0;
      feedback.push(`목표 ${kg(goal)}kg까지 ${kg(remaining)}kg 남았어요.` + (pace >= 0.1 ? ` 지금 속도(주 ${kg(pace)}kg)라면 약 ${Math.ceil(remaining / pace)}주 걸려요.` : ` 주 0.3kg씩 줄이면 약 ${Math.ceil(remaining / 0.3)}주 걸려요.`));
    } else feedback.push(`목표 ${kg(goal)}kg를 달성했어요. 이제 유지가 목표예요.`);
  }
  feedback.push(`최근 7일 중 ${S.logged7}일 기록했고, ${S.streak}일 연속 기록 중이에요.` + (mealCnt + exCnt > 0 ? ` 이번 주 식사 체크 ${mealCnt}일, 운동 체크 ${exCnt}일.` : ""));

  const [gEdit, setGEdit] = useState<{ id: number; date: string; slot: "am" | "pm"; d: string; ask: boolean } | null>(null);
  const openGEdit = (id: number): void => { const e = entries.find((q: Entry) => q.id === id); if (!e) return; setGEdit({ id, date: tToInput(e.t).slice(0, 10), slot: isAM(e.t) ? "am" : "pm", d: kgToDigits(e.w), ask: false }); };
  const gEditSave = (force: boolean): void => {
    if (!gEdit) return;
    const orig = entries.find((q: Entry) => q.id === gEdit.id);
    if (!orig) { setGEdit(null); return; }
    const w = commitKg(gEdit.d);
    if (!isValidKg(w)) return;
    const dk = gEdit.date.replace(/[^0-9]/g, "");
    if (dk.length !== 8) return;
    const am = gEdit.slot === "am";
    const clash = entries.filter((q: Entry) => q.id !== gEdit.id && q.t.slice(0, 8) === dk && isAM(q.t) === am);
    if (clash.length && !force) { setGEdit({ ...gEdit, ask: true }); return; }
    const same = orig.t.slice(0, 8) === dk && isAM(orig.t) === am;
    const t = same ? orig.t : dk + (am ? "0700" : "2000");
    const wr = roundKg(w);
    const drop = new Set<number>(clash.map((q: Entry) => q.id));
    setEntries((es: Entry[]) => es.filter((q: Entry) => !drop.has(q.id)).map((q: Entry) => (q.id === gEdit.id ? { ...q, t, w: wr } : q)));
    setGEdit(null);
  };
  const freshRef = useRef<boolean>(false);
  const press = (key: string): void => {
    setFlash("");
    const fresh = freshRef.current; freshRef.current = false;
    setVal((v: string) => typeDigits(fresh && key !== "del" ? "" : v, key));
  };
  const dkSel = dDate.replace(/[^0-9]/g, "");
  const slotEntries = entries.filter((e: Entry) => e.t.slice(0, 8) === dkSel && isAM(e.t) === (slot === "am") && e.id !== editId);
  const existing: Entry | null = slotEntries.length ? slotEntries[slotEntries.length - 1] : null;
  const save = (): void => {
    if (!val) { setFlash("체중을 입력해 주세요. 숫자만 누르면 소수점이 자동으로 들어가요 (73 → 73.0, 739 → 73.9)."); return; }
    const w = commitKg(val);
    if (!isValidKg(w)) { setFlash(`${kg(w)}kg은 범위 밖이에요. 20.0~300.0kg 사이로 입력해 주세요.`); return; }
    const dk = dkSel;
    if (dk.length !== 8) { setFlash("날짜를 확인해 주세요."); return; }
    const t = dk + (slot === "am" ? "0700" : "2000");
    const wr = roundKg(w);
    const replaced = existing !== null;
    const eid = editId;
    setEntries((es: Entry[]) => {
      const keep = es.filter((e: Entry) => e.id !== eid && !(e.t.slice(0, 8) === dk && isAM(e.t) === (slot === "am")));
      const id = eid !== null ? eid : es.reduce((m: number, e: Entry) => Math.max(m, e.id), 0) + 1;
      return [...keep, { id, t, w: wr }];
    });
    setFlash(`✓ ${Number(dk.slice(4, 6))}/${Number(dk.slice(6, 8))} ${slot === "am" ? "오전" : "오후"} ${kg(wr)}kg ${eid !== null ? "수정됨" : replaced ? "저장 (기존 값 교체)" : "저장됨"} · 그래프에 반영`);
    setVal(""); setEditId(null); setDDate(defDate()); setSlot(defSlot());
    const pn = dayNum(dk);
    setPulse({ x: pn + (slot === "am" ? 7 : 20) / 24, w: wr, at: Date.now() });
    go("graph");
  };
  const startEdit = (e: Entry): void => {
    setEditId(e.id); setVal(kgToDigits(e.w)); freshRef.current = true; setDDate(tToInput(e.t).slice(0, 10)); setSlot(isAM(e.t) ? "am" : "pm"); setDelId(null); setFlash("");
    go("entry");
  };
  const cancelEdit = (): void => { setEditId(null); setVal(""); setDDate(defDate()); setSlot(defSlot()); };
  const remove = (id: number): void => {
    if (delId === id) { setEntries((es: Entry[]) => es.filter((e: Entry) => e.id !== id)); setDelId(null); if (editId === id) cancelEdit(); }
    else setDelId(id);
  };
  const toggleStamp = (dk: string, k: "meal" | "ex"): void => {
    setStamps((s: Record<string, Stamp>) => { const cur: Stamp = s[dk] || { meal: false, ex: false }; return { ...s, [dk]: { meal: k === "meal" ? !cur.meal : cur.meal, ex: k === "ex" ? !cur.ex : cur.ex } }; });
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    const tg = e.target as HTMLElement;
    if (tg.tagName === "INPUT" || tg.tagName === "TEXTAREA") return;
    if (/^[0-9]$/.test(e.key)) press(e.key);
    else if (e.key === "Backspace") press("del");
    else if (e.key === "Enter") save();
  };

  const csv = useMemo(() => "일시,체중(kg),구분,식사체크,운동체크\n" + S.sorted.map((e: Entry) => {
    const dk = e.t.slice(0, 8); const st = stamps[dk];
    return `${e.t.slice(0, 4)}-${e.t.slice(4, 6)}-${e.t.slice(6, 8)} ${fmtTime(e.t)},${kg(e.w)},${isAM(e.t) ? "오전" : "오후"},${st && st.meal ? "O" : ""},${st && st.ex ? "O" : ""}`;
  }).join("\n"), [S.sorted, stamps]);
  const download = (): void => {
    try {
      const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8" });
      const name = `체중기록_${todayDk()}.csv`;
      try {
        const file = new File([blob], name, { type: "text/csv" });
        const nav = navigator as Navigator & { canShare?: (d: { files: File[] }) => boolean };
        if (nav.canShare && nav.canShare({ files: [file] }) && nav.share) { nav.share({ files: [file], title: name }).catch(() => undefined); return; }
      } catch (_e) { /* fall back to link download */ }
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url; a.download = `체중기록_${todayDk()}.csv`;
      document.body.appendChild(a); a.click(); a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 2000);
    } catch (_e) { setShowCsv(true); }
  };

  const [impText, setImpText] = useState<string>("");
  const [impMsg, setImpMsg] = useState<string>("");
  const doImport = (text: string, src: string): void => {
    const r = parseImport(text);
    if (!r.items.length) { setImpMsg(`${src}에서 기록을 찾지 못했어요. ‘YYYY-MM-DD HH:MM,체중’ 또는 ‘YYYY/MM/DD H:MM:SS<탭>체중’ 형식인지 확인해 주세요.`); return; }
    const have = new Set<string>(entries.map((e: Entry) => `${e.t}|${e.w}`));
    const fresh = r.items.filter((q: [string, number]) => { const k = `${q[0]}|${q[1]}`; if (have.has(k)) return false; have.add(k); return true; });
    fresh.forEach((q: [string, number]) => noStamp.current.add(keyOfT(q[0])));
    setEntries((es: Entry[]) => { let id = es.reduce((m: number, e: Entry) => Math.max(m, e.id), 0); return [...es, ...fresh.map((q: [string, number]) => ({ id: ++id, t: q[0], w: q[1] }))]; });
    if (Object.keys(r.stamps).length) setStamps((st: Record<string, Stamp>) => { const o = { ...st }; for (const k of Object.keys(r.stamps)) { const c = o[k] || { meal: false, ex: false }; o[k] = { meal: c.meal || r.stamps[k].meal, ex: c.ex || r.stamps[k].ex }; } return o; });
    setImpText("");
    setImpMsg(`✓ ${r.items.length.toLocaleString("ko-KR")}개 읽음 · 새로 ${fresh.length.toLocaleString("ko-KR")}개 추가${r.items.length - fresh.length > 0 ? ` (중복 ${(r.items.length - fresh.length).toLocaleString("ko-KR")}개 건너뜀)` : ""}${r.bad ? ` · 읽지 못한 줄 ${r.bad}개` : ""}`);
  };
  const onFile = (ev: ChangeEvent<HTMLInputElement>): void => {
    const f = ev.target.files && ev.target.files[0];
    if (!f) return;
    const rd = new FileReader();
    rd.onload = () => { doImport(String(rd.result || ""), `‘${f.name}’`); };
    rd.onerror = () => setImpMsg("파일을 읽지 못했어요.");
    rd.readAsText(f, "utf-8");
    ev.target.value = "";
  };
  const field: CSSProperties = { font: "inherit", fontSize: 16, padding: "10px 12px", borderRadius: theme.radius.md, border: `1px solid ${theme.border.default}`, background: theme.bg.base, color: theme.text.primary, width: "100%", boxSizing: "border-box", colorScheme: CS };
  const stampBtn = (on: boolean, text: string, onClick: () => void) => (
    <button onClick={onClick} style={{ minWidth: 72, minHeight: 40, padding: "6px 12px", borderRadius: theme.radius.full, fontFamily: theme.font.family, fontSize: 14, cursor: "pointer", border: `1px solid ${on ? theme.text.accent : theme.border.default}`, background: on ? theme.fill.accentSubtle : "transparent", color: on ? theme.text.accent : theme.text.tertiary }}>
      {on ? `${text} ✓` : text}
    </button>
  );
  const recent = [...S.sorted].reverse().slice(0, listN);
  const yearRows = Array.from(S.years.entries()).reverse().map(([yk, yr]: [string, { days: number; am: number[]; lo: number; hi: number }]) => {
    const m = mean(yr.am);
    return [yk, `${yr.days}일`, m !== null ? `${kg(m)}kg` : "—", `${kg(yr.lo)}kg`, `${kg(yr.hi)}kg`];
  });
  const lastAmDay = [...S.days].reverse().find((d: DayRec) => d.am !== null);

  return (
    <Page title="나의 심플 다이어트" lang="ko" width="column" fill={view === "graph"} animKey={nav.n} anim={nav.dir}>
      {storageOk ? null : <div role="alert" onClick={() => go("settings")} style={{ flex: "0 0 auto", padding: "6px 10px", fontSize: 13, fontWeight: 700, textAlign: "center", color: "#ffffff", background: TONE.danger, cursor: "pointer" }}>저장소에 쓰지 못했어요 · CSV로 백업해 주세요 ▸</div>}
      {view === "entry" ? (() => {
        const dk0 = dkSel;
        const lastT = S.last ? S.last.t : "";
        const h12 = (t: string): string => { const hh = Number(t.slice(8, 10)), mi = t.slice(10, 12); return `${hh % 12 === 0 ? 12 : hh % 12}:${mi}${hh < 12 ? "AM" : "PM"}`; };
        const prevW = S.last ? kg(S.last.w) : "0.0";
        const [pi, pd] = prevW.split(".");
        const curTxt = val ? (val.length <= 2 ? val + "_ " : fmtDigits(val)) : "0";
        const dk = mode === "dark";
        const pageBg = dk ? "linear-gradient(#2a2a2d, #1c1c1e)" : "linear-gradient(#f6f6f6, #e3e3e3)";
        const frame: CSSProperties = { borderRadius: 6, padding: 4, background: dk ? "linear-gradient(#3a3a3d,#2c2c2f)" : "linear-gradient(#ececec,#dadada)", border: `1px solid ${dk ? "#46464a" : "#cdcdcd"}`, display: "flex", minHeight: 0 };
        const face: CSSProperties = { flex: "1 1 auto", borderRadius: 3, border: `1px solid ${dk ? "#4c4c50" : "#d6d6d6"}`, background: dk ? "linear-gradient(#45454a,#38383c)" : "linear-gradient(#ffffff,#f2f2f2)", boxShadow: dk ? "0 2px 3px rgba(0,0,0,0.5)" : "0 2px 3px rgba(0,0,0,0.13), inset 0 -2px 0 rgba(0,0,0,0.04)", color: dk ? "#e4e1de" : "#6e6964", fontSize: 44, fontFamily: theme.font.family, fontWeight: 400, cursor: "pointer", padding: 0, display: "flex", alignItems: "center", justifyContent: "center", touchAction: "manipulation", WebkitTapHighlightColor: "transparent", minHeight: 0 };
        const icons: { k: string; label: string; el: ReactNode }[] = [
          { k: "records", label: "기록 목록", el: <IconTicket /> },
          { k: "settings", label: "설정·내보내기", el: <IconTray /> },
          { k: "menu", label: "메뉴·설정", el: <IconGear /> },
          { k: "graph", label: "그래프 보기", el: <IconChart /> },
          { k: "summary", label: "요약·피드백", el: <IconClock /> },
        ];
        const info = flash ? flash : existing ? `이 날 ${slot === "am" ? "오전" : "오후"} ${kg(existing.w)}kg → OK 시 교체` : "";
        return (
        <div ref={entryRef} tabIndex={0} onKeyDown={onKey} style={{ outline: "none", margin: "-8px -10px -6px", flex: "1 1 0", minHeight: 0, display: "flex", flexDirection: "column", background: pageBg }}>
          <div style={{ position: "relative", overflow: "hidden", flex: "0 0 auto", height: 104, background: "linear-gradient(100deg, #8f9ca4 0%, #75848d 48%, #8d9aa2 52%, #a3aeb4 100%)", boxShadow: "inset 0 -3px 0 rgba(0,0,0,0.18), 0 1px 0 #ffffff", color: "#ffffff", display: "flex" }}>
            <div style={{ position: "absolute", left: -30, top: 12, width: 110, transform: "rotate(-45deg)", background: "linear-gradient(#ff6f7d,#e1475a)", color: "#ffffff", fontSize: 12, fontWeight: 700, textAlign: "center", padding: "2px 0", boxShadow: "0 1px 2px rgba(0,0,0,0.3)" }}>Weight</div>
            <div style={{ flex: "0 0 42%", padding: "10px 0 0 44px", display: "flex", flexDirection: "column", gap: 4, minWidth: 0 }}>
              <span style={{ fontSize: 11, whiteSpace: "nowrap" }}>{`이전  ${lastT ? `${Number(lastT.slice(4, 6))}/${Number(lastT.slice(6, 8))} ${h12(lastT)}` : "—"}`}</span>
              <div style={{ display: "flex", alignItems: "flex-end", gap: 2 }}>
                <Seg7 text={pi + "."} ghost="88." h={34} color="#ffffff" />
                <div style={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 2 }}>
                  <Seg7 text={pd} ghost="8" h={18} color="#ffffff" />
                  <span style={{ fontSize: 12, lineHeight: "12px" }}>kg</span>
                </div>
              </div>
            </div>
            <div style={{ flex: "1 1 auto", padding: "8px 10px 0 4px", display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, whiteSpace: "nowrap" }}>
                <span style={{ background: "#4b555b", padding: "0 5px", borderRadius: 2, fontSize: 10, fontWeight: 700 }}>{editId !== null ? "수정" : "체중"}</span>
                <label style={{ position: "relative", cursor: "pointer", textDecoration: "underline dotted", textUnderlineOffset: 3 }}>
                  {dk0.length === 8 ? `${dk0.slice(0, 4)}/${dk0.slice(4, 6)}/${dk0.slice(6, 8)}` : "날짜"}
                  <input type="date" value={dDate} onChange={(e: ChangeEvent<HTMLInputElement>) => { if (e.target.value) setDDate(e.target.value); }} aria-label="날짜 바꾸기" style={{ position: "absolute", inset: 0, opacity: 0, width: "100%", height: "100%", cursor: "pointer", colorScheme: "light" }} />
                </label>
              </div>
              <div style={{ display: "flex", gap: 3 }}>
                {(["am", "pm"] as ("am" | "pm")[]).map((sl: "am" | "pm") => (
                  <button key={sl} onClick={() => setSlot(sl)} aria-pressed={slot === sl} style={{ border: "none", borderRadius: 2, padding: "1px 7px", fontSize: 11, fontWeight: 700, cursor: "pointer", fontFamily: theme.font.family, background: slot === sl ? "#ffffff" : "rgba(75,85,91,0.75)", color: slot === sl ? "#4b555b" : "#d7dde0", minHeight: 22 }}>{sl === "am" ? "오전" : "오후"}</button>
                ))}
              </div>
              <div style={{ display: "flex", alignItems: "flex-end", justifyContent: "flex-end", gap: 6, marginTop: -4 }}>
                <Seg7 text={curTxt} ghost="888.8" h={50} color="#ffffff" />
                <span style={{ fontSize: 15, paddingBottom: 2 }}>kg</span>
              </div>
            </div>
          </div>
          <div style={{ flex: "0 0 auto", margin: "10px 22px 6px", padding: "5px 6px", borderRadius: 6, background: dk ? "linear-gradient(#36363a,#2c2c2f)" : "linear-gradient(#fbfbfb,#ececec)", border: `1px solid ${dk ? "#46464a" : "#d9d9d9"}`, boxShadow: "inset 0 1px 0 rgba(255,255,255,0.6)", display: "flex", justifyContent: "space-around" }}>
            {icons.map((ic: { k: string; label: string; el: ReactNode }) => (
              <button key={ic.k} onClick={() => go(ic.k)} aria-label={ic.label} style={{ background: "transparent", border: "none", padding: "2px 4px", cursor: "pointer", minWidth: 44, minHeight: 40, display: "flex", alignItems: "center", justifyContent: "center", touchAction: "manipulation" }}>{ic.el}</button>
            ))}
          </div>
          <div style={{ position: "relative", flex: "1 1 0", minHeight: 0, margin: "0 22px", display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gridTemplateRows: "repeat(4, 1fr) 0.72fr", columnGap: 22, rowGap: 14, padding: "6px 0 14px" }}>
            <svg aria-hidden="true" width="100%" height="100%" preserveAspectRatio="none" viewBox="0 0 300 100" style={{ position: "absolute", inset: "0 -14px", width: "calc(100% + 28px)", height: "100%", pointerEvents: "none" }}>
              {[0, 107.3, 192.7, 300].map((xx: number, i: number) => <line key={i} x1={xx} x2={xx} y1={0} y2={100} stroke={dk ? "#48484c" : "#cfcfcf"} strokeWidth={1} strokeDasharray="2 3" vectorEffect="non-scaling-stroke" />)}
            </svg>
            {["1", "2", "3", "4", "5", "6", "7", "8", "9", "C", "0", "del"].map((k: string) => (
              <div key={k} style={{ ...frame, position: "relative" }}>
                <KeyPadBtn onClick={() => (k === "C" ? (setFlash(""), setVal("")) : press(k))} style={k === "del" ? { ...face, fontSize: 28 } : face} label={k === "del" ? "지우기" : k === "C" ? "전체 지우기" : k}>{k === "del" ? "⌫" : k}</KeyPadBtn>
              </div>
            ))}
            <div style={{ gridColumn: "1 / span 2", alignSelf: "center", fontSize: 12.5, fontWeight: 600, lineHeight: 1.35, color: flash && flash.indexOf("✓") === 0 ? (dk ? "#5fd38a" : "#1a7f37") : (dk ? "#c7c7cc" : "#5a5550"), position: "relative" }}>
              {info}
              {editId !== null ? <button onClick={(e: { stopPropagation: () => void }) => { e.stopPropagation(); cancelEdit(); }} style={{ marginLeft: 6, fontSize: 12, padding: "2px 8px", borderRadius: 4, border: `1px solid ${dk ? "#55555a" : "#c9c9c9"}`, background: "transparent", color: "inherit", cursor: "pointer" }}>수정 취소</button> : null}
            </div>
            <div style={{ ...frame, gridColumn: "3" }}>
              <KeyPadBtn onClick={save} label={editId !== null ? "수정 확인" : "확인"} style={{ ...face, background: "linear-gradient(#7a736e,#5f5955)", border: "1px solid #4f4a46", color: "#ffffff", fontSize: 30, fontWeight: 800, letterSpacing: 0.5 }}>OK</KeyPadBtn>
            </div>
          </div>
        </div>
        );
      })() : null}
      {view === "menu" ? (<Section id="menu">
        <div style={{ display: "flex", gap: 8 }}><Button label="← 체중 기록으로" variant="primary" onClick={() => go("entry")} /></div>
        <div style={{ display: "flex", flexDirection: "column", gap: 6, width: "100%", maxWidth: 460, margin: "0 auto" }}>
          {[
            { k: "summary", t: "요약·피드백", d: S.avg7 !== null ? `7일 평균 ${kg(S.avg7)}kg` : "이번 주 요약" },
            { k: "stamps", t: "식사·운동 체크", d: `이번 주 식사 ${mealCnt} · 운동 ${exCnt}` },
            { k: "records", t: "기록 목록", d: `${entries.length.toLocaleString("ko-KR")}개 · 수정·삭제` },
            { k: "years", t: "연도별 요약", d: `${S.years.size}년` },
            { k: "settings", t: "설정·내보내기", d: `목표 ${kg(goal)} · CSV` },
            { k: "import", t: "기록 가져오기", d: "CSV 파일 또는 붙여넣기" },
          ].map((m: { k: string; t: string; d: string }) => (
            <button key={m.k} onClick={() => go(m.k)} style={{ textAlign: "left", padding: "8px 12px", minHeight: 54, borderRadius: theme.radius.lg, border: `1px solid ${theme.border.default}`, background: theme.bg.base, cursor: "pointer", fontFamily: theme.font.family, display: "flex", flexDirection: "column", gap: 4 }}>
              <span style={{ fontSize: 14, color: theme.text.primary, fontWeight: theme.weight.semibold }}>{m.t}</span>
              <span style={{ fontSize: 11, color: theme.text.tertiary }}>{m.d}</span>
            </button>
          ))}
        </div>
      </Section>) : null}

      {view !== "entry" && view !== "graph" && view !== "menu" && !(view === "import" && entries.length === 0) ? (
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button label="← 체중 기록으로" variant="primary" onClick={() => go("entry")} />
        </div>
      ) : null}

      {view === "summary" ? (<Section heading="요약과 이번 주 피드백" id="summary">
        <Text>{S.avg7 !== null ? `최근 7일 평균은 ${kg(S.avg7)}kg${remaining !== null && remaining > 0 ? `, 목표까지 ${kg(remaining)}kg 남았어요.` : "이에요."}` : "최근 7일 기록이 없어요. 체중을 기록하면 평균이 계산돼요."}</Text>
        <Metrics metrics={[
          { label: "최근 체중", value: S.last ? `${kg(S.last.w)}kg` : "—", detail: S.last ? `${fmtShort(S.last.t.slice(0, 8))} ${fmtTime(S.last.t)} · ${tagOf(S.last.t)}` : undefined },
          { label: "7일 평균 (전체)", value: S.avg7 !== null ? `${kg(S.avg7)}kg` : "—", detail: S.avg7 !== null && S.prev7 !== null ? `지난 7일 ${kg(S.prev7)}kg 대비 ${signed(S.avg7 - S.prev7)}` : undefined, tone: S.avg7 !== null && S.prev7 !== null ? (S.avg7 - S.prev7 <= -0.1 ? "success" : S.avg7 - S.prev7 >= 0.25 ? "warning" : undefined) : undefined },
          { label: "30일 변화", value: S.avg7 !== null && S.base30 !== null ? `${signed(S.avg7 - S.base30)}kg` : "—", detail: S.base30 !== null ? `7일 평균 기준 (30일 전 ${kg(S.base30)}kg)` : undefined },
          { label: "목표까지", value: remaining !== null ? (remaining > 0 ? `${kg(remaining)}kg` : "달성") : "—", detail: `목표 ${kg(goal)}kg` },
          { label: "최저 체중", value: S.low ? `${kg(S.low.w)}kg` : "—", detail: S.low ? `${fmtDay(S.low.t.slice(0, 8))} ${tagOf(S.low.t)}` : undefined },
          { label: "최고 체중", value: S.high ? `${kg(S.high.w)}kg` : "—", detail: S.high ? `${fmtDay(S.high.t.slice(0, 8))} ${tagOf(S.high.t)}` : undefined },
          { label: "연속 기록", value: `${S.streak}일`, detail: `${fmtShort(numToDk(S.anchor))}까지 매일 기록` },
        ]} />
        <Callout lead="이번 주 피드백">{feedback.join(" ")}</Callout>
      </Section>) : null}

      {view === "graph" ? (<div style={{ display: "flex", flexDirection: "column", gap: 4, width: "100%", flex: "1 1 0", minHeight: 0 }}>
        <div style={{ display: "flex", flexWrap: "nowrap", alignItems: "center", gap: 2, flex: "0 0 auto" }}>
          {roundBtn("←", "체중 기록으로", () => go("entry"))}
          {([["7", "7"], ["31", "31"], ["90", "90"], ["365", "1년"], ["all", "전체"]] as [RangeKey, string][]).map((o: [RangeKey, string]) => calBtn(o[0], o[1]))}
          <div style={{ flex: "1 1 4px" }} />
          <button onClick={() => setShowMa(!showMa)} aria-label="7일 평균선 켜기/끄기" style={{ flex: "0 0 auto", display: "none", alignItems: "center", gap: 3, padding: "2px 8px", minHeight: 38, whiteSpace: "nowrap", borderRadius: theme.radius.lg, border: `1px solid ${showMa ? AVG : theme.border.default}`, background: showMa ? "rgba(250,122,159,0.12)" : "transparent", color: showMa ? AVG : theme.text.secondary, cursor: "pointer", fontFamily: theme.font.family, fontSize: 14, fontWeight: 600 }}>
            평균 <span style={{ fontWeight: theme.weight.semibold }}>{showMa ? "ON" : "OFF"}</span>
          </button>
          {roundBtn("−", "축소", () => zoomBy(1.4))}
          {roundBtn("+", "확대", () => zoomBy(0.7))}
        </div>
        <GraphView readings={gReadings} slot={gSlot} onSlot={setGSlot} series={avgSeries} bucket={avgMode} note={avgMode === "raw" ? undefined : avgMode === "7" ? "주 평균 (7일 단위)" : avgMode === "30" ? "월 평균" : "분기 평균 (3개월)"} ma={S.ma} showMa={false} goal={goal} end={vEnd} span={vSpan} todayN={todayN} onView={setView2} plan={plan.on && planCalc ? planCalc.pts : undefined} planCfg={plan.on && planCalc && planW0 !== null && plan.start !== null ? { start: plan.start, w0: planW0, segs: plan.segs && plan.segs.length ? plan.segs : DEFAULT_SEGS } : null} onPlanCommit={(c: PlanDraft) => setPlan((pl: PlanCfg) => ({ ...pl, start: c.start, w0: c.w0, segs: c.segs }))} pulse={gPulse} onEdit={openGEdit} onDelete={(id: number) => { setEntries((es: Entry[]) => es.filter((e: Entry) => e.id !== id)); if (editId === id) cancelEdit(); }} />
        <div style={{ flex: "0 0 auto", display: "flex", flexWrap: "nowrap", alignItems: "center", gap: 6, padding: "4px 2px 0", borderTop: `1px solid ${DIV}` }}>
          <svg width="30" height="26" viewBox="0 0 30 26" aria-hidden="true"><rect x="1" y="1" width="28" height="24" rx="5" fill={PANEL} stroke={AVG} strokeWidth={2} /><path d="M6 19 L12 12 L17 15 L24 7" fill="none" stroke={AVG} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" /></svg>
          <span style={{ fontSize: 15, fontWeight: 700, color: AVG, marginRight: "auto", whiteSpace: "nowrap" }}>평균</span>
          {["raw", "7", "30", "90"].map((m: string) => {
            const on = avgMode === m;
            return <button key={m} onClick={() => setAvgMode(m)} aria-pressed={on} style={{ flex: "0 0 auto", minWidth: 48, height: 38, padding: "0 10px", borderRadius: 10, border: `1px solid ${on ? AVG : C.border}`, background: on ? AVG : PANEL, color: on ? "#ffffff" : INK, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{m === "raw" ? "원본" : m}</button>;
          })}
        </div>
        <div style={{ display: "none" }}>
          <button onClick={() => setShowMa(!showMa)} style={{ display: "none", alignItems: "center", gap: 6, padding: "6px 12px", minHeight: 40, borderRadius: theme.radius.lg, border: `1px solid ${showMa ? theme.text.accent : theme.border.default}`, background: showMa ? theme.fill.accentSubtle : "transparent", color: showMa ? theme.text.accent : theme.text.secondary, cursor: "pointer", fontFamily: theme.font.family, fontSize: 15 }}>
            <svg width="26" height="20" viewBox="0 0 26 20" aria-hidden="true"><path d="M2 16 L9 9 L15 12 L24 3" fill="none" stroke={AVG} strokeWidth={2.5} strokeLinecap="round" strokeLinejoin="round" /></svg>
            평균 <span style={{ fontWeight: theme.weight.semibold }}>{showMa ? "ON" : "OFF"}</span>
          </button>
          <span style={{ fontSize: 15, color: theme.text.secondary }}>○ 오전   ● 오후</span>
        </div>
        {gEdit ? (() => {
          const w = digitsToKg(gEdit.d);
          const okW = commitKg(gEdit.d) >= 20 && commitKg(gEdit.d) <= 300;
          const am = gEdit.slot === "am";
          const dk = gEdit.date.replace(/[^0-9]/g, "");
          const clash = entries.find((q: Entry) => q.id !== gEdit.id && q.t.slice(0, 8) === dk && isAM(q.t) === am);
          const sb = (s: "am" | "pm", label: string) => <button key={s} onClick={() => setGEdit({ ...gEdit, slot: s, ask: false })} aria-pressed={gEdit.slot === s} style={{ flex: "1 1 0", height: 40, borderRadius: 10, border: `1px solid ${gEdit.slot === s ? AVG : C.border}`, background: gEdit.slot === s ? AVG : PANEL, color: gEdit.slot === s ? "#ffffff" : C.ink, fontSize: 15, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>{label}</button>;
          return (
            <div onClick={() => setGEdit(null)} style={{ position: "fixed", inset: 0, zIndex: 40, background: "rgba(0,0,0,0.35)", display: "flex", alignItems: "center", justifyContent: "center", padding: 16 }}>
              <div role="dialog" aria-label="기록 편집" onClick={(ev: { stopPropagation: () => void }) => ev.stopPropagation()} style={{ width: "100%", maxWidth: 340, boxSizing: "border-box", background: PANEL, color: C.ink, borderRadius: 16, padding: 14, display: "flex", flexDirection: "column", gap: 10, boxShadow: "0 8px 30px rgba(0,0,0,0.3)", fontFamily: theme.font.family }}>
                <div style={{ fontSize: 17, fontWeight: 700 }}>기록 편집</div>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: C.sub }}>날짜
                  <input type="date" value={gEdit.date} onChange={(ev: ChangeEvent<HTMLInputElement>) => setGEdit({ ...gEdit, date: ev.target.value, ask: false })} aria-label="편집 날짜" style={field} />
                </label>
                <div style={{ display: "flex", gap: 8 }}>{sb("am", "오전 ○")}{sb("pm", "오후 ●")}</div>
                <label style={{ display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: C.sub }}>체중 (숫자만 · 73 → 73 · 739 → 73.9)
                  <input type="text" inputMode="numeric" value={gEdit.d ? fmtDigits(gEdit.d) : ""} placeholder="0.0" onChange={(ev: ChangeEvent<HTMLInputElement>) => { const d = ev.target.value.replace(/[^0-9]/g, "").replace(/^0+/, "").slice(0, 3); setGEdit({ ...gEdit, d, ask: false }); }} aria-label="편집 체중" style={{ ...field, fontSize: 22, fontWeight: 700, textAlign: "right" }} />
                </label>
                {!okW && gEdit.d ? <div style={{ fontSize: 13, color: TONE.danger }}>20.0~300.0kg 사이로 입력해 주세요.</div> : null}
                {gEdit.ask && clash ? <div style={{ fontSize: 13, fontWeight: 600, color: TONE.danger }}>{`이 날 ${am ? "오전" : "오후"}에 이미 ${kg(clash.w)}kg 기록이 있어요. 덮어쓸까요?`}</div> : null}
                <div style={{ display: "flex", gap: 8 }}>
                  {gEdit.ask && clash
                    ? <button onClick={() => gEditSave(true)} style={{ flex: "1 1 0", height: 44, borderRadius: 10, border: "none", background: WARN_TX, color: "#ffffff", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>덮어쓰기</button>
                    : <button onClick={() => gEditSave(false)} disabled={!okW || dk.length !== 8} style={{ flex: "1 1 0", height: 44, borderRadius: 10, border: "none", background: okW ? AVG : C.border, color: "#ffffff", fontSize: 16, fontWeight: 700, cursor: okW ? "pointer" : "default", fontFamily: "inherit" }}>저장</button>}
                  <button onClick={() => setGEdit(null)} style={{ flex: "1 1 0", height: 44, borderRadius: 10, border: `1px solid ${C.border}`, background: PANEL, color: C.ink, fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: "inherit" }}>취소</button>
                </div>
              </div>
            </div>
          );
        })() : null}
      </div>) : null}

      {view === "stamps" ? (<Section heading="식사·운동 체크" id="stamps" caption="탭해서 그날 식단을 지켰는지, 운동했는지 도장을 찍어요.">
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          {weekStamps.map((dk: string) => {
            const st = stamps[dk] || { meal: false, ex: false };
            const dr = S.days.find((d: DayRec) => d.dk === dk);
            return (
              <div key={dk} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "6px 0", borderBottom: `1px solid ${theme.border.subtle}` }}>
                <span style={{ minWidth: 76, color: theme.text.primary, fontSize: 15 }}>{fmtShort(dk)} ({wdOf(dayNum(dk))})</span>
                <span style={{ flex: "1 1 120px", color: theme.text.tertiary, fontSize: 13 }}>{dr ? [dr.am !== null ? `○ ${kg(dr.am)}` : "", dr.pm !== null ? `● ${kg(dr.pm)}` : ""].filter((s: string) => s).join("  ") : ""}</span>
                {stampBtn(st.meal, "식사", () => toggleStamp(dk, "meal"))}
                {stampBtn(st.ex, "운동", () => toggleStamp(dk, "ex"))}
              </div>
            );
          })}
        </div>
      </Section>) : null}

      {view === "records" ? (<Section heading="기록 목록" id="records" caption="삭제는 한 번 더 눌러야 확정돼요.">
        <div style={{ display: "flex", flexDirection: "column" }}>
          {recent.map((e: Entry) => (
            <div key={e.id} style={{ display: "flex", flexWrap: "wrap", alignItems: "center", gap: 8, padding: "8px 0", borderBottom: `1px solid ${theme.border.subtle}`, background: editId === e.id ? theme.fill.hover : "transparent" }}>
              <span style={{ flex: "1 1 150px", color: theme.text.primary, fontSize: 15 }}>{fmtDay(e.t.slice(0, 8))} ({wdOf(dayNum(e.t.slice(0, 8)))}) {fmtTime(e.t)}</span>
              <span style={{ minWidth: 56, color: theme.text.secondary, fontSize: 14 }}>{tagOf(e.t)}</span>
              <span style={{ minWidth: 64, textAlign: "right", color: theme.text.primary, fontSize: 16, fontVariantNumeric: "tabular-nums" }}>{kg(e.w)}kg</span>
              <Button label="수정" onClick={() => startEdit(e)} />
              <Button label={delId === e.id ? "삭제 확인" : "삭제"} onClick={() => remove(e.id)} />
            </div>
          ))}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          {listN < S.sorted.length ? <Button label="20개 더 보기" onClick={() => setListN(listN + 20)} /> : null}
          {listN > 10 ? <Button label="접기" onClick={() => setListN(10)} /> : null}
        </div>
      </Section>) : null}

      {view === "years" ? (<Section heading="연도별 요약" id="years">
        <Table columns={["연도", "기록일", "평균", "최저", "최고"]} rows={yearRows} align={["start", "end", "end", "end", "end"]} />
        {lastAmDay ? <Text>{`가장 최근 오전 체중은 ${fmtDay(lastAmDay.dk)} ${kg(lastAmDay.am as number)}kg이에요.`}</Text> : null}
      </Section>) : null}

      {view === "import" ? (<Section heading={entries.length ? "기록 가져오기" : "심플 다이어트 시작하기"} id="import">
        <Text>{entries.length ? `지금 ${entries.length.toLocaleString("ko-KR")}개 기록이 있어요. 가져온 기록은 합쳐지고, 같은 기록은 건너뛰어요.` : "예전 기록을 가져오면 그래프와 요약이 바로 채워져요. 기록은 이 아이폰 안에만 저장돼요."}</Text>
        <label style={{ display: "flex", alignItems: "center", justifyContent: "center", minHeight: 48, borderRadius: theme.radius.lg, background: AVG, color: "#ffffff", fontSize: 16, fontWeight: 700, cursor: "pointer", fontFamily: theme.font.family }}>
          파일에서 가져오기 (CSV)
          <input type="file" accept=".csv,.txt,text/csv,text/plain,text/comma-separated-values" onChange={onFile} style={{ display: "none" }} aria-label="가져올 CSV 파일" />
        </label>
        <textarea value={impText} onChange={(e: ChangeEvent<HTMLTextAreaElement>) => setImpText(e.target.value)} rows={4} placeholder={"또는 여기에 붙여넣기\n2026-01-01 20:00,70.0\n2026/01/01 7:00:00\t70.0"} style={{ ...field, fontFamily: theme.font.mono, fontSize: 13 }} aria-label="붙여넣을 기록" />
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button label="붙여넣은 글 가져오기" variant="primary" disabled={!impText.trim()} onClick={() => doImport(impText, "붙여넣은 글")} />
          {entries.length ? <Button label="체중 기록으로" onClick={() => go("entry")} /> : <Button label="빈 상태로 시작" onClick={() => go("entry")} />}
        </div>
        {impMsg ? <div role="status" style={{ fontSize: 14, fontWeight: 600, color: impMsg.indexOf("✓") === 0 ? TONE.success : TONE.danger }}>{impMsg}</div> : null}
        {impMsg.indexOf("✓") === 0 && entries.length ? <Button label="체중 기록 시작 →" variant="primary" onClick={() => go("entry")} /> : null}
      </Section>) : null}

      {view === "settings" ? (<Section heading="설정과 내보내기" id="settings">
        <Callout lead="저장">{storageOk ? `모든 기록(${entries.length.toLocaleString("ko-KR")}개)은 이 아이폰 안에 자동 저장돼요${syncUi.token ? " (GitHub 동기화 켜짐)" : ""}. 가끔 CSV로 백업해 두세요.` : "저장소에 쓰지 못했어요. CSV로 백업해 주세요."}</Callout>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button label="기록 가져오기" onClick={() => { setImpMsg(""); go("import"); }} />
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}` }}>
          <div style={{ fontSize: 15, fontWeight: 700, color: C.ink }}>동기화 (GitHub)</div>
          {syncUi.token ? (<>
            <div style={{ fontSize: 13, color: C.sub }}>{`${syncUi.owner}/${syncUi.repo} · records.json`}</div>
            <div role="status" style={{ fontSize: 13, fontWeight: 600, color: syncing ? C.sub : syncUi.err ? TONE.danger : TONE.success }}>
              {syncing ? "동기화 중…" : syncUi.err ? syncUi.err : syncUi.last ? (() => { const d = new Date(syncUi.last as number); return `✓ 마지막 동기화 ${d.getMonth() + 1}/${d.getDate()} ${pad(d.getHours())}:${pad(d.getMinutes())}${(syncUi.up || 0) + (syncUi.down || 0) > 0 ? ` · 올림 ${syncUi.up || 0} · 받음 ${syncUi.down || 0}` : " · 변경 없음"}`; })() : "아직 동기화 전이에요."}
            </div>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              <Button label="지금 동기화" variant="primary" disabled={syncing} onClick={() => scheduleSync(0)} />
              <Button label={tokCopied ? "복사됨" : "토큰 복사"} onClick={() => { void copyToken(); }} />
              <Button label="토큰 삭제" onClick={() => { syncRef.current = { ...syncRef.current, token: "", err: "", last: undefined }; setSyncUi({ ...syncRef.current }); setSyncVer((v: number) => v + 1); }} />
            </div>
            <div style={{ fontSize: 12, color: C.sub }}>운동 앱 설정 &gt; 심플다이어트 체중에 붙여넣으세요</div>
          </>) : (<>
            <div style={{ fontSize: 13, color: C.sub, lineHeight: 1.4 }}>개인 저장소와 기록을 주고받아요. GitHub 토큰(해당 저장소 Contents 읽기·쓰기)을 한 번만 붙여넣으세요. 토큰은 이 아이폰에만 저장돼요.</div>
            <input type="password" value={tokIn} onChange={(e: ChangeEvent<HTMLInputElement>) => setTokIn(e.target.value.trim())} placeholder="github_pat_…" autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label="GitHub 토큰" style={field} />
            <input type="text" value={repoIn} onChange={(e: ChangeEvent<HTMLInputElement>) => setRepoIn(e.target.value.trim())} autoComplete="off" autoCapitalize="off" spellCheck={false} aria-label="저장소 (owner/repo)" style={field} />
            <div style={{ display: "flex", gap: 8 }}>
              <Button label="연결하고 동기화" variant="primary" disabled={!tokIn || !/^[^/\s]+\/[^/\s]+$/.test(repoIn)} onClick={() => { const [o, r] = repoIn.split("/"); syncRef.current = { ...syncRef.current, token: tokIn, owner: o, repo: r, err: "" }; setTokIn(""); setSyncUi({ ...syncRef.current }); setSyncVer((v: number) => v + 1); scheduleSync(0); }} />
            </div>
          </>)}
        </div>
        <div id="sd-goal-card" style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="26" height="10" aria-hidden="true"><line x1="1" y1="5" x2="25" y2="5" stroke={WARN_C} strokeWidth="2" strokeDasharray="8 5" /></svg>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginRight: "auto" }}>목표 체중</span>
            <div style={{ width: 120 }}><KgField value={goal} onChange={(v: number | null) => { if (v !== null) setGoal(v); }} label="목표 체중" style={{ ...field, textAlign: "right", fontWeight: 700 }} /></div>
            <span style={{ fontSize: 14, color: C.sub }}>kg</span>
          </div>
        </div>
        <div style={{ display: "flex", flexDirection: "column", gap: 8, padding: "10px 12px", borderRadius: 10, border: `1px solid ${C.border}` }}>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <svg width="26" height="10" aria-hidden="true"><line x1="1" y1="5" x2="25" y2="5" stroke={PLAN_C} strokeWidth="2" strokeDasharray="6 4" /></svg>
            <span style={{ fontSize: 15, fontWeight: 700, color: C.ink, marginRight: "auto" }}>목표 경로</span>
            <Button label={plan.on ? "표시 중" : "숨김"} variant={plan.on ? "primary" : "quiet"} onClick={() => setPlan({ ...plan, on: !plan.on })} />
          </div>
          <div style={{ display: "flex", gap: 8 }}>
            <label style={{ flex: "1 1 0", display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: C.sub }}>시작일
              <input type="date" value={plan.start ?? ""} onChange={(e: ChangeEvent<HTMLInputElement>) => { if (e.target.value) setPlan({ ...plan, start: e.target.value }); }} aria-label="목표 경로 시작일" style={field} />
            </label>
            <label style={{ flex: "1 1 0", display: "flex", flexDirection: "column", gap: 4, fontSize: 13, color: C.sub }}>시작 체중 (kg)
              <KgField value={plan.w0} onChange={(v: number | null) => setPlan({ ...plan, w0: v })} label="목표 경로 시작 체중" placeholder={planAuto !== null ? kg(planAuto) : "kg"} style={{ ...field, textAlign: "right" }} />
            </label>
          </div>
          <Button label={planAuto !== null ? `현재 7일 평균(${kg(planAuto)}kg)으로 오늘부터 다시 시작` : "현재 7일 평균으로 다시 시작"} disabled={planAuto === null} onClick={() => { if (planAuto !== null) setPlan({ ...plan, start: `${todayDk().slice(0, 4)}-${todayDk().slice(4, 6)}-${todayDk().slice(6, 8)}`, w0: planAuto }); }} />
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {(plan.segs && plan.segs.length ? plan.segs : DEFAULT_SEGS).map((g: PlanSeg, i: number, arr: PlanSeg[]) => {
              const setSeg = (ng: PlanSeg | null): void => { const list = [...arr]; if (ng) list[i] = ng; else list.splice(i, 1); setPlan({ ...plan, segs: list }); };
              const reach = planCalc ? planCalc.at[kg(g.until)] : undefined;
              return (
                <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 14, color: C.ink }}>
                  <div style={{ width: 78 }}><KgField value={g.until} onChange={(v: number | null) => { if (v !== null) setSeg({ ...g, until: v }); }} label={`구간 ${i + 1} 목표`} style={{ ...field, padding: "8px 8px", textAlign: "right" }} /></div>
                  <span style={{ whiteSpace: "nowrap" }}>kg까지</span>
                  <PerField value={g.per} onChange={(n: number) => setSeg({ ...g, per: n })} label={`구간 ${i + 1} 일수`} style={{ ...field, width: 52, padding: "8px 4px", textAlign: "center" }} />
                  <span style={{ whiteSpace: "nowrap", marginRight: "auto", display: "flex", flexDirection: "column", lineHeight: 1.2 }}><span>{`일 +0.1${reach !== undefined ? ` · ${fmtShort(numToDk(reach))}` : ""}`}</span><span style={{ fontSize: 11.5, fontWeight: 700, color: PLAN_C }}>{`${fmtRate(g.per)} · ${fmtWeek(g.per)}`}</span></span>
                  <button onClick={() => setSeg(null)} aria-label={`구간 ${i + 1} 삭제`} disabled={arr.length <= 1} style={{ width: 32, height: 32, borderRadius: 16, border: `1px solid ${C.border}`, background: PANEL, color: C.sub, fontSize: 16, cursor: "pointer", padding: 0 }}>×</button>
                </div>
              );
            })}
            <div style={{ display: "flex", gap: 8 }}>
              <Button label="+ 구간 추가" onClick={() => { const arr = plan.segs && plan.segs.length ? plan.segs : DEFAULT_SEGS; const last = arr[arr.length - 1]; setPlan({ ...plan, segs: [...arr, { until: roundKg(last.until + 1), per: Math.max(1, Math.round(last.per)) + 1 }] }); }} />
              <Button label="기본값" onClick={() => setPlan({ ...plan, segs: DEFAULT_SEGS })} />
            </div>
          </div>
          {planCalc ? <div style={{ fontSize: 12.5, color: C.sub, lineHeight: 1.45 }}>{`${kg(planW0 as number)}kg에서 시작 → ${Object.keys(planCalc.at).map((k: string) => `${k} (${fmtShort(numToDk(planCalc.at[k]))})`).join(" → ")} 이후 유지`}</div> : null}
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
          <span style={{ fontSize: 14, color: C.sub, marginRight: 4 }}>화면 모드</span>
          <Button label="화이트" variant={mode === "light" ? "primary" : "quiet"} onClick={() => setMode("light")} />
          <Button label="다크" variant={mode === "dark" ? "primary" : "quiet"} onClick={() => setMode("dark")} />
        </div>
        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
          <Button label="CSV 다운로드" variant="primary" onClick={download} />
          <Button label={showCsv ? "CSV 텍스트 닫기" : "CSV 텍스트 보기"} onClick={() => setShowCsv(!showCsv)} />
        </div>
        {showCsv ? <textarea readOnly value={csv} rows={6} style={{ ...field, fontFamily: theme.font.mono, fontSize: 12 }} aria-label="CSV 데이터" /> : null}
        <Text>CSV 다운로드를 누르면 공유 창이 열려요. ‘파일에 저장’을 고르면 백업돼요. 앱을 지우면 기록도 지워지니 백업 파일은 꼭 남겨 두세요.</Text>
      </Section>) : null}
    </Page>
  );
}
