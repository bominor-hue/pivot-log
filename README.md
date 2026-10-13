# Pivot Log

Irrigation records and water scheduling for JA Minor Family Farms (81 pivots, 90 irrigated fields).
A web app that installs to a phone's home screen from a link and works with no signal.

## What's in the first version

- **Today**: what's running, which fields need water (from the daily water balance), runs that need a look, and pivots near you (GPS).
- **Turn ON / Turn OFF**: one tap. ON records start time, forward or reverse, percent timer, where to stop (one lap, at a position in degrees, or keep going) and end gun. OFF records stop time and whether it made it around. Past runs can be entered after the fact.
- **Entries are never edited.** Undo adds a correction entry; both stay in the records. Runs are rebuilt from entries every time.
- **Daily water balance** per field, ported from `model/water_balance.py` (same settings; a test checks it matches the Python model day by day). Logged runs feed it as applied water.
- **Import**: field list (Excel/CSV), boundaries (zipped shapefile, KML, KMZ, GeoJSON), the pivot info sheet ("Fill in" tab, blank template included), and weather (ETo and rain CSV). Every import previews found / matched / need a look before saving, and is logged.
- **Reports**: season water by field, irrigation run records, pivot health. Filters, one layout (answer first, units, totals, as-of and sources), CSV export and print to PDF.
- **Demo**: Import > "Load the JA Minor 2026 demo" loads the real 2026 fields, boundaries, soils, radar rain and ET, as of July 16.

## How it's built

| Piece | Choice |
|---|---|
| App | React + TypeScript, built with Vite. Installable offline web app (service worker). |
| On the phone | IndexedDB (Dexie). Everything works offline; entries queue until there's signal. |
| Hosted database | Supabase (Postgres) in the farm's own account. Schema: `supabase/migrations/0001_init.sql`. Optional until the account exists. |
| Model | `src/model/waterBalance.ts` |

## Run it

```
npm install
npm run dev        # http://localhost:5173
npm test           # water balance parity, runs, imports, reports
npm run build      # installable app in dist/ (host on any static host)
npm run build:preview   # one-file preview in dist-preview/
```

To connect the hosted database, create a Supabase project, run the migration in its SQL editor, and put the URL and anon key in `.env` (see `.env.example`).

`scripts/build_demo_data.py /mnt/project-files` rebuilds the demo file and the model test fixture from the project files.

## Not yet

Satellite map (MapLibre), sign-in and roles, pushing master lists to the hosted database, AgSense CSV import, the nightly model job, Excel and formatted PDF exports, the chase reminders, Spanish. Texting is on hold.
