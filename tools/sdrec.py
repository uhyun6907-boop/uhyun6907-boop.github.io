#!/usr/bin/env python3
"""심플 다이어트 records.json helper (private repo uhyun6907-boop/sd-data).

records.json format:
{
  "version": 1,
  "records": {
    "2026-10-30 오전": {"w":73.2,"time":"07:00","u":1761811200000},
    "2026-10-29 오후": {"w":72.8,"time":"17:10","u":0},
    "2026-10-28 오전": {"w":72.1,"time":"05:57","u":1761812000000,"del":true}
  }
}
key = "YYYY-MM-DD 오전|오후" (오전 = rules.json morningHours), w = kg (0.1), time = HH:MM,
u = updatedAt epoch ms (0 = original history), del = tombstone. Last write (higher u) wins per key.
"""
import datetime, json, os, re

with open(os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "src", "rules.json"), encoding="utf-8") as f:
    RULES = json.load(f)
KEY_RE = re.compile(r"^\d{4}-\d{2}-\d{2} (오전|오후)$")
TIME_RE = re.compile(r"^(\d{2}):(\d{2})$")
DATE_RE = re.compile(r"^\d{4}-\d{2}-\d{2}$")

def is_num(x):
    return isinstance(x, (int, float)) and not isinstance(x, bool)

def valid_kg(w):
    return is_num(w) and RULES["kgRange"][0] <= w <= RULES["kgRange"][1]

def valid_per(n):
    return is_num(n) and RULES["perRange"][0] <= n <= RULES["perRange"][1]

def valid_u(u):
    return isinstance(u, int) and not isinstance(u, bool) and u >= 0

def valid_date(s):
    if not isinstance(s, str) or not DATE_RE.match(s): return False
    try: datetime.date.fromisoformat(s); return True
    except ValueError: return False

def slot_of_hour(h):
    return "오전" if RULES["morningHours"][0] <= h < RULES["morningHours"][1] else "오후"

def fmt_w(w):
    w = round(float(w) * 10) / 10
    return int(w) if w == int(w) else w

def fmt_per(n):
    n = round(float(n), 4)
    return int(n) if n == int(n) else n

def rec_obj(w, time, u, dele=False):
    o = {"w": fmt_w(w), "time": time, "u": int(u)}
    if dele:
        o["del"] = True
    return o

def norm_rec(key, x):
    if not KEY_RE.match(key) or not isinstance(x, dict) or not valid_kg(x.get("w")) or not valid_u(x.get("u")) or not isinstance(x.get("time"), str): return None
    m = TIME_RE.match(x["time"])
    if not m or int(m[1]) > 23 or int(m[2]) > 59 or slot_of_hour(int(m[1])) != key[-2:]: return None
    if "del" in x and not isinstance(x["del"], bool): return None
    return rec_obj(x["w"], x["time"], x["u"], bool(x.get("del")))

def norm_settings(st):
    if not isinstance(st, dict) or not isinstance(st.get("plan"), dict) or not valid_kg(st.get("goal")) or not valid_u(st.get("u")): return None
    pl = st["plan"]
    if not isinstance(pl.get("on"), bool) or not (pl.get("start") is None or valid_date(pl.get("start"))) or not (pl.get("w0") is None or valid_kg(pl.get("w0"))) or not isinstance(pl.get("segs"), list): return None
    segs = []
    for g in pl["segs"]:
        if not isinstance(g, dict) or not valid_kg(g.get("until")) or not valid_per(g.get("per")): return None
        segs.append({"until": fmt_w(g["until"]), "per": g["per"]})
    return {"goal": fmt_w(st["goal"]), "plan": {"on": pl["on"], "start": pl["start"], "w0": None if pl["w0"] is None else fmt_w(pl["w0"]), "segs": segs}, "u": st["u"]}

def default_settings():
    return {"goal": RULES["defaultGoalKg"], "plan": {"on": True, "start": None, "w0": None, "segs": [dict(g) for g in RULES["defaultPlanSegs"]]}, "u": 0}

def dumps(records, settings=None):
    keys = sorted(records)
    body = ",\n".join("    " + json.dumps(k, ensure_ascii=False) + ": " + json.dumps(records[k], ensure_ascii=False, separators=(",", ":")) for k in keys)
    st = ('  "settings": ' + json.dumps(settings, ensure_ascii=False, separators=(",", ":")) + ",\n") if settings else ""
    return '{\n  "version": 1,\n' + st + '  "records": {\n' + body + ("\n" if body else "") + "  }\n}\n"

def loads_full(text):
    try: d = json.loads(text) if text.strip() else {}
    except ValueError: raise SystemExit("records.json이 올바른 JSON이 아니에요. 파일을 고친 뒤 다시 실행해 주세요.")
    if not isinstance(d, dict) or not isinstance(d.get("records", {}), dict): raise SystemExit("records.json 형식이 아니에요. 파일을 고친 뒤 다시 실행해 주세요.")
    recs, bad = {}, []
    for k, v in d.get("records", {}).items():
        r = norm_rec(k, v)
        if r: recs[k] = r
        else: bad.append(k)
    settings = None if d.get("settings") is None else norm_settings(d["settings"])
    if d.get("settings") is not None and settings is None: bad.append("settings")
    if bad: raise SystemExit(f"records.json에 잘못된 값이 있어 멈췄어요: {', '.join(bad[:5])}" + (f" 외 {len(bad) - 5}개" if len(bad) > 5 else "") + ". 파일을 고친 뒤 다시 실행해 주세요.")
    return recs, settings
