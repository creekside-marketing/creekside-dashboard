# Creekside Internal Dashboard

Internal operations dashboard for Creekside Marketing. Password-gated. Tracks active clients, team, billing, ad performance, and agency KPIs.

**Repo:** `peterson-rainey/creekside-dashboard`
**Deployed:** Railway (`creekside-agent-system-production.up.railway.app`)
**Stack:** Next.js 16, React 19, Tailwind CSS 4, Supabase, Recharts, Google Ads API, PipeBoard (Meta Ads)

> This is NOT the public tools site. That is `creekside-tools` in a separate repo.

---

## Architecture

### Pages (Route Group: `(dashboard)`)

| Route | Page | Description |
|-------|------|-------------|
| `/` | `page.tsx` | **Client Table** — main view. Shows all active clients with per-platform revenue, spend, goals, budgets. |
| `/client/[id]` | `client/[id]/page.tsx` | **Client Detail** — server component. Quick links (report, contract, Drive, ClickUp, GChat, website), Lead Gen/Ecom toggle, campaign-level ad data, performance goals. |
| `/team` | `team/page.tsx` | Team members and contractor tracking |
| `/billing` | `billing/page.tsx` | Invoice/payment health |
| `/scorecard` | `scorecard/page.tsx` | Agency KPIs and MRR |
| `/weekly` | `weekly/page.tsx` | Weekly scorecard |
| `/archive` | `archive/page.tsx` | Churned clients |
| `/roas-calculator` | `roas-calculator/page.tsx` | ROAS calculator tool |
| `/login` | `login/page.tsx` | Auth page (outside dashboard layout) |
| `/report/[token]` | `report/[token]/page.tsx` | **Client-Facing Reports** — public, no auth. Lead Gen or Ecom format based on `client_type`. |

### Auth

Middleware at `src/middleware.ts` checks `cm_auth` cookie against `DASHBOARD_SESSION_SECRET` env var. Exempted routes: `/report`, `/api`, `/login`, `/_next`.

### Theme

Dark theme. CSS variables in `globals.css`:
- `--bg-primary: #0B0F1A` (main background)
- `--text-primary: #F9FAFB` (text on dark bg)
- `--accent: #14B8A6` (teal, buttons/links)

**Important:** Use `text-[var(--text-primary)]` for headings on dark backgrounds, NOT `text-slate-900` (invisible on dark bg). Use inline `style={{ color: '#1e293b', backgroundColor: '#ffffff' }}` on form inputs to override theme.

---

## Key Components

### `ClientTable.tsx` (~1600 lines)

The main dashboard component. Renders the client table with inline editing.

**Summary stats bar (6 cards):** Active Clients, Est. Monthly Revenue, Operator Costs, Profit/Margin, Google Revenue, Meta Revenue. All derived from `calculatedRevenue` (client-side) + `operatorCosts` (API).

**Columns (per platform row):**
| Column | Editable | Source |
|--------|----------|--------|
| Client Name | No (grouped) | `reporting_clients.client_name` |
| Platform | No | Badge (Meta blue, Google green) |
| Est. Revenue | Click to override | Calculated from `fee_config` + live spend/budget |
| Proj. Cost | No | `operatorCosts` API (hours x rate / clients) |
| Priority | Inline select | `reporting_clients.priority` |
| Manager | Inline select (grouped) | `reporting_clients.account_manager` |
| Operator | Inline select | `reporting_clients.platform_operator` |
| Budget | Inline currency | `reporting_clients.monthly_budget` |
| Spend | Live data | Meta: PipeBoard bulk API. Google: Google Ads API. |
| Target | Inline goal editor | `reporting_clients.goal_type` + `goal_target` |
| Current | Auto-calculated | Live data value matching goal type |

**Grouping:** Only Client Name (with contact, notes) and Manager are grouped across platform rows. Everything else renders per-row.

**Revenue calculation cascade:**
1. `revenue_override === true` → use manual `monthly_revenue`
2. `fee_config` + live spend → calculate via fee engine
3. `fee_config` + budget → calculate via fee engine (fallback)
4. `monthly_revenue` from DB → display as-is
5. Nothing → show `--`

**Live data fetching:**
- Meta: Single `bulk_get_insights` call via `/api/meta/bulk-insights` for ALL accounts at once
- Google: Parallel individual calls to `/api/google/insights`
- Auto-fetches on page load. Cached in `sessionStorage` for 5 minutes.
- Manual refresh button with 5-minute cooldown.

**Partner filtering:** `PARTNER_NAMES` Set excludes Bottle.com, Comet Fuel, FirstUp Marketing, Full Circle Media, Suff Digital.

### `fee-engine.ts`

Pure functions for calculating expected revenue from `fee_config` JSON + spend data.

**Fee types:**
```typescript
// Flat % of spend per platform
{ type: "percentage", rate: 0.15, minimum?: 450 }

// Fixed monthly total, split proportionally by spend across platforms
{ type: "fixed", monthly_fee: 6000 }

// Marginal rate brackets (like tax brackets)
{ type: "tiered", minimum: 1500, tiers: [
  { up_to: 20000, rate: 0.20 },
  { up_to: 40000, rate: 0.15 },
  { up_to: null, rate: 0.10 }
], scope: "total" | "per_platform" }

// Flat fee per platform row
{ type: "flat", amount: 500 }

// Whichever is greater
{ type: "greater_of", flat: 600, rate: 0.20 }
```

**Scope:** `"total"` = combine spend across all platforms, calculate total fee, split proportionally. `"per_platform"` = each platform calculated independently.

### `ClientReport.tsx`

Renders on `/client/[id]`. Fetches campaign-level data from Meta (PipeBoard) or Google Ads API. Shows KPI cards, campaigns table, conversion breakdowns. Supports date range selection (7d, 14d, 30d, This Month, Last Month) with prior-period comparison.

### `CampaignsTable.tsx`

Sub-component of ClientReport. Renders campaign rows with status dots, metrics. **Note:** Campaign `status` from Google Ads API is numeric (enum), coerced via `String()` before `.toLowerCase()`.

### `ClientTypeToggle.tsx`

Toggle buttons (Lead Gen / Ecom) on client detail page. Saves to `reporting_clients.client_type`. Used by `/report/[token]` to determine report format.

### `InlineGoalEditor` (inside ClientTable.tsx)

Inline editor for Target column. Dropdown for goal type (Conv, CPL, CPA, ROAS, Spend) + number input for target value. Has explicit Save/Cancel buttons (no onBlur auto-close). Uses inline `style` for text color to override dark theme.

---

## API Routes

| Route | Method | Description |
|-------|--------|-------------|
| `/api/clients` | GET | All reporting_clients with contact names |
| `/api/clients` | PATCH | Update client fields (whitelist: `ALLOWED_UPDATE_FIELDS`) |
| `/api/clients/profitability` | GET | Operator costs per client (no revenue — that's client-side) |
| `/api/clients/last-contact` | GET | Last contact date per client (has known column errors) |
| `/api/clients/churn-risk` | GET | Churn risk scores (currently unused in UI) |
| `/api/clients/revenue` | GET | Square revenue data (currently unused in UI) |
| `/api/meta/bulk-insights` | GET | **Single call** for all Meta account insights via PipeBoard `bulk_get_insights` |
| `/api/meta/insights` | GET | Individual Meta account insights (used by ClientReport, not main table) |
| `/api/google/insights` | GET | Google Ads data (account, campaign, keyword, search_term, geo, age, gender levels) |
| `/api/scorecard` | GET | Agency KPIs, MRR (uses fee_config per client) |
| `/api/goals` | GET/POST/PATCH/DELETE | Performance goals per client per month |
| `/api/team` | GET | Team members |
| `/api/billing` | GET | Billing data |
| `/api/auth/login` | POST | Login endpoint |

---

## Database Tables

### `reporting_clients` (primary table for the dashboard)

| Column | Type | Description |
|--------|------|-------------|
| `id` | uuid | Primary key |
| `client_id` | uuid | FK to `clients` table (for contact info, Drive links, etc.) |
| `client_name` | text | Display name on dashboard |
| `platform` | text | `meta` or `google` |
| `segment_name` | text | Optional campaign segment (e.g., "Asphalt & Paving") |
| `ad_account_id` | text | Meta: `act_XXXXX`. Google: numeric customer ID. |
| `monthly_budget` | numeric | Expected monthly ad spend |
| `monthly_revenue` | numeric | Manual revenue value |
| `fee_config` | jsonb | Fee calculation structure (see fee-engine.ts) |
| `revenue_override` | boolean | When true, `monthly_revenue` is manually set |
| `goal_type` | text | Target metric: `conversions`, `cpl`, `cpa`, `roas`, `spend` |
| `goal_target` | numeric | Target value for the goal |
| `priority` | text | `high`, `medium`, `low` |
| `account_manager` | text | Short name (e.g., "Peterson", "Cade") |
| `platform_operator` | text | Short name of ad operator |
| `status` | text | `active`, `paused`, `churned` |
| `client_type` | text | `lead_gen` or `ecom` |
| `notes` | text | Manual notes (NEVER auto-populated by agents) |
| `report_token` | uuid | Token for public client report URL |

### `clients` (reference table)

Stores contact info, Drive/ClickUp links, contract URLs, etc. Joined via `reporting_clients.client_id`.

Key columns: `primary_contact_name`, `primary_contact_email`, `gdrive_folder_id`, `clickup_folder_id`, `contract_url`, `gchat_url`, `website`.

---

## Environment Variables

| Var | Used by |
|-----|---------|
| `NEXT_PUBLIC_SUPABASE_URL` | Supabase client |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | Supabase client (anon) |
| `SUPABASE_SERVICE_ROLE_KEY` | Supabase server writes |
| `DASHBOARD_SESSION_SECRET` | Auth middleware |
| `PIPEBOARD_API_KEY` | Meta Ads via PipeBoard |
| `GOOGLE_ADS_CLIENT_ID` | Google Ads API |
| `GOOGLE_ADS_CLIENT_SECRET` | Google Ads API |
| `GOOGLE_ADS_DEVELOPER_TOKEN` | Google Ads API |
| `GOOGLE_ADS_MCC_ID` | Google Ads MCC account |
| `GOOGLE_ADS_REFRESH_TOKEN` | Google Ads OAuth |

---

## Important Rules

1. **Notes are manual only.** Never auto-populate `reporting_clients.notes`. Only Peterson or Cade add notes.
2. **Partners are not clients.** Bottle.com, Comet Fuel, FirstUp Marketing, Full Circle Media, Suff Digital are filtered from the client table and profitability calculations.
3. **Every client has a unique fee structure.** Always check `fee_config` — never assume the "standard" model.
4. **Meta accounts need `act_` prefix.** All Meta `ad_account_id` values must start with `act_`.
5. **Contract URLs use `crm.getpinnacle.ai`** format: `https://crm.getpinnacle.ai/v2/location/pNy8KMWRuGF2sGihGTMo/payments/proposals-estimates/edit/{docId}`
6. **Use `text-[var(--text-primary)]`** for any text on dark backgrounds, not `text-slate-900`.
7. **Use `.maybeSingle()`** not `.single()` for Supabase queries that might return 0 rows.
8. **Google Ads `status` is numeric.** Always coerce with `String()` before calling `.toLowerCase()`.
9. **`output: standalone`** is set in next.config but Railway runs `next start` (with a warning). Do NOT change the start command to `node .next/standalone/server.js` — it crashes.

---

## Known Issues

- `last-contact` API has missing table/column errors (`gmail_messages`, `gchat_summaries.summary_date`, `fathom_entries.call_date`). Pre-existing, doesn't crash anything.
- `next start` shows a warning about standalone mode. Harmless.
- ROAS in Current column only shows when conversion value data is available. Google accounts need conversion value tracking configured.
