# Admin Setup: GitHub Rulesets for Contractor Access

## Purpose

Contractors push directly to `main` so they can ship report edits without a PR review cycle, but they **cannot** modify the shared report templates, tooling scripts, or infrastructure config. This is enforced by two separate GitHub Rulesets — one that lets contractors bypass the PR requirement, and one that blocks them from touching protected paths.

---

## Why two rulesets?

GitHub Rulesets apply the bypass list at the **ruleset level**, not per-rule. You cannot have one ruleset where contractors bypass rule A but not rule B. So we use two rulesets with different bypass lists:

- **Ruleset 1** (`Allow-direct-push-main`): contractors bypass this → they can push to main without a PR.
- **Ruleset 2** (`Protect-shared-infrastructure`): contractors do NOT bypass this → their pushes are rejected if they touch protected files.

---

## Step-by-step: create the rulesets

Go to https://github.com/creekside-marketing/creekside-dashboard/settings/rules.

### Ruleset 1: `Allow-direct-push-main`

1. Click **New ruleset** → **New branch ruleset**.
2. **Ruleset name:** `Allow-direct-push-main`
3. **Enforcement status:** Active
4. **Bypass list — add:**
   - Peterson (by GitHub handle)
   - Each contractor (by GitHub handle)
   - Railway deploy app (if it shows up in the list as a GitHub App)
5. **Target branches:** Include default branch (main)
6. **Rules:** enable only **Require a pull request before merging**. Leave all sub-options at defaults.
7. Click **Create**.

**What this does:** the baseline rule says "require a PR before merging to main." The bypass list exempts contractors from that requirement, so they can push directly.

### Ruleset 2: `Protect-shared-infrastructure`

1. Click **New ruleset** → **New branch ruleset**.
2. **Ruleset name:** `Protect-shared-infrastructure`
3. **Enforcement status:** Active
4. **Bypass list — add Peterson ONLY.** No contractors. No apps.
5. **Target branches:** Include default branch (main)
6. **Rules:** enable **Restrict file paths**. Add each of these paths to the restricted list:

   ```
   src/components/reports/LeadGenGoogleReport.tsx
   src/components/reports/LeadGenMetaReport.tsx
   src/components/reports/EcomGoogleReport.tsx
   src/components/reports/EcomMetaReport.tsx
   src/components/reports/TabbedReport.tsx
   src/components/reports/types.ts
   scripts/**
   .github/**
   package.json
   package-lock.json
   tsconfig.json
   next.config.ts
   src/lib/supabase.ts
   src/app/api/**
   src/middleware.ts
   ```

7. Click **Create**.

**What this does:** any push that touches one of these paths is rejected unless the pusher is on the bypass list (Peterson only). Contractors can freely edit `src/components/reports/custom/**` and anywhere else not listed.

*Note: `src/middleware.ts` is included preemptively — even if it gets deleted in the future, it's locked down against anyone re-adding a modified version without review.*

---

## Adding a new contractor

1. Go to **Settings → Rules → `Allow-direct-push-main` → Bypass list**.
2. Add the contractor's GitHub handle.
3. Share the link to `docs/CONTRACTOR_GUIDE.md` with them.
4. **Do NOT** add them to `Protect-shared-infrastructure`'s bypass list. That stays Peterson-only.

Make sure the contractor has been granted collaborator access to the repo itself (Settings → Collaborators) — bypass entries require they can push in the first place.

---

## Testing the setup

Sanity-check it works. From an account that is NOT on the `Protect-shared-infrastructure` bypass list (ask a contractor, or use a test account):

1. **Negative test — should reject:** make a trivial edit to `src/components/reports/LeadGenGoogleReport.tsx` and push. Expect:

   ```
   Repository rule violations: File path restriction: changes to 'src/components/reports/LeadGenGoogleReport.tsx' are not allowed
   ```

2. **Positive test — should succeed:** run `npm run branch-report -- "Test Client" google`, edit the generated file in `src/components/reports/custom/`, and push. Should succeed with no rule violations.

If the negative test passes (push succeeds when it shouldn't), the bypass list has drifted — check that the test account isn't accidentally listed on Ruleset 2.

---

## Notes

- **Bypass is per-ruleset, not per-rule.** That's the whole reason this uses two rulesets instead of one with mixed rules.
- **Push-time rejection ≠ deploy-time failure.** If a push succeeds but the dashboard isn't updating, check Railway's deploy logs — that's a separate system. Ruleset rejection happens at `git push`; Railway failures happen after.
- **Editing the protected list:** whenever a new shared template or infra file is added (e.g., a new `src/components/reports/SomeNewSharedThing.tsx`), add it to Ruleset 2's path list. Err on the side of over-protecting.
- **Contractors can read everything.** The rulesets only restrict *writes*. Contractors can still browse the full codebase — helpful for copying patterns from existing custom reports.
