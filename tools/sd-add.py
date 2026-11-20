#!/usr/bin/env python3
"""Add / change / delete a weight in the private sd-data repo.

usage:
  sd-add 2026-10-30 오전 73.2            # add or overwrite
  sd-add 2026-10-30 오후 72.5 --time 21:10
  sd-add --delete 2026-10-30 오전         # tombstone (deletes on phone too)
  sd-add --show 2026-10-30                 # print that day's records
  sd-add --settings                        # print goal / plan settings
  sd-add --set-goal 76.0 [--plan-start 2026-10-31] [--plan-w0 72.4] [--segs 74:1,75:2,76:3] [--plan on|off]
  (today / 어제 accepted as dates; am/pm accepted for 오전/오후)
"""
import argparse, datetime, json, os, subprocess, sys, time
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
import sdrec

REPO = os.environ.get("SD_REPO", f"{sdrec.RULES['sync']['owner']}/{sdrec.RULES['sync']['repo']}")
WORK = os.environ.get("SD_WORK", os.path.expanduser("~/.cache/sd-data"))

def run(*a, cwd=WORK, check=True):
    return subprocess.run(a, cwd=cwd, check=check, capture_output=True, text=True)

def sync_repo():
    if not os.path.isdir(os.path.join(WORK, ".git")):
        os.makedirs(os.path.dirname(WORK), exist_ok=True)
        subprocess.run(["gh", "repo", "clone", REPO, WORK], check=True, capture_output=True, text=True)
        subprocess.run(["gh", "auth", "setup-git"], check=False, capture_output=True)
    run("git", "fetch", "origin")
    has_main = run("git", "rev-parse", "--verify", "origin/main", check=False).returncode == 0
    if has_main:
        run("git", "checkout", "-B", "main", "origin/main")
    return has_main

def norm_date(s):
    s = s.strip()
    today = datetime.date.today()
    if s in ("today", "오늘"): return today.isoformat()
    if s in ("yesterday", "어제"): return (today - datetime.timedelta(days=1)).isoformat()
    return datetime.date.fromisoformat(s.replace("/", "-").replace(".", "-")).isoformat()

def norm_slot(s):
    s = s.strip().lower()
    if s in ("오전", "am", "morning", "아침"): return "오전"
    if s in ("오후", "pm", "evening", "저녁", "밤"): return "오후"
    raise SystemExit(f"slot must be 오전/오후 (got {s})")

def main():
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--delete", action="store_true")
    ap.add_argument("--show", action="store_true")
    ap.add_argument("--time", help="HH:MM (default 07:00 오전 / 20:00 오후, or keep existing)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--settings", action="store_true")
    ap.add_argument("--set-goal", type=float)
    ap.add_argument("--plan-start"); ap.add_argument("--plan-w0", type=float); ap.add_argument("--segs"); ap.add_argument("--plan", choices=["on", "off"])
    ap.add_argument("args", nargs="*")
    o = ap.parse_args()
    for _ in range(3):
        sync_repo()
        path = os.path.join(WORK, "records.json")
        recs, settings = sdrec.loads_full(open(path, encoding="utf-8").read()) if os.path.exists(path) else ({}, None)
        if o.settings:
            print(json.dumps(settings, ensure_ascii=False, indent=1) if settings else "settings 없음 (앱에서 아직 동기화 전)"); return
        if o.set_goal is not None or o.plan_start or o.plan_w0 is not None or o.segs or o.plan:
            st = settings or sdrec.default_settings()
            if o.set_goal is not None: st["goal"] = sdrec.fmt_w(o.set_goal)
            if o.plan_start: st["plan"]["start"] = norm_date(o.plan_start)
            if o.plan_w0 is not None: st["plan"]["w0"] = sdrec.fmt_w(o.plan_w0)
            if o.segs: st["plan"]["segs"] = [{"until": sdrec.fmt_w(a.split(":")[0]), "per": sdrec.fmt_per(a.split(":")[1])} for a in o.segs.split(",")]
            if o.plan: st["plan"]["on"] = o.plan == "on"
            st["u"] = int(time.time() * 1000)
            if sdrec.norm_settings(st) is None: raise SystemExit(f"설정 값이 범위 밖이에요: {json.dumps(st, ensure_ascii=False)}")
            settings = st
            msg = f"settings: goal {st['goal']} plan {st['plan']['start']} {st['plan']['w0']} " + ",".join(f"{g['until']}:{g['per']}" for g in st['plan']['segs'])
            if o.dry_run: print("dry-run:", msg); return
            open(path, "w", encoding="utf-8").write(sdrec.dumps(recs, settings))
            run("git", "add", "records.json")
            run("git", "-c", "user.name=sd-add", "-c", "user.email=sd-add@users.noreply.github.com", "commit", "-m", msg)
            if run("git", "push", "origin", "HEAD:main", check=False).returncode == 0: print("✓", msg); return
            continue
        if o.show:
            d = norm_date(o.args[0])
            for k in sorted(recs):
                if k.startswith(d): print(k, recs[k])
            return
        d = norm_date(o.args[0]); sl = norm_slot(o.args[1]); key = f"{d} {sl}"
        now = int(time.time() * 1000)
        old = recs.get(key)
        if o.delete:
            if not old or old.get("del"): print(f"{key}: 기록 없음 (no change)"); return
            recs[key] = sdrec.rec_obj(old["w"], old["time"], now, True)
            msg = f"delete {key} (was {old['w']}kg)"
        else:
            w = float(o.args[2])
            if not sdrec.valid_kg(w): raise SystemExit(f"weight must be {sdrec.RULES['kgRange'][0]}-{sdrec.RULES['kgRange'][1]} kg")
            tm = o.time or (old.get("time") if old and not old.get("del") else None) or ("07:00" if sl == "오전" else "20:00")
            h = int(tm.split(":")[0])
            if sdrec.slot_of_hour(h) != sl: raise SystemExit(f"time {tm} is not in {sl}")
            recs[key] = sdrec.rec_obj(w, tm, now)
            msg = f"{'update' if old and not old.get('del') else 'add'} {key} {sdrec.fmt_w(w)}kg" + (f" (was {old['w']}kg)" if old and not old.get('del') else "")
        if o.dry_run: print("dry-run:", msg); return
        open(path, "w", encoding="utf-8").write(sdrec.dumps(recs, settings))
        run("git", "add", "records.json")
        run("git", "-c", "user.name=sd-add", "-c", "user.email=sd-add@users.noreply.github.com", "commit", "-m", msg)
        p = run("git", "push", "origin", "HEAD:main", check=False)
        if p.returncode == 0:
            print("✓", msg); return
        print("push rejected, retrying:", p.stderr.strip()[:200], file=sys.stderr)
    raise SystemExit("push failed 3 times")

if __name__ == "__main__":
    main()
