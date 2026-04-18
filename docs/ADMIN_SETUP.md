# Admin Setup: GitHub Rulesets for Contractor Access

## Status: LIVE

Both rulesets are already configured on `creekside-marketing/creekside-dashboard`. Classic branch protection on `main` has been removed and replaced by these rulesets. This doc is the reference for maintaining them.

## Purpose

Contractors push directly to `main` so they can ship report edits without a PR review cycle, but they **cannot** modify the shared report templates, tooling scripts, or infrastructure config. Enforced by two separate GitHub Rulesets with different bypass lists.

## Current configuration

### Ruleset 1: `Allow-direct-push-main` (id 15243877)
- **Target:** branch (default branch = `main`)
- **Enforcement:** active
- **Rule:** Require a pull request before merging (1 approval)
- **Bypass list:**
  - Organization admins (`always`) — covers Peterson + Cade
  - Team `contractors` id 17022260 (`always`) — covers every contractor in that team
- **Effect:** anyone on the bypass list pushes directly to main; anyone not on it has to open a PR.

### Ruleset 2: `Protect-shared-infrastructure` (id 15243878)
- **Target:** push (all branches, all pushes)
- **Enforcement:** active
- **Rule:** Restrict file paths. Restricted paths:
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
- **Bypass list:** Organization admins only — covers Peterson + Cade.
- **Effect:** any push touching one of these paths is rejected unless the pusher is an org admin. Contractors can freely edit `src/components/reports/custom/**`, `docs/`, and anywhere else not listed.

## Why two rulesets?

GitHub Rulesets apply the bypass list at the **ruleset level**, not per-rule. You cannot have one ruleset where contractors bypass rule A but not rule B. So we split:

- Ruleset 1 bypass includes contractors → they skip the PR requirement.
- Ruleset 2 bypass is admins only → contractors can't touch restricted paths.

## Maintenance

### Adding a new contractor
1. Add them to the org as a member.
2. Add them to the `contractors` team (`https://github.com/orgs/creekside-marketing/teams/contractors/members`).
3. Grant the `contractors` team push access to `creekside-dashboard` (already done; confirm if adding a second repo).
4. Share `docs/CONTRACTOR_GUIDE.md` with them.

Do NOT add them to Ruleset 2's bypass list. That stays admin-only.

### Adding a new org admin
Org admins automatically bypass both rulesets. Use sparingly — admins can touch any file. Current admins: Peterson, Cade.

### Adding a new restricted path
When you add a new shared template or infra file, update Ruleset 2:
```bash
gh api -X PUT /repos/creekside-marketing/creekside-dashboard/rulesets/15243878 \
  -F 'rules[0].parameters.restricted_file_paths[]=<new-path>' ...
```
Or use the web UI at `https://github.com/creekside-marketing/creekside-dashboard/rules/15243878`.

Err on the side of over-protecting.

### Removing the protections (emergency)
```bash
gh api -X DELETE /repos/creekside-marketing/creekside-dashboard/rulesets/15243877
gh api -X DELETE /repos/creekside-marketing/creekside-dashboard/rulesets/15243878
```

## Testing the setup

From an account that is NOT an org admin (use a test account or ask a contractor):

1. **Negative test — should reject:** trivial edit to `src/components/reports/LeadGenGoogleReport.tsx` and push. Expected error:
   ```
   Repository rule violations: File path restriction: changes to 'src/components/reports/LeadGenGoogleReport.tsx' are not allowed
   ```
2. **Positive test — should succeed:** run `npm run branch-report -- "Test Client" google`, edit the generated file in `src/components/reports/custom/`, and push. No rule violations.

If the negative test passes (push succeeds when it shouldn't), the bypass list has drifted — verify the contractor is not accidentally an org admin and the `contractors` team is not on Ruleset 2.

## Notes

- **Push-time rejection ≠ deploy-time failure.** If a push succeeds but the dashboard isn't updating, check Railway deploy logs — separate system.
- **Contractors can read everything.** Rulesets only restrict writes. Contractors can browse the full codebase.
- **Classic branch protection has been removed.** All enforcement is via rulesets. Do not re-add classic BP — it can conflict.
