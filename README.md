# Pivot Log

Irrigation records and water scheduling for JA Minor Family Farms (81 pivots, 90 irrigated fields).
A web app that installs to a phone's home screen from a link and works with no signal.

## What's in the first version (PRD v3 must-haves)

1. **Turn on**: a pivot dial with one Start button. Defaults to now, one lap and end gun on; direction and percent timer remember the last run. Shows lap time, inches per lap and when it should be back around. Started earlier, a stop spot in degrees, or keep going are under "more".
2. **Turn off**: the same pivot dial with one Stop button, showing how far the arm has gone, hours and inches so far. "Made it around" is guessed from the lap time and must be answered before it saves. **Log a past run** for missed entries.
3. **Lap reminder** an hour before and when a pivot should be around (in-app, plus a system notification if allowed). Lap time is learned from "made it around" until the dealer chart value is on the pivot profile.
4. **Running now** on Today, with long runs flagged "Still running?".
5. **Offline**: everything is saved on the phone (IndexedDB) and sent when there's signal. Entries are never edited; undo adds a correction entry.
6. **Import**: field list or crop plan (Excel/CSV), boundaries (zipped shapefile, KML, KMZ, GeoJSON), the pivot info sheet ("Fill in" tab, blank template included), weather. Preview counts first; blank cells never erase.
7. **AgSense weekly CSV** (Pivot Summary for one week). Pivots whose unit always reads dry count their walking hours as wet. A week can't be imported twice.
8. **Water balance** for every field, ported from `model/water_balance.py` (a test checks it matches day by day): status, days until water is needed, this week's water.
9. **Field screen**: action line ("Turn on today", "Hold until Thursday"), growth stage by days after planting with a tip, soil water and season-to-date charts (rain, need, applied), last runs, and "show me why" on every number.
10. **Map** of every field and pivot circle on Sentinel-2 imagery, colored by soil water, 7-day rain or crop, filter by farm.
11. **Reports**: season water by field, weekly applied vs recommended, run records, water use by source, irrigated acres and crops, pivot health. Filter, pick columns, group with subtotals, save. Export Excel (with a Notes sheet), CSV, and PDF by printing.
12. **Probe readings** (CSV) shown on the field's soil water chart; a gap of more than 15 points from the model is flagged.

**Sign-in**: the office adds people with a 4-digit PIN in Settings (the first person added runs the office). The app then asks "Who's logging?" and every entry carries that name. Works with no signal. Only office and manager roles can import. Email-link sign-in for the office comes with the hosted database.

**Demo**: Import > "Load the JA Minor 2026 demo" loads the real 2026 fields, boundaries, soils, radar rain, ET and imagery, as of July 16.

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

To connect the hosted database:
1. Supabase: turn off new sign-ups, add the office email(s) and one shared crew login under Authentication > Users.
2. GitHub repo secrets `SUPABASE_PROJECT_REF`, `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, then run the **Database** workflow (Actions tab). It builds the tables from `supabase/migrations`.
3. Netlify: connect this repo; set `VITE_SUPABASE_URL` and `VITE_SUPABASE_ANON_KEY` in its environment variables (`netlify.toml` has the build).
4. In the app, Settings > Farm account: the office signs in by email link first (that login becomes the office); crew phones sign in with the crew login. Office devices send the master lists; every device sends entries and receives everyone's.

`npm test` also runs the migration on an in-memory Postgres and checks who may write what.

`scripts/build_demo_data.py /mnt/project-files` rebuilds the demo file and the model test fixture from the project files.

## Not yet

Server side: the nightly model job, the radar rain and UGA ET pulls, and push reminders to locked phones. Imagery for farms outside the demo image. Everything on the PRD's "Later" list, including texting and Spanish.
