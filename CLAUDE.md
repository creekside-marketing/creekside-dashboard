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

Per-client custom reports are created with the `branch-report` CLI. One command does everything: copies the right template, rewrites imports, registers the component, updates the DB, runs tsc, commits, and pushes to main.

### Usage

```bash
npm run branch-report -- "<client name>" <google|meta>
```

Examples:
```bash
npm run branch-report -- "Aura Displays" google
npm run branch-report -- "Fusion Dental Implants" meta
```

### What it does

1. Looks up the client in `reporting_clients` (substring ILIKE, platform-scoped). If zero or multiple matches, it prints suggestions and aborts.
2. Derives slug: `<kebab-case-client-name>-<platform>` (e.g. `aura-displays-google`).
3. Picks the right source template based on `client_type` + `platform`.
4. Copies template to `src/components/reports/custom/<slug>.tsx`, renames the exported component to PascalCase, and rewrites `./X` imports to `../X`.
5. Adds the registry entry to `src/components/reports/custom/registry.tsx`.
6. Updates `reporting_clients` to `report_mode='custom'`, `custom_report_slug='<slug>'`.
7. Runs `npx tsc --noEmit`. On failure, rolls back ALL changes (file, registry, DB) and exits.
8. Commits with message `chore: branch report for <client> (<platform>)` and pushes to `origin/main`. Railway auto-deploys in ~2 min.

### Idempotency

Running the script twice for the same client+platform is a no-op. Never more than 1 branch per client+platform.

### Safety features

- **Pre-flight checks:** aborts if the git index has staged changes or if not on `main`.
- **Full rollback on push failure:** tries `git pull --rebase` + retry once; if still failing, resets the local commit, deletes the branch file, restores the registry, and reverts the DB. Nothing left behind.
- **Shared templates are CODEOWNERS-protected.** The 4 shared `*Report.tsx` files require Peterson review.
- **Supabase service role required.** Script hard-errors if `SUPABASE_SERVICE_ROLE_KEY` is missing — no silent anon fallback.

### First-time setup for contractors

```bash
cd /path/to/creekside-dashboard
npm install                 # pulls tsx dev dep
# .env.local must contain SUPABASE_SERVICE_ROLE_KEY + NEXT_PUBLIC_SUPABASE_URL
```

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
