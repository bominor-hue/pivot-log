"""Nightly rain for every pivot, from NOAA MRMS radar + gauge (MultiSensor 24-h QPE, Pass2).

Run by .github/workflows/nightly.yml each morning. For each of the last few rain days it downloads
one MRMS grid from NOAA's public AWS bucket, reads the mean of the 3x3 block of 1 km cells around
each pivot center (about a pivot's footprint, same as model/water_balance.py), and writes it to the
farm database's rain_day table. Phones pick the new rows up on their next sync.

Rain day D is the MRMS file stamped 12:00 UTC on D+1: 12Z D to 12Z D+1, about 7-8 am to 7-8 am local,
the same window as a morning gauge read. Recent days are re-read every night because NOAA can
revise them. A rain value the office typed in or imported (any source but MRMS) is never overwritten.

Needs SUPABASE_URL and SUPABASE_SERVICE_KEY (the project's secret / service role key) in the
environment. Without them, --pivots FILE does a dry run and prints what it would write.

Usage:
  python3 jobs/nightly_rain.py                      last 3 rain days
  python3 jobs/nightly_rain.py --start 2026-03-01 --end 2026-10-13   backfill
  python3 jobs/nightly_rain.py --pivots pivots.json --days 1         dry run, no database
"""
import argparse, datetime as dt, gzip, json, os, sys, urllib.parse, urllib.request
import numpy as np, pygrib

SOURCE = "NOAA MRMS"
URL = ("https://noaa-mrms-pds.s3.amazonaws.com/CONUS/MultiSensor_QPE_24H_Pass2_00.00/{d}/"
       "MRMS_MultiSensor_QPE_24H_Pass2_00.00_{d}-120000.grib2.gz")
# MRMS CONUS grid: 3500 rows x 7000 cols at 0.01 deg, first point 54.995N -129.995E, rows run north to south
LAT_TOP, LON_LEFT, STEP = 54.995, -129.995, 0.01


def cell(lat, lon):
    return int(round((LAT_TOP - lat) / STEP)), int(round((lon - LON_LEFT) / STEP))


def pivot_rain(grid, lat, lon):
    """Mean of the 3x3 block around the pivot center, in inches; None where radar has no coverage."""
    i, j = cell(lat, lon)
    block = grid[i - 1:i + 2, j - 1:j + 2]
    block = block[block >= 0]  # negative = no coverage
    return None if block.size == 0 else round(float(block.mean()) / 25.4, 2)


def fetch_grid(day):
    """MRMS 24-h rain (mm) for rain day `day`, or None when NOAA has not posted it yet."""
    d = (day + dt.timedelta(days=1)).strftime("%Y%m%d")
    try:
        raw = gzip.decompress(urllib.request.urlopen(URL.format(d=d), timeout=120).read())
    except Exception as e:
        print(f"{day}: no MRMS file yet ({e})", file=sys.stderr)
        return None
    path = f"/tmp/mrms_{d}.grib2"
    with open(path, "wb") as f:
        f.write(raw)
    with pygrib.open(path) as g:
        v = g.message(1).values
    os.remove(path)
    return np.ma.filled(v.astype("float32"), -1)


class Db:
    def __init__(self, url, key):
        self.url, self.h = url.rstrip("/") + "/rest/v1/", {"apikey": key, "Content-Type": "application/json"}
        if key.startswith("eyJ"):  # legacy service_role JWT also goes in Authorization
            self.h["Authorization"] = "Bearer " + key

    def call(self, method, path, body=None, prefer=None):
        h = dict(self.h, **({"Prefer": prefer} if prefer else {}))
        req = urllib.request.Request(self.url + path, method=method, headers=h,
                                     data=None if body is None else json.dumps(body).encode())
        with urllib.request.urlopen(req, timeout=60) as r:
            txt = r.read()
        return json.loads(txt) if txt else None

    def get_all(self, path):
        out, page = [], 1000
        while True:
            rows = self.call("GET", f"{path}&limit={page}&offset={len(out)}")
            out += rows
            if len(rows) < page:
                return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--days", type=int, default=3, help="re-read this many recent rain days")
    ap.add_argument("--start"); ap.add_argument("--end")
    ap.add_argument("--pivots", help="dry run: JSON list of {id, name, lat, lon}")
    a = ap.parse_args()

    today = dt.date.today()
    end = dt.date.fromisoformat(a.end) if a.end else today - dt.timedelta(days=1)
    start = dt.date.fromisoformat(a.start) if a.start else end - dt.timedelta(days=a.days - 1)
    days = [start + dt.timedelta(days=i) for i in range((end - start).days + 1)]

    url, key = os.environ.get("SUPABASE_URL"), os.environ.get("SUPABASE_SERVICE_KEY")
    db = Db(url, key) if url and key and not a.pivots else None
    if db:
        pivots = [r["data"] for r in db.get_all("pivot?select=data")]
        have = {r["id"]: r["data"] for r in db.get_all(
            "rain_day?select=id,data&" + urllib.parse.urlencode({"data->>date": f"gte.{start}"}))}
    elif a.pivots:
        pivots, have = json.load(open(a.pivots)), {}
    else:
        sys.exit("Set SUPABASE_URL and SUPABASE_SERVICE_KEY, or pass --pivots for a dry run.")
    pivots = [p for p in pivots if p.get("lat") is not None and p.get("lon") is not None]
    print(f"{len(pivots)} pivots with a location, rain days {start} to {end}")

    total = kept = 0
    for day in days:
        grid = fetch_grid(day)
        if grid is None:
            continue
        rows = []
        for p in pivots:
            inches = pivot_rain(grid, p["lat"], p["lon"])
            if inches is None:
                continue
            rid = f"{p['id']}|{day}"
            old = have.get(rid)
            if old and old.get("source") != SOURCE:
                kept += 1  # office-entered rain wins
                continue
            if old and old.get("inches") == inches:
                continue
            rows.append({"id": rid, "updated_by": "nightly rain",
                         "data": {"pivotId": p["id"], "date": str(day), "inches": inches, "source": SOURCE}})
        if db and rows:
            db.call("POST", "rain_day", rows, prefer="resolution=merge-duplicates,return=minimal")
        wet = [r["data"]["inches"] for r in rows if r["data"]["inches"] > 0]
        print(f"{day}: {len(rows)} written, max {max(wet, default=0):.2f} in" + ("" if db else " (dry run)"))
        if not db:
            for r in rows[:5]:
                print("  ", next(p["name"] for p in pivots if p["id"] == r["data"]["pivotId"]), r["data"]["inches"])
        total += len(rows)
    print(f"done: {total} rain values written, {kept} office values left alone")


if __name__ == "__main__":
    main()
