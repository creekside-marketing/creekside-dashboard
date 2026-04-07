# Creekside Dashboard — Setup Instructions for Cade

## Quick Start

```bash
git clone https://github.com/peterson-rainey/creekside-dashboard.git
cd creekside-dashboard
npm install
```

Create a file called `.env.local` in the root directory. Peterson will provide the values.

Required variables:
```
NEXT_PUBLIC_SUPABASE_URL=
NEXT_PUBLIC_SUPABASE_ANON_KEY=
SUPABASE_SERVICE_ROLE_KEY=
PIPEBOARD_API_KEY=
GOOGLE_ADS_CLIENT_ID=
GOOGLE_ADS_CLIENT_SECRET=
GOOGLE_ADS_REFRESH_TOKEN=
GOOGLE_ADS_DEVELOPER_TOKEN=
GOOGLE_ADS_MCC_ID=
DASHBOARD_PASSWORD=
DASHBOARD_SESSION_SECRET=
```

Then run:
```bash
npm run dev
```

Open http://localhost:3000 and log in with the dashboard password.

## What This Is

The Creekside Marketing internal dashboard. It has:

1. **Internal Dashboard** (behind password) — client tracking, team, billing, scorecard
2. **Client-Facing Reports** — /report/[token] pages clients can view (no login needed)

## Key Directories

- `src/app/(dashboard)/` — all internal dashboard pages (the parentheses mean this is a route group — invisible in URLs)
- `src/app/report/[token]/` — client report pages
- `src/components/reports/` — report components (LeadGenReport, EcomReport, etc.)
- `src/components/` — dashboard components (ClientTable, ClientReport, etc.)
- `src/app/api/` — all API routes
- `src/middleware.ts` — auth middleware (protects dashboard, allows /report/* through)

## Editing Client Report Notes

To edit notes that appear on client-facing reports:
1. Log in at the dashboard URL
2. Click into a client
3. Click the "Client Report" quick link
4. Scroll to the Notes section at the bottom
5. Edit and click Save

These notes are stored in the `client_report_notes` column on `reporting_clients` in Supabase.
