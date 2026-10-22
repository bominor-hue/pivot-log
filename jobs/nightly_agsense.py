"""Nightly pivot runs from the AgSense (WagNet) API, for pivots that have an AgSense unit.

Run by .github/workflows/nightly.yml each morning, once AgSense has issued the farm an API ID and key.
Until the AGSENSE_* secrets are set it prints a note and stops, so the nightly job stays green.

For each AgSense unit matched to a pivot (by the serial on the pivot, or its AgSense name) it reads
every reading of the last few days (GetDeviceStatus with start/stop) and turns them into runs: a run
starts at the first wet reading and stops at the first dry one. Each finished run is written to the
entry table as one 'run' entry (how 'agsense') with start, stop, direction, percent timer and start/stop
angle, so the app's water balance picks it up like a crew-logged past run. Entry ids come from the
serial and start time, so re-reading the same days never adds a run twice.

Wet means water ON (CommanderVP, ICON), pump ON (TrackerSP, Precision Link), or pressure above zero
(Field Commander with a sensor). Units with no wet signal, and pivots marked "AgSense reads dry"
(the 14 decided Oct 13, 2026), count power ON and moving forward or reverse as wet.
Runs still going at the last reading, and runs already wet at the first reading, are left for a later
night. A run overlapping an imported AgSense week (the CSV import) is skipped so water isn't counted twice.

Read-only: this job never sends anything to a pivot.

Needs SUPABASE_URL and SUPABASE_SERVICE_KEY, plus AGSENSE_USERNAME, AGSENSE_PASSWORD (a read-only
WagNet login), AGSENSE_APID, AGSENSE_KEY and AGSENSE_IV from AgSense.

Usage:
  python3 jobs/nightly_agsense.py                 last 7 days
  python3 jobs/nightly_agsense.py --start 2026-03-01
  python3 jobs/nightly_agsense.py --dry-run       print runs, write nothing
  python3 jobs/nightly_agsense.py --fixture readings.json --serial 50009   parse a saved response, no network
"""
import argparse, base64, datetime as dt, hashlib, json, os, sys, time, urllib.parse, urllib.request, uuid
from zoneinfo import ZoneInfo
from rijndael import cbc_encrypt

API = "https://api.wagnet.net/json/"
LOCAL = ZoneInfo("America/New_York")  # readings come back in the unit's local time
WHO = "AgSense API"
NS = uuid.UUID("5d0c3a52-9f7e-4d1b-a3f0-6a1b2c3d4e5f")  # entry ids = uuid5(NS, serial|start)
READS_DRY = "agsenseReadsDry"
MAX_GAP_H = 6  # a wet stretch with no reading for longer than this gets a note


class AgSense:
    def __init__(self, username, password, apid, key, iv):
        self.user, self.md5 = username, hashlib.md5(password.encode()).hexdigest()
        self.apid, self.key, self.iv = apid, key.encode(), iv.encode()

    def token(self):
        """A new token for every call: username,md5(password),UTC seconds, Rijndael-256 CBC, URL-safe base64."""
        text = f"{self.user},{self.md5},{int(time.time())}".encode()
        t = base64.b64encode(cbc_encrypt(self.key, self.iv, text)).decode()
        return t.replace("+", "-").replace("/", "_").replace("=", "%3D")

    def get(self, call, **params):
        q = urllib.parse.urlencode({"username": self.user, "apid": self.apid, **params})
        url = f"{API}{call}?{q}&token={self.token()}"  # token is already URL-safe
        with urllib.request.urlopen(url, timeout=120) as r:
            return json.loads(r.read())

    def devices(self):
        return units(self.get("GetDevices/pivot/"))

    def readings(self, serial, start, stop):
        return self.get("GetDeviceStatus/", serial=serial, start=int(start.timestamp()), stop=int(stop.timestamp()))


def units(resp):
    """Every dict with a serial in a GetDevices response, whatever wraps it (device0, device1, a list)."""
    out = []
    def walk(x):
        if isinstance(x, dict):
            if "serial" in x and ("type" in x or "dtype" in x):
                out.append(x)
            else:
                for v in x.values():
                    walk(v)
        elif isinstance(x, list):
            for v in x:
                walk(v)
    walk(resp)
    return out


def num(v):
    try:
        return float(str(v).replace(",", ""))
    except (TypeError, ValueError):
        return None


def when(r):
    """A reading's time as UTC. 'date' is unit-local; zone_offset (hours) is used when the panel sends it."""
    s = r.get("date") or r.get("unit_date")
    d = dt.datetime.strptime(s, "%m/%d/%Y %H:%M:%S")
    if r.get("zone_offset") not in (None, ""):
        return (d - dt.timedelta(hours=float(r["zone_offset"]))).replace(tzinfo=dt.timezone.utc)
    return d.replace(tzinfo=LOCAL).astimezone(dt.timezone.utc)


def moving(r):
    return str(r.get("power", "")).upper() == "ON" and str(r.get("direction", "")).upper() not in ("", "IDLE")


def is_wet(r, reads_dry):
    if reads_dry:
        return moving(r)
    for k in ("water", "pump"):
        if k in r:
            return str(r[k]).upper() == "ON"
    p = num(r.get("pressure"))
    if p is not None:
        return p > 0
    return moving(r)


def percent(r):
    return num(r.get("dc", r.get("speed")))


def depth(r):
    return num(r.get("depth", r.get("app_depth")))


def direction(rs):
    d = [str(r.get("direction", "")).upper() for r in rs]
    fwd, rev = d.count("FWD"), d.count("REV")
    return "forward" if fwd >= rev and fwd else "reverse" if rev else None


def build_runs(serial, readings, reads_dry):
    """Finished runs from one unit's readings: [{serial, start, stop, hours, direction, pct, ...}]."""
    rs = sorted(((when(r), r) for r in readings if r.get("date") or r.get("unit_date")), key=lambda x: x[0])
    runs, cur, started_wet = [], None, bool(rs) and is_wet(rs[0][1], reads_dry)
    for i, (t, r) in enumerate(rs):
        wet = is_wet(r, reads_dry)
        if wet and cur is None:
            cur = {"start": t, "rows": [(t, r)], "partial": i == 0 and started_wet}
        elif wet:
            cur["rows"].append((t, r))
        elif cur is not None:
            cur["stop"], cur["stop_row"] = t, r
            runs.append(cur)
            cur = None
    out = []
    for c in runs:
        if c["partial"]:
            continue  # wet at the first reading: its real start is before this window
        rows = [r for _, r in c["rows"]]
        times = [t for t, _ in c["rows"]] + [c["stop"]]
        gap = max((b - a).total_seconds() / 3600 for a, b in zip(times, times[1:]))
        pcts = [p for p in map(percent, rows) if p is not None]
        deps = [d for d in map(depth, rows) if d is not None]
        notes = [f"AgSense unit {serial}" + (", counted moving as wet (unit reads dry)" if reads_dry else "")]
        if deps:
            notes.append(f"panel depth {max(deps):.2f} in")
        if gap > MAX_GAP_H:
            notes.append(f"no reading for {gap:.0f} h during the run")
        out.append({
            "serial": str(serial), "start": c["start"], "stop": c["stop"],
            "hours": round((c["stop"] - c["start"]).total_seconds() / 3600, 2),
            "direction": direction(rows),
            "pct": max(set(pcts), key=pcts.count) if pcts else None,
            "start_deg": num(rows[0].get("angle")), "stop_deg": num(c["stop_row"].get("angle")),
            "end_gun": any(str(r.get("endgun", "")).upper() == "ON" for r in rows) or None,
            "note": "; ".join(notes),
        })
    return out


def entry_row(run, pivot_id, now):
    iso = lambda d: d.isoformat().replace("+00:00", "Z")
    return {
        "id": str(uuid.uuid5(NS, f"{run['serial']}|{iso(run['start'])}")),
        "pivot_id": pivot_id, "action": "run", "happened_at": iso(run["stop"]), "recorded_at": now,
        "who_name": WHO, "how": "agsense", "direction": run["direction"], "percent_timer": run["pct"],
        "start_deg": run["start_deg"], "stop_deg": run["stop_deg"], "end_gun": run["end_gun"],
        "start_at": iso(run["start"]), "stop_at": iso(run["stop"]), "hours": None,  # hours come from start/stop
        "note": run["note"],
    }


def match(units_, pivots):
    """{serial: pivot} by the serial saved on the pivot, then by AgSense name."""
    norm = lambda s: " ".join(str(s or "").replace("&amp;", "&").lower().split())
    by_serial = {str((p.get("profile") or {}).get("agsenseSerial", {}).get("value")): p for p in pivots}
    by_name = {norm(p.get("agsenseName")): p for p in pivots if p.get("agsenseName")}
    out = {}
    for u in units_:
        p = by_serial.get(str(u["serial"])) or by_name.get(norm(u.get("name")))
        if p:
            out[str(u["serial"])] = p
    return out


def reads_dry(p):
    return ((p.get("profile") or {}).get(READS_DRY) or {}).get("value") == "yes"


def overlaps_week(run, weeks):
    """True when an imported AgSense week (CSV, hours set) already covers this run."""
    return any(w["start_at"] < run["stop"].isoformat() and run["start"].isoformat() < w["stop_at"] for w in weeks)


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--start")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--fixture", help="a saved GetDeviceStatus JSON response; no network")
    ap.add_argument("--serial", default="0")
    ap.add_argument("--reads-dry", action="store_true")
    a = ap.parse_args()

    if a.fixture:
        dev = json.load(open(a.fixture)).get("device", {})
        for r in build_runs(a.serial, dev.get("reading", []), a.reads_dry):
            print(r["start"], r["stop"], r["hours"], "h", r["direction"], r["pct"], "%", r["note"])
        return

    env = {k: os.environ.get("AGSENSE_" + k) for k in ("USERNAME", "PASSWORD", "APID", "KEY", "IV")}
    if not all(env.values()):
        print("AgSense API not set up yet (AGSENSE_* secrets missing); skipping.")
        return
    ag = AgSense(env["USERNAME"], env["PASSWORD"], env["APID"], env["KEY"], env["IV"])
    from nightly_rain import Db  # here, not at the top, so the tests don't need the rain job's packages
    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    db = Db(url, key) if url and key else None
    if not db and not a.dry_run:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY, or pass --dry-run.")

    stop = dt.datetime.now(dt.timezone.utc)
    start = (dt.datetime.fromisoformat(a.start).replace(tzinfo=LOCAL).astimezone(dt.timezone.utc)
             if a.start else stop - dt.timedelta(days=a.days))
    pivots = [r["data"] for r in db.get_all("pivot?select=data")] if db else []
    devs = ag.devices()
    print(f"{len(devs)} AgSense units: " + ", ".join(f"{u.get('name')} ({u.get('dtype') or u.get('type')})" for u in devs))
    m = match(devs, pivots)
    if db:
        print(f"{len(m)} matched to pivots; not matched: " + (", ".join(str(u.get("name")) for u in devs if str(u["serial"]) not in m) or "none"))

    now = stop.isoformat().replace("+00:00", "Z")
    total = 0
    for u in devs:
        serial, p = str(u["serial"]), m.get(str(u["serial"]))
        if db and not p:
            continue
        try:
            resp = ag.readings(serial, start, stop)
        except Exception as e:
            print(f"{u.get('name')}: could not read ({e})", file=sys.stderr)
            continue
        runs = build_runs(serial, (resp.get("device") or {}).get("reading") or [], bool(p and reads_dry(p)))
        if db:
            weeks = db.get_all(f"entry?select=start_at,stop_at&how=eq.agsense&hours=not.is.null&pivot_id=eq.{urllib.parse.quote(p['id'])}")
            runs = [r for r in runs if not overlaps_week(r, weeks)]
            rows = [entry_row(r, p["id"], now) for r in runs]
            if rows:  # same id = same run: ignore instead of failing on the append-only table
                db.call("POST", "entry?on_conflict=id", rows, prefer="resolution=ignore-duplicates,return=minimal")
        print(f"{u.get('name')}: {len(runs)} finished runs" + ("" if db else " (dry run)"))
        for r in runs[:3] if not db else []:
            print("   ", r["start"], "to", r["stop"], r["hours"], "h", r["direction"], r["pct"], "%")
        total += len(runs)
    print(f"done: {total} runs from {start:%Y-%m-%d} to {stop:%Y-%m-%d}")


if __name__ == "__main__":
    main()
