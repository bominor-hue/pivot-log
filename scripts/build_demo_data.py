"""Build public/demo/ja_minor_2026.json, the demo farm the app can load in one tap.

Reads the project files (fields, soils, planting dates, ETo, MRMS rain per pivot)
and writes one compact JSON. Also writes the water balance parity fixture used by
src/model/waterBalance.test.ts.

    python3 scripts/build_demo_data.py /mnt/project-files
"""
import json, sys
from pathlib import Path
import numpy as np, pandas as pd

SRC = Path(sys.argv[1] if len(sys.argv) > 1 else "/mnt/project-files")
OUT = Path(__file__).resolve().parent.parent

fields = pd.read_csv(SRC / "fields/ja_minor_irrigated_fields_2026.csv")
pivots = pd.read_csv(SRC / "fields/ja_minor_pivots_2026.csv")
soils = pd.read_csv(SRC / "fields/pivot_centers_soils_2026.csv").set_index("pivot_unit")
plant = pd.read_csv(SRC / "fields/planting_dates_2026.csv").set_index("field")
wx = pd.read_csv(SRC / "model/weather/daily_weather_2026.csv", index_col=0, parse_dates=True)
z = np.load(SRC / "model/weather/mrms_sumter_2026.npz")
R, LATS, LONS = z["rain_in"], z["lats"], z["lons"]
geo = json.load(open(SRC / "fields/field_boundaries_2026.geojson"))

def rain_at(lat, lon):  # same 3x3 block as model/water_balance.py
    i, j = np.abs(LATS - lat).argmin(), np.abs(LONS - lon).argmin()
    return np.nanmean(R[:, i - 1:i + 2, j - 1:j + 2], axis=(1, 2))

def rnd(coords):
    if isinstance(coords[0], (int, float)): return [round(coords[0], 5), round(coords[1], 5)]
    return [rnd(c) for c in coords]

bounds = {}
for f in geo["features"]:
    if f["properties"].get("irrigated"):
        bounds[f["properties"]["field"]] = {"type": f["geometry"]["type"], "coordinates": rnd(f["geometry"]["coordinates"])}

# AgSense typed-in gpm and any filled cells from the real pivot info sheet, so demo runs show inches
import openpyxl
ws = openpyxl.load_workbook(SRC / "systems/pivot_info_collection.xlsx", read_only=True)["Fill in"]
rows = list(ws.iter_rows(values_only=True))
hdr = list(rows[2])
info = {r[0]: dict(zip(hdr, r)) for r in rows[4:] if r[0]}
KEEP = {"AgSense gpm (typed in)": ("agsenseGpm", "AgSense setting"), "AgSense acres setting": ("agsenseAcres", "AgSense setting"),
        "Irrigated acres (design or FSA)": ("irrigatedAcres", "pivot info sheet"), "Design flow (gpm)": ("flowGpm", "pivot info sheet"),
        "Hours per rev at 100%": ("hoursPerRev100", "pivot info sheet"), "Full or part circle (deg)": ("arcDeg", "pivot info sheet")}
def profile(name):
    out = {}
    for col, (key, src) in KEEP.items():
        v = info.get(name, {}).get(col)
        if isinstance(v, (int, float)) and v > 0: out[key] = {"value": v, "source": src}
    return out

out_pivots = []
for p in pivots.itertuples():
    s = soils.loc[p.pivot_unit]
    out_pivots.append(dict(
        name=p.pivot_unit, farm=p.farm, lat=float(s.center_lat), lon=float(s.center_lon),
        agsenseName=None if pd.isna(p.agsense_alias) else p.agsense_alias,
        soil=s.dominant_soil, aws50=float(s.aws_0_50cm_in), aws100=float(s.aws_0_100cm_in),
        profile=profile(p.pivot_unit), rain=[round(float(x), 4) for x in rain_at(s.center_lat, s.center_lon)]))

out_fields = []
for f in fields.itertuples():
    pd_ = plant.loc[f.field].plant_date if f.field in plant.index else None
    out_fields.append(dict(
        farm=f.farm, name=f.field, pivot=f.pivot_unit, crop=f.crop_2026, acres=float(f.acres_2026),
        fsn=None if pd.isna(f.fsn) else str(f.fsn), county=None if pd.isna(f.county) else f.county,
        plantDate=None if pd.isna(pd_) else str(pd_)[:10], boundary=bounds.get(f.field)))

demo = dict(
    source="JA Minor Family Farms 2026: Field Master fields, FSA boundaries, SSURGO soils, 2026 harvest-file planting dates, "
           "ETo estimated FAO-56 from Plains RAWS, rain NOAA MRMS (3x3 km around each pivot center).",
    year=2026, dates=[d.strftime("%Y-%m-%d") for d in wx.index], eto=[round(float(x), 3) for x in wx.eto_in],
    pivots=out_pivots, fields=out_fields)
(OUT / "public/demo/ja_minor_2026.json").write_text(json.dumps(demo, separators=(",", ":")))

# parity fixture: three fields, one per crop, from the Python model's output
daily = pd.read_csv(SRC / "model/daily_balance_2026.csv")
pick = ["A&B #1", "Akin #1N", "A&B #2A"]
fx = daily[daily.field.isin(pick)][["date", "field", "dap", "etc_in", "taw_in", "depletion_rec_in", "irr_rec_gross_in", "depletion_rain_only_in"]]
fx.to_csv(OUT / "src/test/fixtures/python_balance_2026.csv", index=False)
print(len(out_pivots), "pivots,", len(out_fields), "fields,", sum(f["boundary"] is not None for f in out_fields), "with boundaries;",
      len(fx), "fixture rows;", fx.field.unique().tolist())
