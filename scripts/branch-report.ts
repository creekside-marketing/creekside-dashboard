#!/usr/bin/env tsx
/**
 * branch-report.ts — Branch a client's report from the shared default template
 *                    into a standalone customizable file.
 *
 * Usage: npm run branch-report -- "<client name>" <google|meta>
 *
 * CANNOT: Create more than one branch per (client, platform) — idempotency is mandatory.
 * CANNOT: Modify default report components under src/components/reports/*.tsx.
 * CANNOT: Change TabbedReport routing — it already handles report_mode='custom'.
 * CANNOT: Run with the Supabase anon key — writes silently fail. Service role required.
 * CANNOT: Skip git hooks (no --no-verify) or force-push.
 * CANNOT: Run with staged changes in the git index — would commit unrelated work.
 * CANNOT: Run on any branch other than main — contractors push straight to main.
 *
 * Flow:
 *   1. Resolve the client by (name ILIKE, platform) from reporting_clients.
 *   2. Derive slug: <kebab(client_name)>-<platform>.
 *   3. Idempotency check: if report_mode='custom' + slug set + file + registry entry → exit 0.
 *   4. Pick template by (client_type, platform).
 *   5. Copy template → src/components/reports/custom/<slug>.tsx, rename exported fn.
 *   6. Update registry.tsx (preserve existing entries, alphabetical order).
 *   7. UPDATE reporting_clients SET report_mode='custom', custom_report_slug=<slug>.
 *   8. Run `npx tsc --noEmit`. On failure, roll back all file + DB changes.
 *   9. Commit + push to origin main. No --no-verify.
 *  10. Print summary.
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync, rmSync, cpSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { createClient, SupabaseClient } from '@supabase/supabase-js';

// ── Types ────────────────────────────────────────────────────────────────

type Platform = 'google' | 'meta';
type ClientType = 'lead_gen' | 'ecom';

interface ReportingClientRow {
  id: string;
  client_name: string;
  platform: Platform;
  client_type: ClientType | null;
  report_mode: string | null;
  custom_report_slug: string | null;
}

interface TemplateConfig {
  filename: string;
  componentName: string;
}

// ── Constants ────────────────────────────────────────────────────────────

const REPO_ROOT = resolve(__dirname, '..');
const REPORTS_DIR = join(REPO_ROOT, 'src', 'components', 'reports');
const CUSTOM_DIR = join(REPORTS_DIR, 'custom');
const REGISTRY_PATH = join(CUSTOM_DIR, 'registry.tsx');
const ENV_LOCAL = join(REPO_ROOT, '.env.local');

const TEMPLATES: Record<`${ClientType}-${Platform}`, TemplateConfig> = {
  'lead_gen-google': { filename: 'LeadGenGoogleReport.tsx', componentName: 'LeadGenGoogleReport' },
  'lead_gen-meta':   { filename: 'LeadGenMetaReport.tsx',   componentName: 'LeadGenMetaReport' },
  'ecom-google':     { filename: 'EcomGoogleReport.tsx',    componentName: 'EcomGoogleReport' },
  'ecom-meta':       { filename: 'EcomMetaReport.tsx',      componentName: 'EcomMetaReport' },
};

// ── Logging ──────────────────────────────────────────────────────────────

function die(message: string): never {
  console.error(`\n[branch-report] ERROR: ${message}\n`);
  process.exit(1);
}

function info(message: string): void {
  console.log(`[branch-report] ${message}`);
}

// ── Env loader (minimal, does not overwrite real env) ───────────────────

function loadDotEnvLocal(): void {
  if (!existsSync(ENV_LOCAL)) return;
  const raw = readFileSync(ENV_LOCAL, 'utf8');
  for (const line of raw.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const eq = trimmed.indexOf('=');
    if (eq === -1) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

// ── Pre-flight git checks ────────────────────────────────────────────────

/**
 * Verify the contractor's repo is in a safe state to run the script:
 *   1. No staged changes in the index (otherwise `git commit` would ship them).
 *   2. Current branch is `main` (contractors push straight to main).
 *
 * Called before any DB queries or file writes so we fail fast and cheaply.
 */
function preflightGitChecks(): void {
  const stagedDiff = spawnSync('git', ['diff', '--cached', '--quiet'], { cwd: REPO_ROOT });
  if (stagedDiff.status !== 0) {
    die('Git index has staged changes. Commit or unstage them before running branch-report. Run `git status` to see what is staged.');
  }

  const branchResult = spawnSync('git', ['rev-parse', '--abbrev-ref', 'HEAD'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  });
  if (branchResult.status !== 0) {
    die(`Could not determine current git branch: ${branchResult.stderr ?? ''}`);
  }
  const branch = (branchResult.stdout ?? '').trim();
  if (branch !== 'main') {
    die(`Current branch is "${branch}", but branch-report must run on main. Switch with: git checkout main`);
  }
}

// ── Arg parsing ──────────────────────────────────────────────────────────

function parseArgs(): { clientName: string; platform: Platform; force: boolean } {
  // Accept `--force` in any position. Everything else must be exactly
  // <client name> <platform>.
  const raw = process.argv.slice(2);
  const force = raw.includes('--force');
  const args = raw.filter(a => a !== '--force');
  if (args.length !== 2) {
    die('Usage: npm run branch-report -- "<client name>" <google|meta> [--force]');
  }
  const [clientName, platformRaw] = args;
  const platform = platformRaw.toLowerCase();
  if (platform !== 'google' && platform !== 'meta') {
    die(`Platform must be "google" or "meta" (got "${platformRaw}")`);
  }
  if (!clientName.trim()) die('Client name cannot be empty');
  return { clientName: clientName.trim(), platform, force };
}

// ── Slug + PascalCase derivation ─────────────────────────────────────────

function kebabCase(input: string): string {
  return input
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

function pascalCase(input: string): string {
  return input
    .split('-')
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join('');
}

function deriveSlug(clientName: string, platform: Platform): string {
  const base = kebabCase(clientName);
  if (!base) die(`Cannot derive slug from client name "${clientName}"`);
  return `${base}-${platform}`;
}

// ── Supabase ─────────────────────────────────────────────────────────────

function getSupabase(): SupabaseClient {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url) die('NEXT_PUBLIC_SUPABASE_URL is not set (check .env.local)');
  if (!serviceKey) die('SUPABASE_SERVICE_ROLE_KEY is not set — writes require the service role key, anon silently fails (check .env.local)');
  return createClient(url, serviceKey, { auth: { persistSession: false } });
}

async function findClient(supabase: SupabaseClient, clientName: string, platform: Platform): Promise<ReportingClientRow> {
  // Substring match so "Fusion" finds "Fusion Dental Implants". If a contractor
  // typed the exact full name, the `%...%` still matches (trailing wildcards).
  const { data, error } = await supabase
    .from('reporting_clients')
    .select('id, client_name, platform, client_type, report_mode, custom_report_slug')
    .ilike('client_name', `%${clientName}%`)
    .eq('platform', platform);

  if (error) die(`Supabase query failed: ${error.message}`);

  if (!data || data.length === 0) {
    // Zero matches — fetch up to 5 client names on the same platform so the
    // contractor has something to pick from instead of a dead-end error.
    const { data: hintData } = await supabase
      .from('reporting_clients')
      .select('client_name')
      .eq('platform', platform)
      .limit(5);
    const hintNames = (hintData ?? []).map(r => r.client_name).filter(Boolean);
    const hint = hintNames.length
      ? `\nDid you mean one of: ${hintNames.join(', ')}?`
      : '';
    die(`No reporting_clients row matches client_name ILIKE "%${clientName}%" AND platform="${platform}".${hint}`);
  }

  if (data.length > 1) {
    // Show the contractor each matching name + platform so they can rerun with
    // the exact name. Include id as a tiebreaker in case two clients share a name.
    const lines = data.map(r => `  - ${r.client_name} (${r.platform})`).join('\n');
    die(
      `Multiple clients match "${clientName}":\n${lines}\n` +
      `Re-run with the full exact name.`,
    );
  }
  return data[0] as ReportingClientRow;
}

async function updateReportMode(supabase: SupabaseClient, clientId: string, slug: string): Promise<void> {
  const { data, error } = await supabase
    .from('reporting_clients')
    .update({ report_mode: 'custom', custom_report_slug: slug })
    .eq('id', clientId)
    .select();
  if (error) die(`Supabase update failed: ${error.message}`);
  if (!data || data.length !== 1) {
    die(`Supabase update affected ${data?.length ?? 0} rows (expected 1) for reporting_clients.id=${clientId}`);
  }
}

async function revertReportMode(supabase: SupabaseClient, clientId: string): Promise<void> {
  const { data, error } = await supabase
    .from('reporting_clients')
    .update({ report_mode: 'default', custom_report_slug: null })
    .eq('id', clientId)
    .select();
  if (error) {
    console.warn(`[branch-report] Revert failed for reporting_clients.id=${clientId}: ${error.message}`);
    return;
  }
  if (!data || data.length !== 1) {
    console.warn(`[branch-report] Revert affected ${data?.length ?? 0} rows (expected 1) for reporting_clients.id=${clientId}`);
  }
}

// ── Idempotency check ────────────────────────────────────────────────────

function registryHasEntry(slug: string): boolean {
  if (!existsSync(REGISTRY_PATH)) return false;
  const contents = readFileSync(REGISTRY_PATH, 'utf8');
  // Look for an active (non-commented) entry. We scan line-by-line so that
  // commented example lines starting with `//` don't count.
  for (const rawLine of contents.split('\n')) {
    const line = rawLine.trim();
    if (line.startsWith('//')) continue;
    if (line.includes(`'${slug}':`) || line.includes(`"${slug}":`)) return true;
  }
  return false;
}

function branchFileExists(slug: string): boolean {
  return existsSync(join(CUSTOM_DIR, `${slug}.tsx`));
}

// ── Template copy + rename ───────────────────────────────────────────────

function resolveTemplate(client: ReportingClientRow, platform: Platform): TemplateConfig {
  if (!client.client_type) die(`Client "${client.client_name}" has no client_type — cannot pick template`);
  const key = `${client.client_type}-${platform}` as const;
  const tmpl = TEMPLATES[key];
  if (!tmpl) die(`No template mapped for (${client.client_type}, ${platform})`);
  return tmpl;
}

/**
 * Find all sibling-relative and parent-relative import paths in a source file.
 * Returns the raw path strings as they appear in the source (e.g., "./X", "../shared").
 * Handles both single-line `from './X'` and dynamic `import('./X')`.
 */
function findRelativeImports(src: string): string[] {
  const paths: string[] = [];
  const fromRe = /from\s+['"](\.[^'"]+)['"]/g;
  const dynRe = /import\(\s*['"](\.[^'"]+)['"]\s*\)/g;
  let m: RegExpExecArray | null;
  while ((m = fromRe.exec(src)) !== null) paths.push(m[1]);
  while ((m = dynRe.exec(src)) !== null) paths.push(m[1]);
  return paths;
}

/**
 * Resolve a relative import path against a source file path. Tries .tsx, .ts,
 * then /index.tsx, /index.ts. Returns absolute path on success, null otherwise.
 */
function resolveImportPath(importPath: string, fromFile: string): string | null {
  const basePath = resolve(dirname(fromFile), importPath);
  for (const ext of ['.tsx', '.ts', '.jsx', '.js']) {
    if (existsSync(basePath + ext)) return basePath + ext;
  }
  for (const ext of ['.tsx', '.ts']) {
    const idxPath = join(basePath, 'index' + ext);
    if (existsSync(idxPath)) return idxPath;
  }
  if (existsSync(basePath) && !existsSync(basePath + '.tsx')) {
    // Direct file match (e.g. .css would go here, but our code only has TS)
    return basePath;
  }
  return null;
}

/**
 * Deep-branch a template: copy the template + every transitive relative import
 * into a scoped directory so the branch is fully self-contained. Contractors
 * can edit any file in the scoped dir without affecting other clients.
 *
 * Layout produced:
 *   src/components/reports/custom/<slug>.tsx              ← main entry (renamed component)
 *   src/components/reports/custom/_<slug>/...             ← scoped copies of every dep
 *
 * The main entry's relative imports are rewritten from `./X` to `./_<slug>/X`.
 * Files inside `_<slug>/` keep their own relative imports unchanged — their
 * directory structure mirrors the original reports/ tree so relative paths
 * among them continue to resolve correctly.
 *
 * Imports that escape reports/ (e.g. `@/components/X`) are left as-is — those
 * refer to app-wide components outside the reports system.
 *
 * Returns paths of: the main branch file + the scoped dir (both for rollback).
 */
function deepBranchTemplate(
  template: TemplateConfig,
  slug: string,
  newComponentName: string,
): { mainFile: string; scopedDir: string } {
  const templateAbs = join(REPORTS_DIR, template.filename);
  if (!existsSync(templateAbs)) die(`Template not found: ${templateAbs}`);

  const mainDest = join(CUSTOM_DIR, `${slug}.tsx`);
  const scopedDir = join(CUSTOM_DIR, `_${slug}`);

  if (existsSync(mainDest)) die(`Destination already exists but failed idempotency check: ${mainDest}`);
  if (existsSync(scopedDir)) die(`Scoped dir already exists but failed idempotency check: ${scopedDir}`);

  mkdirSync(scopedDir, { recursive: true });

  // Recursively copy every internal dep into the scoped dir, preserving the
  // directory structure relative to REPORTS_DIR. We skip anything under
  // reports/custom/ (branches should never depend on other branches) and
  // anything outside reports/ (those remain as external @/ imports).
  const visited = new Set<string>();
  const CUSTOM_SUBDIR = join(REPORTS_DIR, 'custom');

  function copyInternal(absPath: string): void {
    if (visited.has(absPath)) return;
    visited.add(absPath);

    // Only copy files inside reports/ and not inside reports/custom/.
    if (!absPath.startsWith(REPORTS_DIR + sep)) return;
    if (absPath.startsWith(CUSTOM_SUBDIR + sep)) return;

    const relFromReports = relative(REPORTS_DIR, absPath);
    const destInScoped = join(scopedDir, relFromReports);

    mkdirSync(dirname(destInScoped), { recursive: true });

    const source = readFileSync(absPath, 'utf8');

    // Recurse on every relative import, then copy verbatim. Copying verbatim
    // is safe because the scoped tree mirrors the source structure — relative
    // paths among copied files continue to resolve.
    for (const impPath of findRelativeImports(source)) {
      const resolved = resolveImportPath(impPath, absPath);
      if (resolved) copyInternal(resolved);
    }

    writeFileSync(destInScoped, source);
  }

  // Start the walk from the template. Wrap in try/catch so any I/O failure
  // (permissions, mid-walk crash, disk full) triggers cleanup of the partial
  // scoped dir — otherwise the next run would hit "already exists" and require
  // manual cleanup. The cleanup path is guarded by a prefix check so we never
  // rmSync something outside CUSTOM_DIR.
  try {
    copyInternal(templateAbs);

    // The template itself got copied into scopedDir/<filename>. We don't want it
    // there — the main entry lives at custom/<slug>.tsx. Read, delete, rewrite,
    // write to its final home.
    const templateInScoped = join(scopedDir, template.filename);
    if (!existsSync(templateInScoped)) {
      die(`Internal error: template was not copied into scoped dir (${templateInScoped})`);
    }
    let mainSource = readFileSync(templateInScoped, 'utf8');
    unlinkSync(templateInScoped);

    // Rewrite `./X` (sibling relative to original reports/) → `./_<slug>/X` so
    // the main entry pulls from its scoped copies. Parent-relative `../` paths
    // in a reports/ file would escape into src/components/, which would mean
    // the file depends on non-reports code — shouldn't happen for templates.
    mainSource = mainSource
      .replace(/from\s+(['"])\.\/(?!\.)/g, `from $1./_${slug}/`)
      .replace(/import\(\s*(['"])\.\/(?!\.)/g, `import($1./_${slug}/`);

    // Rename the exported component for uniqueness in the registry.
    const before = mainSource;
    mainSource = mainSource.replace(
      new RegExp(`\\b${template.componentName}\\b`, 'g'),
      newComponentName,
    );
    if (mainSource === before) {
      die(`Failed to rename component — did not find "${template.componentName}" in ${template.filename}`);
    }

    // Prepend a drift-warning header so Peterson (or a future reader) knows
    // the file is a static fork — upstream template changes do NOT propagate.
    const today = new Date().toISOString().slice(0, 10);
    const driftHeader =
      `/**\n` +
      ` * Branched from ${template.filename} on ${today}.\n` +
      ` * Standalone per-client fork — upstream template changes do NOT auto-propagate.\n` +
      ` * To re-sync from the latest template, re-run:\n` +
      ` *   npm run branch-report -- "<client>" ${/-google$/.test(slug) ? 'google' : 'meta'} --force\n` +
      ` */\n`;

    // Insert the header AFTER any 'use client' directive so directive remains
    // first in the file (Next.js requirement).
    if (mainSource.trimStart().startsWith(`'use client'`) || mainSource.trimStart().startsWith(`"use client"`)) {
      mainSource = mainSource.replace(
        /^(\s*['"]use client['"];?\s*)/,
        `$1\n${driftHeader}`,
      );
    } else {
      mainSource = driftHeader + mainSource;
    }

    writeFileSync(mainDest, mainSource);
    return { mainFile: mainDest, scopedDir };
  } catch (err) {
    // Roll back any partial state from this call before re-throwing.
    // Guard rmSync with a prefix check so a bug can never nuke outside CUSTOM_DIR.
    if (scopedDir.startsWith(CUSTOM_DIR + sep) && existsSync(scopedDir)) {
      try { rmSync(scopedDir, { recursive: true, force: true }); }
      catch (cleanupErr) { console.warn('deepBranchTemplate cleanup (scopedDir) failed:', (cleanupErr as Error).message); }
    }
    if (mainDest.startsWith(CUSTOM_DIR + sep) && existsSync(mainDest)) {
      try { unlinkSync(mainDest); }
      catch (cleanupErr) { console.warn('deepBranchTemplate cleanup (mainDest) failed:', (cleanupErr as Error).message); }
    }
    throw err;
  }
}

/**
 * Clean up a branch's filesystem footprint. Safe to call for rollback even if
 * some pieces are missing. Errors are logged (not thrown) so rollback of
 * OTHER state (DB, registry) is never blocked by a filesystem hiccup.
 */
function cleanupBranchFiles(mainFile: string, scopedDir: string): void {
  try { if (existsSync(mainFile)) unlinkSync(mainFile); }
  catch (e) { console.warn('Failed to delete branch file during cleanup:', (e as Error).message); }
  try { if (existsSync(scopedDir)) rmSync(scopedDir, { recursive: true, force: true }); }
  catch (e) { console.warn('Failed to delete scoped dir during cleanup:', (e as Error).message); }
}

// ── Registry update (preserve + alphabetical) ────────────────────────────

function addRegistryEntry(slug: string): { previousContents: string } {
  const previousContents = readFileSync(REGISTRY_PATH, 'utf8');
  const marker = 'const registry: Record<string, ComponentType<ReportProps>> = {';
  const openIdx = previousContents.indexOf(marker);
  if (openIdx === -1) die(`Could not find registry declaration in ${REGISTRY_PATH}`);
  const afterOpen = openIdx + marker.length;

  // Find the matching closing brace + ';' that ends the registry object.
  // The next '};' after the declaration is the terminator.
  const closeIdx = previousContents.indexOf('};', afterOpen);
  if (closeIdx === -1) die(`Could not find end of registry object in ${REGISTRY_PATH}`);

  const body = previousContents.slice(afterOpen, closeIdx);
  const tail = previousContents.slice(closeIdx);

  // Parse existing active (non-commented) entries. We preserve every line
  // (including comments and example lines), but we re-order the active
  // entries alphabetically and splice the new entry into the sorted position.
  const bodyLines = body.split('\n');
  const preservedLines: string[] = [];
  const activeEntries: { slug: string; line: string }[] = [];

  const entryRe = /^\s*['"]([a-z0-9-]+)['"]\s*:\s*dynamic\(/;

  for (const line of bodyLines) {
    const trimmed = line.trim();
    if (trimmed.startsWith('//')) {
      preservedLines.push(line);
      continue;
    }
    const m = line.match(entryRe);
    if (m) {
      activeEntries.push({ slug: m[1], line });
    } else {
      preservedLines.push(line);
    }
  }

  // Add new entry and sort alphabetically by slug.
  const newLine = `  '${slug}': dynamic(() => import('./${slug}'), { loading: Spinner }),`;
  activeEntries.push({ slug, line: newLine });
  activeEntries.sort((a, b) => a.slug.localeCompare(b.slug));

  // Reassemble: strip leading/trailing empty lines from preserved block,
  // then keep comments above the sorted entries for readability.
  // Simple and predictable: preserved lines first (as-is), then active entries.
  // Drop one trailing empty line from preserved if present so spacing is tidy.
  while (preservedLines.length && preservedLines[preservedLines.length - 1].trim() === '') {
    preservedLines.pop();
  }
  while (preservedLines.length && preservedLines[0].trim() === '') {
    preservedLines.shift();
  }

  const newBody =
    '\n' +
    (preservedLines.length ? preservedLines.join('\n') + '\n' : '') +
    activeEntries.map(e => e.line).join('\n') +
    '\n';

  const updated = previousContents.slice(0, afterOpen) + newBody + tail;
  writeFileSync(REGISTRY_PATH, updated);
  return { previousContents };
}

function restoreRegistry(previousContents: string): void {
  writeFileSync(REGISTRY_PATH, previousContents);
}

// ── Typecheck ────────────────────────────────────────────────────────────

function runTypecheck(): { ok: boolean; output: string } {
  const result = spawnSync('npx', ['tsc', '--noEmit'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
    env: process.env,
  });
  const output = `${result.stdout ?? ''}${result.stderr ?? ''}`;
  return { ok: result.status === 0, output };
}

// ── Git ──────────────────────────────────────────────────────────────────

function git(args: string[]): { status: number; stdout: string; stderr: string } {
  const result = spawnSync('git', args, { cwd: REPO_ROOT, encoding: 'utf8' });
  return { status: result.status ?? 1, stdout: result.stdout ?? '', stderr: result.stderr ?? '' };
}

interface PushRollbackContext {
  mainFile: string;
  scopedDir: string;
  prevRegistry: string;
  supabase: SupabaseClient;
  clientId: string;
}

/**
 * Stage, commit, and push the branch file + registry change. On push failure,
 * try once to rebase + re-push. If that still fails, roll back EVERYTHING the
 * script changed so the contractor is not left with a half-applied state that
 * would 500 the dashboard (local commit + DB custom_mode but no deployed file).
 *
 * Rollback steps on final push failure:
 *   1. Verify HEAD commit is the one WE just made (author + subject check).
 *   2. `git reset --hard HEAD~1` — drop the local commit.
 *   3. Delete the branch file (reset --hard already handles this for tracked
 *      files after the commit was made, but belt-and-suspenders in case the
 *      file existed untracked beforehand).
 *   4. Restore registry.tsx from snapshot (covered by reset too; redundant
 *      safety for the same reason).
 *   5. Revert reporting_clients.report_mode back to default in Supabase.
 */
async function commitAndPush(
  clientName: string,
  platform: Platform,
  slug: string,
  rollback: PushRollbackContext,
): Promise<{ sha: string }> {
  const { mainFile, scopedDir, prevRegistry, supabase, clientId } = rollback;

  const addA = git(['add', mainFile, scopedDir, REGISTRY_PATH]);
  if (addA.status !== 0) die(`git add failed: ${addA.stderr || addA.stdout}`);

  const relBranch = mainFile.replace(`${REPO_ROOT}/`, '');
  const relScoped = scopedDir.replace(`${REPO_ROOT}/`, '');
  const commitSubject = `chore: branch report for ${clientName} (${platform})`;
  const message = `${commitSubject}\n\nSlug: ${slug}\nMain: ${relBranch}\nScoped deps: ${relScoped}/`;

  const commit = git(['commit', '-m', message]);
  if (commit.status !== 0) die(`git commit failed: ${commit.stderr || commit.stdout}`);

  const rev = git(['rev-parse', 'HEAD']);
  const sha = rev.stdout.trim().slice(0, 12);

  // First push attempt.
  let push = git(['push', 'origin', 'main']);
  if (push.status === 0) return { sha };

  // Retry once: pull --rebase then push. Covers the common "remote has new
  // commits" case without any destructive operations.
  console.warn(`\n[branch-report] Initial push failed. Attempting rebase + retry...`);
  console.warn(`[branch-report] Push output:\n${push.stderr || push.stdout}`);
  const pullRebase = git(['pull', '--rebase', 'origin', 'main']);
  if (pullRebase.status === 0) {
    push = git(['push', 'origin', 'main']);
    if (push.status === 0) {
      // After rebase the commit SHA changed — recompute for accurate reporting.
      const rev2 = git(['rev-parse', 'HEAD']);
      return { sha: rev2.stdout.trim().slice(0, 12) };
    }
    console.warn(`[branch-report] Retry push output:\n${push.stderr || push.stdout}`);
  } else {
    console.warn(`[branch-report] Rebase failed:\n${pullRebase.stderr || pullRebase.stdout}`);
    // Abort the rebase to leave the tree in a predictable state before reset.
    git(['rebase', '--abort']);
  }

  // Full rollback. Before `git reset --hard`, verify HEAD really is our commit
  // so we never nuke someone else's work.
  console.error(`\n[branch-report] Push failed after retry. Rolling back all changes...`);

  const headSubject = git(['log', '-1', '--pretty=%s']).stdout.trim();
  if (headSubject !== commitSubject) {
    die(
      `ABORT: Cannot safely roll back. HEAD commit subject is "${headSubject}", ` +
      `expected "${commitSubject}". Your local commit was not reset and the ` +
      `DB is still in 'custom' mode. Resolve manually: inspect \`git log\`, ` +
      `revert reporting_clients.id=${clientId} to report_mode='default', ` +
      `and remove ${mainFile} + ${scopedDir}/ if present.`,
    );
  }

  const reset = git(['reset', '--hard', 'HEAD~1']);
  if (reset.status !== 0) {
    die(
      `ABORT: git reset --hard HEAD~1 failed: ${reset.stderr || reset.stdout}. ` +
      `Resolve manually.`,
    );
  }

  // reset --hard already reverts tracked files, but handle them defensively
  // in case anything existed untracked pre-commit.
  cleanupBranchFiles(mainFile, scopedDir);
  try { restoreRegistry(prevRegistry); }
  catch (e) { console.warn('Failed to restore registry during rollback:', (e as Error).message); }

  // DB revert — await so we don't die() before the revert round-trips.
  // revertReportMode itself warns on failure rather than throwing.
  await revertReportMode(supabase, clientId);

  die(
    `Your branch could not be pushed to origin/main — likely a branch ` +
    `protection rule or network issue. Nothing was left behind: the local ` +
    `commit was reset, the branch file was deleted, and the DB was reverted ` +
    `to report_mode='default'. Contact Peterson for push access, then rerun.`,
  );
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadDotEnvLocal();

  const { clientName, platform, force } = parseArgs();
  // Fail fast on a dirty index or non-main branch BEFORE any DB queries,
  // file writes, or template resolution — cheaper to bail here.
  preflightGitChecks();

  const slug = deriveSlug(clientName, platform);
  const componentName = pascalCase(slug) + 'Report';

  info(`Client: "${clientName}" | Platform: ${platform}${force ? ' | --force' : ''}`);
  info(`Target slug: ${slug}`);

  const supabase = getSupabase();
  const client = await findClient(supabase, clientName, platform);
  info(`Matched reporting_clients row ${client.id} (${client.client_name}, ${client.client_type})`);

  // ── Idempotency check ──
  const mainFilePath = join(CUSTOM_DIR, `${slug}.tsx`);
  const scopedDirPath = join(CUSTOM_DIR, `_${slug}`);
  const alreadyCustom = client.report_mode === 'custom' && client.custom_report_slug === slug;
  const fileExists = branchFileExists(slug);
  const scopedDirExists = existsSync(scopedDirPath);
  const registered = registryHasEntry(slug);

  if (!force && alreadyCustom && fileExists && registered) {
    console.log(`\n[branch-report] Already branched. Edit: src/components/reports/custom/${slug}.tsx\n`);
    console.log(`[branch-report] Scoped deps: src/components/reports/custom/_${slug}/`);
    console.log(`[branch-report] To re-branch from scratch, re-run with --force.\n`);
    process.exit(0);
  }

  // With --force, tear down existing state cleanly BEFORE proceeding. Revert
  // DB first so if anything goes wrong we're not stuck in a half-branched state.
  if (force && (alreadyCustom || fileExists || scopedDirExists || registered)) {
    info('--force specified — tearing down existing branch state');
    if (alreadyCustom) {
      await revertReportMode(supabase, client.id);
      info('  DB reverted to report_mode=default');
    }
    if (fileExists || scopedDirExists) {
      cleanupBranchFiles(mainFilePath, scopedDirPath);
      info('  Main file + scoped dir removed');
    }
    if (registered) {
      // Rebuild registry without this slug. Cheapest way: read, filter, write.
      const regContents = readFileSync(REGISTRY_PATH, 'utf8');
      const filtered = regContents
        .split('\n')
        .filter(line => {
          const trimmed = line.trim();
          if (trimmed.startsWith('//')) return true;
          return !(trimmed.includes(`'${slug}':`) || trimmed.includes(`"${slug}":`));
        })
        .join('\n');
      writeFileSync(REGISTRY_PATH, filtered);
      info('  Registry entry removed');
    }
  } else if (fileExists || registered || alreadyCustom || scopedDirExists) {
    // Partial state without --force: bail rather than silently "fixing" — safer.
    die(
      `Partial branch state detected — refusing to proceed to avoid duplicating work.\n` +
      `  file exists:       ${fileExists}\n` +
      `  scoped dir exists: ${scopedDirExists}\n` +
      `  registry entry:    ${registered}\n` +
      `  DB report_mode:    ${client.report_mode}\n` +
      `  DB custom_slug:    ${client.custom_report_slug}\n` +
      `Resolve manually (remove partial pieces) or re-run with --force to rebuild.`,
    );
  }

  // ── Template + deep copy ──
  const template = resolveTemplate(client, platform);
  info(`Template: ${template.filename}`);
  info(`  → main: custom/${slug}.tsx (component ${componentName})`);
  info(`  → deps: custom/_${slug}/`);
  const { mainFile, scopedDir } = deepBranchTemplate(template, slug, componentName);

  // ── Registry ──
  const { previousContents: prevRegistry } = addRegistryEntry(slug);
  info('Registry updated');

  // ── DB update ──
  await updateReportMode(supabase, client.id, slug);
  info('reporting_clients updated (report_mode=custom, custom_report_slug set)');

  // ── Typecheck ──
  info('Running tsc --noEmit ...');
  const tc = runTypecheck();
  if (!tc.ok) {
    console.error('\n[branch-report] Typecheck FAILED — rolling back all changes.\n');
    console.error(tc.output);
    cleanupBranchFiles(mainFile, scopedDir);
    restoreRegistry(prevRegistry);
    await revertReportMode(supabase, client.id);
    die('Rolled back. Fix the type errors above and re-run.');
  }
  info('Typecheck clean');

  // ── Commit + push ──
  // commitAndPush will die() with full rollback if push cannot succeed even
  // after a rebase retry, so reaching the next line means the push landed.
  const { sha } = await commitAndPush(client.client_name, platform, slug, {
    mainFile,
    scopedDir,
    prevRegistry,
    supabase,
    clientId: client.id,
  });

  // ── Summary ──
  console.log('\n────────────────────────────────────────');
  console.log(' Branch report created');
  console.log('────────────────────────────────────────');
  console.log(` Client:       ${client.client_name}`);
  console.log(` Platform:     ${platform}`);
  console.log(` Slug:         ${slug}`);
  console.log(` Main file:    src/components/reports/custom/${slug}.tsx`);
  console.log(` Scoped deps:  src/components/reports/custom/_${slug}/`);
  console.log(` Commit:       ${sha}`);
  console.log(` Push:         ok (origin main)`);
  console.log(` Deploy:       Railway will auto-deploy in ~2 min.`);
  console.log('────────────────────────────────────────');
  console.log(' Note: template updates do NOT auto-propagate to this branch.');
  console.log(`       If you later improve ${template.filename}, re-run with`);
  console.log(`       \`--force\` to re-sync this client.`);
  console.log('────────────────────────────────────────\n');
}

main().catch(err => {
  console.error('\n[branch-report] Unhandled error:', err);
  process.exit(1);
});
