"""Nightly crop-water-demand weather (ETo) for the farm, estimated until the UGA station feed is set up.

Same method as model/build_weather.py (the 2026 season model), from NOAA GHCN-Daily on AWS:
  temperature  Plains/Sumter RAWS (USR0000GPLA), gaps from the Plains co-op, then Crisp Co Power Dam
  wind         Albany airport (USW00013869), 10 m to 2 m (FAO-56 Eq. 47), 2.5 m/s when missing
  ETo          FAO-56 Penman-Monteith with the missing-data rules (dew point = Tmin, Hargreaves solar)
GHCN runs 2-3 days behind, so the newest days up to yesterday are filled with the last 7 days'
average and replaced on later nights when the readings come in. Days are re-figured each night.

Writes weather_day rows {date, eto, source}. A day whose ETo came from anywhere else (a UGA station
import) is never overwritten. Needs SUPABASE_URL and SUPABASE_SERVICE_KEY; --dry-run prints instead.

Usage:
  python3 jobs/nightly_eto.py                  last 14 days
  python3 jobs/nightly_eto.py --start 2026-03-01
  python3 jobs/nightly_eto.py --dry-run --days 30
"""
import argparse, csv, datetime as dt, io, math, os, sys, urllib.parse, urllib.request
from nightly_rain import Db

GHCN = "https://noaa-ghcn-pds.s3.amazonaws.com/csv/by_year/{y}.csv"
TEMP = ["USR0000GPLA", "USC00097087", "USC00092361"]  # in order of preference
WIND = "USW00013869"
LAT, ELEV = 32.05, 150.0  # Plains
EST = "FAO-56 est. (GHCN Plains)"
FILL = "FAO-56 est., recent-days fill"
U2_DEFAULT = 2.5 * 4.87 / math.log(67.8 * 10 - 5.42)  # 2.5 m/s at 10 m, as in the 2026 model


def read_ghcn(years):
    """{(station, element): {date: value}} for the stations we use, QC-failed values dropped."""
    want = tuple(s + "," for s in TEMP + [WIND])
    out = {}
    for y in years:
        with urllib.request.urlopen(GHCN.format(y=y), timeout=300) as r:
            for line in io.TextIOWrapper(r, encoding="utf-8"):
                if not line.startswith(want):
                    continue
                st, d, el, val, _m, q = line.split(",")[:6]
                if q or el not in ("TMAX", "TMIN", "AWND"):
                    continue
                out.setdefault((st, el), {})[dt.date(int(d[:4]), int(d[4:6]), int(d[6:]))] = int(val) / 10
    return out


def eto_pm(tmax, tmin, u2, doy, krs=0.16):
    """FAO-56 Penman-Monteith, reduced data. Returns in/day."""
    tmean = (tmax + tmin) / 2
    P = 101.3 * ((293 - 0.0065 * ELEV) / 293) ** 5.26
    gamma = 0.000665 * P
    es = lambda t: 0.6108 * math.exp(17.27 * t / (t + 237.3))
    es_, ea = (es(tmax) + es(tmin)) / 2, es(tmin)
    delta = 4098 * es(tmean) / (tmean + 237.3) ** 2
    phi, dr = math.radians(LAT), 1 + 0.033 * math.cos(2 * math.pi * doy / 365)
    dec = 0.409 * math.sin(2 * math.pi * doy / 365 - 1.39)
    ws = math.acos(-math.tan(phi) * math.tan(dec))
    Ra = 24 * 60 / math.pi * 0.082 * dr * (ws * math.sin(phi) * math.sin(dec) + math.cos(phi) * math.cos(dec) * math.sin(ws))
    Rso = (0.75 + 2e-5 * ELEV) * Ra
    Rs = min(krs * math.sqrt(max(tmax - tmin, 0)) * Ra, Rso)
    Rnl = 4.903e-9 * ((tmax + 273.16) ** 4 + (tmin + 273.16) ** 4) / 2 * (0.34 - 0.14 * math.sqrt(ea)) * (1.35 * Rs / Rso - 0.35)
    Rn = 0.77 * Rs - Rnl
    et = (0.408 * delta * Rn + gamma * 900 / (tmean + 273) * u2 * (es_ - ea)) / (delta + gamma * (1 + 0.34 * u2))
    return max(et, 0) / 25.4


def daily_eto(g, days):
    """{date: (eto_in, source)} for each day; recent days without readings get the 7-day fill."""
    out, u2_last = {}, None
    for day in days:
        tx = tn = None
        for st in TEMP:
            a, b = g.get((st, "TMAX"), {}).get(day), g.get((st, "TMIN"), {}).get(day)
            if a is not None and b is not None and a > b:
                tx, tn = a, b
                break
        w10 = g.get((WIND, "AWND"), {}).get(day)
        u2 = w10 * 4.87 / math.log(67.8 * 10 - 5.42) if w10 is not None else u2_last
        u2_last = u2 if w10 is not None else u2_last
        if tx is not None:
            out[day] = (round(eto_pm(tx, tn, u2 if u2 is not None else U2_DEFAULT, day.timetuple().tm_yday), 3), EST)
    real = sorted(out)
    if real:
        last7 = [out[d][0] for d in real[-7:]]
        fill = round(sum(last7) / len(last7), 3)
        for day in days:
            if day > real[-1]:
                out[day] = (fill, FILL)
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--start")
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args()
    end = dt.date.today() - dt.timedelta(days=1)
    start = dt.date.fromisoformat(a.start) if a.start else end - dt.timedelta(days=a.days - 1)
    days = [start + dt.timedelta(days=i) for i in range((end - start).days + 1)]
    # A few days before the window so the wind carry-over has something to start from.
    g = read_ghcn(sorted({start.year, end.year} | {(start - dt.timedelta(days=7)).year}))
    eto = daily_eto(g, [start - dt.timedelta(days=7) + dt.timedelta(days=i) for i in range(7)] + days)

    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    db = Db(url, key) if url and key and not a.dry_run else None
    if not db and not a.dry_run:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY, or pass --dry-run.")
    have = {r["id"]: r["data"] for r in db.get_all("weather_day?select=id,data&" + urllib.parse.urlencode({"id": f"gte.{start}"}))} if db else {}
    rows, kept = [], 0
    for day in days:
        if day not in eto:
            continue
        v, src = eto[day]
        old = have.get(str(day))
        if old and old.get("source") not in (EST, FILL):
            kept += 1  # a station value wins
            continue
        if old and old.get("eto") == v and old.get("source") == src:
            continue
        rows.append({"id": str(day), "updated_by": "nightly eto", "data": {"date": str(day), "eto": v, "source": src}})
    if db and rows:
        db.call("POST", "weather_day", rows, prefer="resolution=merge-duplicates,return=minimal")
    for r in rows if not db else rows[-3:]:
        print(r["data"]["date"], r["data"]["eto"], r["data"]["source"])
    print(f"done: {len(rows)} days written, {kept} station days left alone" + (" (dry run)" if not db else ""))


if __name__ == "__main__":
    main()
