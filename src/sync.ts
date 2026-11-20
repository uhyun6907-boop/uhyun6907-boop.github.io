import { isMorningHour, isValidKg, isValidPer, roundKg } from "./rules";

export type Rec = { w: number; time: string; u: number; del?: boolean };
export type RecMap = Record<string, Rec>;
export type PlanSeg = { until: number; per: number };
export type SettingsRec = { goal: number; plan: { on: boolean; start: string | null; w0: number | null; segs: PlanSeg[] }; u: number };
export type SyncCfg = { token: string; owner: string; repo: string; branch: string; path: string };

const KEY_RE = /^\d{4}-\d{2}-\d{2} (오전|오후)$/;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const isObj = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object" && !Array.isArray(x);
const isU = (x: unknown): x is number => typeof x === "number" && Number.isInteger(x) && x >= 0;
const isDate = (x: unknown): x is string => typeof x === "string" && DATE_RE.test(x) && !isNaN(Date.parse(x));

export function normRec(key: string, x: unknown): Rec | null {
  if (!KEY_RE.test(key) || !isObj(x) || !isValidKg(x.w) || !isU(x.u) || typeof x.time !== "string") return null;
  const m = /^(\d{2}):(\d{2})$/.exec(x.time);
  if (!m || Number(m[1]) > 23 || Number(m[2]) > 59 || isMorningHour(Number(m[1])) !== key.endsWith("오전")) return null;
  if (x.del !== undefined && typeof x.del !== "boolean") return null;
  return x.del ? { w: roundKg(x.w), time: x.time, u: x.u, del: true } : { w: roundKg(x.w), time: x.time, u: x.u };
}
export function normSettings(x: unknown): SettingsRec | null {
  if (!isObj(x) || !isObj(x.plan) || !isValidKg(x.goal) || !isU(x.u)) return null;
  const p = x.plan;
  if (typeof p.on !== "boolean" || !(p.start === null || isDate(p.start)) || !(p.w0 === null || isValidKg(p.w0)) || !Array.isArray(p.segs)) return null;
  const segs: PlanSeg[] = [];
  for (const g of p.segs as unknown[]) {
    if (!isObj(g) || !isValidKg(g.until) || !isValidPer(g.per)) return null;
    segs.push({ until: roundKg(g.until), per: g.per });
  }
  return { goal: roundKg(x.goal), plan: { on: p.on, start: p.start, w0: p.w0 === null ? null : roundKg(p.w0), segs }, u: x.u };
}

const pad = (n: number): string => (n < 10 ? "0" : "") + String(n);
export const slotOfT = (t: string): string => (isMorningHour(Number(t.slice(8, 10))) ? "오전" : "오후");
export const keyOfT = (t: string): string => `${t.slice(0, 4)}-${t.slice(4, 6)}-${t.slice(6, 8)} ${slotOfT(t)}`;
export const timeOfT = (t: string): string => `${t.slice(8, 10)}:${t.slice(10, 12)}`;
export const tOf = (key: string, time: string): string => key.slice(0, 4) + key.slice(5, 7) + key.slice(8, 10) + time.replace(":", "").slice(0, 4);
const same = (a?: Rec, b?: Rec): boolean => !!a && !!b && a.w === b.w && a.time === b.time && a.u === b.u && !!a.del === !!b.del;
const sameVal = (a?: Rec, b?: Rec): boolean => !!a && !!b && a.w === b.w && a.time === b.time && !!a.del === !!b.del;
const recJson = (r: Rec): string => JSON.stringify(r.del ? { w: r.w, time: r.time, u: r.u, del: true } : { w: r.w, time: r.time, u: r.u });
const settingsJson = (s: SettingsRec): string => JSON.stringify({ goal: s.goal, plan: { on: s.plan.on, start: s.plan.start, w0: s.plan.w0, segs: s.plan.segs.map((g: PlanSeg) => ({ until: g.until, per: g.per })) }, u: s.u });

export function dumps(recs: RecMap, settings: SettingsRec | null): string {
  const keys = Object.keys(recs).sort();
  const st = settings ? `  "settings": ${settingsJson(settings)},\n` : "";
  const body = keys.map((k: string) => `    ${JSON.stringify(k)}: ${recJson(recs[k])}`).join(",\n");
  return `{\n  "version": 1,\n${st}  "records": {\n${body}${body ? "\n" : ""}  }\n}\n`;
}
export function parseFull(text: string): { recs: RecMap; settings: SettingsRec | null } {
  let d: unknown;
  try { d = text.trim() ? JSON.parse(text) : {}; } catch (_e) { throw new SyncError("data", "records.json이 올바른 JSON이 아니에요. 파일을 고친 뒤 다시 동기화해 주세요."); }
  if (!isObj(d) || (d.records !== undefined && !isObj(d.records))) throw new SyncError("data", "records.json 형식이 아니에요. 파일을 고친 뒤 다시 동기화해 주세요.");
  const src = (d.records || {}) as Record<string, unknown>;
  const recs: RecMap = {};
  const bad: string[] = [];
  for (const k of Object.keys(src)) { const r = normRec(k, src[k]); if (r) recs[k] = r; else bad.push(k); }
  const settings = d.settings === undefined || d.settings === null ? null : normSettings(d.settings);
  if (d.settings && !settings) bad.push("settings");
  if (bad.length) throw new SyncError("data", `records.json에 잘못된 값이 있어 동기화를 멈췄어요: ${bad.slice(0, 5).join(", ")}${bad.length > 5 ? ` 외 ${bad.length - 5}개` : ""}. 파일을 고친 뒤 다시 동기화해 주세요.`);
  return { recs, settings };
}
export function merge(local: RecMap, remote: RecMap): { merged: RecMap; up: number; down: number } {
  const merged: RecMap = {};
  let up = 0, down = 0;
  const keys = new Set<string>([...Object.keys(local), ...Object.keys(remote)]);
  keys.forEach((k: string) => {
    const L = local[k], R = remote[k];
    let m: Rec;
    if (!R) m = L as Rec; else if (!L) m = R; else m = L.u > R.u ? L : L.u < R.u ? R : (sameVal(L, R) ? R : L);
    merged[k] = m;
    if (!same(m, R) && !(m.del && !R)) up++;
    if (!same(m, L) && !(m.del && !L)) down++;
  });
  return { merged, up, down };
}

function b64ToUtf8(b64: string): string {
  const bin = atob(b64.replace(/\s+/g, ""));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
  return new TextDecoder("utf-8").decode(bytes);
}
function utf8ToB64(s: string): string {
  const bytes = new TextEncoder().encode(s);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, Array.from(bytes.subarray(i, i + 0x8000)));
  return btoa(bin);
}
export class SyncError extends Error { code: string; constructor(code: string, msg: string) { super(msg); this.code = code; } }
const api = (c: SyncCfg): string => `https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}/contents/${c.path}`;
const hdr = (c: SyncCfg): Record<string, string> => ({ Authorization: `Bearer ${c.token}`, Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" });
async function req(url: string, init: RequestInit): Promise<Response> {
  try { return await fetch(url, { ...init, cache: "no-store" }); } catch (_e) { throw new SyncError("offline", "오프라인이거나 GitHub에 연결할 수 없어요. 연결되면 다시 동기화해요."); }
}
function httpErr(r: Response): SyncError {
  if (r.status === 401) return new SyncError("auth", "토큰이 올바르지 않거나 만료됐어요.");
  if (r.status === 403 || r.status === 404) return new SyncError("perm", `저장소에 접근할 수 없어요 (${r.status}). 토큰에 이 저장소의 Contents 읽기·쓰기 권한이 있는지 확인해 주세요.`);
  return new SyncError("http", `GitHub 오류 ${r.status}`);
}
export async function fetchRemote(c: SyncCfg): Promise<{ recs: RecMap; settings: SettingsRec | null; sha: string | null }> {
  const r = await req(`${api(c)}?ref=${encodeURIComponent(c.branch)}&t=${Date.now()}`, { headers: hdr(c) });
  if (r.status === 404) {
    const rr = await req(`https://api.github.com/repos/${encodeURIComponent(c.owner)}/${encodeURIComponent(c.repo)}`, { headers: hdr(c) });
    if (rr.ok) return { recs: {}, settings: null, sha: null };
    throw httpErr(rr);
  }
  if (!r.ok) throw httpErr(r);
  const j = await r.json();
  let text = "";
  if (j.content && j.encoding === "base64") text = b64ToUtf8(j.content);
  else {
    const raw = await req(`${api(c)}?ref=${encodeURIComponent(c.branch)}`, { headers: { ...hdr(c), Accept: "application/vnd.github.raw" } });
    if (!raw.ok) throw httpErr(raw);
    text = await raw.text();
  }
  const full = parseFull(text);
  return { recs: full.recs, settings: full.settings, sha: j.sha || null };
}
export async function putRemote(c: SyncCfg, recs: RecMap, settings: SettingsRec | null, sha: string | null, message: string): Promise<"ok" | "conflict"> {
  const body: Record<string, string> = { message, content: utf8ToB64(dumps(recs, settings)), branch: c.branch };
  if (sha) body.sha = sha;
  const r = await req(api(c), { method: "PUT", headers: { ...hdr(c), "Content-Type": "application/json" }, body: JSON.stringify(body) });
  if (r.status === 409 || r.status === 422) return "conflict";
  if (!r.ok) throw httpErr(r);
  return "ok";
}
export type RoundResult = { merged: RecMap; up: number; down: number; settings: SettingsRec | null; settingsDown: boolean };
export async function syncRound(c: SyncCfg, getLocal: () => RecMap, getSettings: () => SettingsRec | null): Promise<RoundResult> {
  for (let i = 0; i < 4; i++) {
    const { recs: remote, settings: rset, sha } = await fetchRemote(c);
    const local = getLocal();
    const lset = getSettings();
    const m = merge(local, remote);
    let settings: SettingsRec | null = rset, settingsUp = false, settingsDown = false;
    if (lset && (!rset || lset.u > rset.u)) { settings = lset; settingsUp = !rset || settingsJson(lset) !== settingsJson(rset); }
    else if (rset && lset && settingsJson(lset) !== settingsJson(rset)) settingsDown = true;
    else if (rset && !lset) settingsDown = true;
    const res: RoundResult = { ...m, up: m.up + (settingsUp ? 1 : 0), down: m.down + (settingsDown ? 1 : 0), settings, settingsDown };
    if (res.up === 0) return res;
    const now = new Date();
    const msg = `app sync ${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}: ${res.up} change(s)`;
    const r = await putRemote(c, res.merged, settings, sha, msg);
    if (r === "ok") return res;
  }
  throw new SyncError("conflict", "다른 기기와 동시에 저장돼 충돌이 났어요. 잠시 후 다시 시도해 주세요.");
}
