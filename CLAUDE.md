# Creekside Dashboard

Creekside Marketing internal operations dashboard. Built with Next.js 14 (App Router), Tailwind CSS, and Supabase. Deployed on Railway with auto-deploy from the `main` branch.

GitHub: `peterson-rainey/creekside-dashboard`

## Development

```bash
npm install
npm run dev      # localhost:3000
npx tsc --noEmit # type check
npm run build    # production build
```

## Key Directories

- `src/app/` — Next.js pages and API routes
- `src/components/` — React components
- `src/components/reports/` — Default report templates (DO NOT modify for per-client changes)
- `src/components/reports/custom/` — Per-client custom reports
- `src/lib/` — Utilities, Supabase client

## Authentication

Dashboard is password-gated via `cm_auth` cookie. Reports at `/report/[token]` are public (token-based access). Internal users see edit controls.

## Important

When editing reports, NEVER modify default report components in `src/components/reports/` for client-specific changes. Always use the report branching workflow below.

---

## Report Branching Workflow

This is the process for creating per-client custom reports. When a contractor says "I want to edit [Client Name]'s report", follow these steps exactly.

### Step 1: Identify the client and their current report type

```sql
-- Run via Supabase MCP execute_sql
SELECT id, client_name, platform, client_type, ad_account_id, report_mode, custom_report_slug
FROM reporting_clients
WHERE client_name ILIKE '%client name%';
```

This tells you:
- `client_type` + `platform` determines which default report to copy (e.g. `lead_gen` + `google` = `LeadGenGoogleReport.tsx`)
- `report_mode` indicates whether they already have a custom report
- If `report_mode` is already `'custom'`, the custom file already exists — just edit it directly

### Step 2: Copy the default report

Based on `client_type` + `platform`, copy the correct source file:

| client_type | platform | Source file |
|------------|----------|-------------|
| lead_gen | google | `src/components/reports/LeadGenGoogleReport.tsx` |
| lead_gen | meta | `src/components/reports/LeadGenMetaReport.tsx` |
| ecom | google | `src/components/reports/EcomGoogleReport.tsx` |
| ecom | meta | `src/components/reports/EcomMetaReport.tsx` |

Copy it to: `src/components/reports/custom/[slug].tsx`

The slug should be the client name lowercased, spaces replaced with hyphens, special characters removed, with the platform appended. Examples:
- "Integrity Naturopathics" + meta = `integrity-naturopathics-meta`
- "Perfect Parking" + google + segment "Asphalt" = `perfect-parking-asphalt-google`
- "Bob's Plumbing" + google = `bobs-plumbing-google`

### Step 3: Rename the exported component

In the copied file, rename the default export function to something unique. Convention: `[ClientName][Platform]Report`.

Example: `IntegrityNaturopathicsMetaReport`

### Step 4: Register it

Edit `src/components/reports/custom/registry.tsx`. Add a dynamic import entry:

```tsx
import dynamic from 'next/dynamic';
// ... existing code ...

const registry: Record<string, ComponentType<ReportProps>> = {
  'integrity-naturopathics-meta': dynamic(() => import('./integrity-naturopathics-meta'), { loading: Spinner }),
};
```

### Step 5: Update the database

```sql
UPDATE reporting_clients
SET report_mode = 'custom', custom_report_slug = 'integrity-naturopathics-meta'
WHERE id = '[client-uuid]';
```

### Step 6: Verify

Run `npx tsc --noEmit` to check for type errors, then `npm run build` to verify the build passes.

### Step 7: Commit and push

The dashboard auto-deploys from GitHub via Railway. Push to `main` and the changes go live.

---

## Editing a Custom Report

Once branched, the custom report file is a standalone React component. You have full freedom to:
- Reorder, add, or remove KPI cards
- Change which charts are shown
- Add custom sections, text blocks, or new components
- Modify the data fetching to pull different metrics
- Change the layout entirely

### Shared Building Blocks

The file imports shared components from the parent directory:
- `KpiCard` — metric display cards with change indicators
- `ReportChart` — line/bar charts with dual Y-axes
- `BreakdownTable` — sortable data tables
- `ReportHeader` — client name, date range selector, refresh button
- `ReportNotesTimeline` — editable notes section
- `ReportingClient` type from `../types` (custom reports are in a subdirectory)

### Available API Endpoints

- `/api/google/insights?customer_id=X&level=campaign|account|keyword|search_term|geo|age|gender&date_range=X`
- `/api/meta/insights?account_id=X&level=campaign|account|ad|age|gender&time_range=X`

---

## Switching Back to Default

If the custom report has issues:

```sql
UPDATE reporting_clients SET report_mode = 'default' WHERE id = '[client-uuid]';
```

This is instant — no deploy needed. The custom file stays in the repo for later use.

---

## Safety

- Default reports are NEVER modified when branching — the custom file is a complete copy
- If a custom report crashes at runtime, an error boundary automatically shows the default report with a warning banner
- Custom reports are fully independent — changes to the default template DO NOT propagate to custom reports (this is intentional)
