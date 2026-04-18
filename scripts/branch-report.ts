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
import { existsSync, readFileSync, writeFileSync, unlinkSync } from 'node:fs';
import { join, resolve } from 'node:path';
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

// ── Arg parsing ──────────────────────────────────────────────────────────

function parseArgs(): { clientName: string; platform: Platform } {
  const args = process.argv.slice(2);
  if (args.length !== 2) {
    die('Usage: npm run branch-report -- "<client name>" <google|meta>');
  }
  const [clientName, platformRaw] = args;
  const platform = platformRaw.toLowerCase();
  if (platform !== 'google' && platform !== 'meta') {
    die(`Platform must be "google" or "meta" (got "${platformRaw}")`);
  }
  if (!clientName.trim()) die('Client name cannot be empty');
  return { clientName: clientName.trim(), platform };
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
  const { data, error } = await supabase
    .from('reporting_clients')
    .select('id, client_name, platform, client_type, report_mode, custom_report_slug')
    .ilike('client_name', clientName)
    .eq('platform', platform);

  if (error) die(`Supabase query failed: ${error.message}`);
  if (!data || data.length === 0) die(`No reporting_clients row matches client_name ILIKE "${clientName}" AND platform="${platform}"`);
  if (data.length > 1) {
    const names = data.map(r => `${r.client_name} (${r.id})`).join(', ');
    die(`Multiple matches — narrow the name. Matches: ${names}`);
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
 * Rewrite sibling-relative imports (`./x`) to parent-relative (`../x`) so
 * that a file copied from `src/components/reports/` into the `custom/`
 * subdirectory still resolves the same sibling modules.
 *
 * Handles:
 *   - `from './x'` and `from "./x"`
 *   - dynamic `import('./x')` / `import("./x")`
 *   - nested paths: `./shared/foo` → `../shared/foo`
 *
 * Does NOT rewrite:
 *   - absolute imports (`@/...`, `react`, `next/...`)
 *   - already parent-relative paths (`../x`) — the `(?!\.)` negative
 *     lookahead after `./` ensures we only match true sibling imports
 *     (the char after `./` must not be another `.`).
 */
function rewriteRelativeImports(src: string): string {
  return src
    .replace(/from\s+(['"])\.\/(?!\.)/g, 'from $1../')
    .replace(/import\(\s*(['"])\.\/(?!\.)/g, 'import($1../');
}

function copyAndRenameTemplate(template: TemplateConfig, slug: string, newComponentName: string): string {
  const src = join(REPORTS_DIR, template.filename);
  const dest = join(CUSTOM_DIR, `${slug}.tsx`);
  if (!existsSync(src)) die(`Template not found: ${src}`);
  if (existsSync(dest)) die(`Destination already exists but failed idempotency check: ${dest}`);

  // Read source, rewrite sibling-relative imports (since we move one level
  // deeper into `custom/`), then rename the exported component. Write once.
  const original = readFileSync(src, 'utf8');
  const rewritten = rewriteRelativeImports(original);
  const renamed = rewritten.replace(
    new RegExp(`\\b${template.componentName}\\b`, 'g'),
    newComponentName,
  );
  if (renamed === rewritten) {
    die(`Failed to rename component — did not find "${template.componentName}" in ${template.filename}`);
  }
  writeFileSync(dest, renamed);
  return dest;
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

function commitAndPush(clientName: string, platform: Platform, slug: string, branchFilePath: string): { sha: string; pushed: boolean } {
  const addA = git(['add', branchFilePath, REGISTRY_PATH]);
  if (addA.status !== 0) die(`git add failed: ${addA.stderr || addA.stdout}`);

  const relBranch = branchFilePath.replace(`${REPO_ROOT}/`, '');
  const message = `chore: branch report for ${clientName} (${platform})\n\nSlug: ${slug}\nFile: ${relBranch}`;

  const commit = git(['commit', '-m', message]);
  if (commit.status !== 0) die(`git commit failed: ${commit.stderr || commit.stdout}`);

  const rev = git(['rev-parse', 'HEAD']);
  const sha = rev.stdout.trim().slice(0, 12);

  const push = git(['push', 'origin', 'main']);
  const pushed = push.status === 0;
  if (!pushed) {
    console.warn(`\n[branch-report] WARNING: git push failed. Commit ${sha} is still on local main.`);
    console.warn(`[branch-report] Push output:\n${push.stderr || push.stdout}`);
    console.warn(`[branch-report] To retry: cd ${REPO_ROOT} && git push origin main\n`);
  }
  return { sha, pushed };
}

// ── Main ─────────────────────────────────────────────────────────────────

async function main(): Promise<void> {
  loadDotEnvLocal();

  const { clientName, platform } = parseArgs();
  const slug = deriveSlug(clientName, platform);
  const componentName = pascalCase(slug) + 'Report';

  info(`Client: "${clientName}" | Platform: ${platform}`);
  info(`Target slug: ${slug}`);

  const supabase = getSupabase();
  const client = await findClient(supabase, clientName, platform);
  info(`Matched reporting_clients row ${client.id} (${client.client_name}, ${client.client_type})`);

  // ── Idempotency check ──
  const destFile = join(CUSTOM_DIR, `${slug}.tsx`);
  const alreadyCustom = client.report_mode === 'custom' && client.custom_report_slug === slug;
  const fileExists = branchFileExists(slug);
  const registered = registryHasEntry(slug);

  if (alreadyCustom && fileExists && registered) {
    console.log(`\n[branch-report] Already branched. Edit: src/components/reports/custom/${slug}.tsx\n`);
    process.exit(0);
  }

  // If any partial state exists, bail rather than silently "fixing" — safer.
  if (fileExists || registered || alreadyCustom) {
    die(
      `Partial branch state detected — refusing to proceed to avoid duplicating work.\n` +
      `  file exists:       ${fileExists}\n` +
      `  registry entry:    ${registered}\n` +
      `  DB report_mode:    ${client.report_mode}\n` +
      `  DB custom_slug:    ${client.custom_report_slug}\n` +
      `Resolve manually (remove partial pieces) and re-run.`,
    );
  }

  // ── Template + copy ──
  const template = resolveTemplate(client, platform);
  info(`Template: ${template.filename} → custom/${slug}.tsx (component ${componentName})`);
  const branchFilePath = copyAndRenameTemplate(template, slug, componentName);

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
    try { unlinkSync(branchFilePath); } catch (e) { console.warn('Failed to delete branch file during rollback:', (e as Error).message); }
    restoreRegistry(prevRegistry);
    await revertReportMode(supabase, client.id);
    die('Rolled back. Fix the type errors above and re-run.');
  }
  info('Typecheck clean');

  // ── Commit + push ──
  const { sha, pushed } = commitAndPush(client.client_name, platform, slug, branchFilePath);

  // ── Summary ──
  console.log('\n────────────────────────────────────────');
  console.log(' Branch report created');
  console.log('────────────────────────────────────────');
  console.log(` Client:       ${client.client_name}`);
  console.log(` Platform:     ${platform}`);
  console.log(` Slug:         ${slug}`);
  console.log(` File:         src/components/reports/custom/${slug}.tsx`);
  console.log(` Commit:       ${sha}`);
  console.log(` Push:         ${pushed ? 'ok (origin main)' : 'FAILED — see warning above'}`);
  if (pushed) console.log(` Deploy:       Railway will auto-deploy in ~2 min.`);
  console.log('────────────────────────────────────────\n');
}

main().catch(err => {
  console.error('\n[branch-report] Unhandled error:', err);
  process.exit(1);
});
