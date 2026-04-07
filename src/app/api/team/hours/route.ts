/**
 * GET /api/team/hours
 *
 * Reads contractor pre-work Google Sheets and calculates estimated monthly hours.
 *
 * Query params:
 *   ?member_id=<uuid>  — fetch for a single contractor (optional; omit for all)
 *
 * Requires:
 *   - npm install googleapis
 *   - GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN env vars
 *     (reuses the same OAuth credentials as the GDrive pipeline)
 *   - team_members rows with prework_spreadsheet_id set to the Google Sheet ID
 *
 * Sheet structure:
 *   Each spreadsheet has one tab per week (named like "04-04-26", "03-28-26").
 *   Column A ("Estimated Time Spent This Week") contains values like "3 hrs", "2 hr".
 *   Values only appear on the first row of each client group (merged-cell pattern).
 *
 * CANNOT do: write to sheets, modify spreadsheet structure, access sheets not
 * shared with the service account.
 */

import { NextRequest, NextResponse } from 'next/server';
import { createServiceClient } from '@/lib/supabase';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface MemberHours {
  id: string;
  name: string;
  weekly_hours: number[];
  avg_weekly: number;
  monthly_estimate: number;
}

interface SheetTab {
  title: string;
  sheetId: number;
  date: Date | null;
}

// ---------------------------------------------------------------------------
// Google Sheets helpers
// ---------------------------------------------------------------------------

/**
 * Build an authenticated Google Sheets client using OAuth2 credentials.
 * Reuses the same OAuth credentials + refresh token as the GDrive pipeline.
 * Returns null if credentials are missing or googleapis is not installed.
 */
async function getSheetsClient() {
  const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID;
  const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET;
  const refreshToken = process.env.GOOGLE_OAUTH_REFRESH_TOKEN;

  if (!clientId || !clientSecret || !refreshToken) return null;

  try {
    const { google } = await import('googleapis');

    const oauth2 = new google.auth.OAuth2(clientId, clientSecret);
    oauth2.setCredentials({ refresh_token: refreshToken });

    return google.sheets({ version: 'v4', auth: oauth2 });
  } catch {
    return null;
  }
}

/**
 * Parse hours from strings like "3 hrs", "2 hr", "1.5 hours", "45 min".
 * Returns 0 for unparseable values.
 */
function parseHours(raw: string | null | undefined): number {
  if (!raw || typeof raw !== 'string') return 0;

  const trimmed = raw.trim().toLowerCase();
  if (!trimmed) return 0;

  // Match a number (int or decimal) followed by an optional unit
  const match = trimmed.match(/^([\d.]+)\s*(hr|hrs|hour|hours|h|min|mins|minutes|m)?/);
  if (!match) return 0;

  const value = parseFloat(match[1]);
  if (isNaN(value)) return 0;

  const unit = match[2] ?? 'hr';
  if (unit.startsWith('min') || unit === 'm') {
    return value / 60;
  }

  return value;
}

/**
 * Parse a date from a tab name like "04-04-26" (MM-DD-YY).
 * Returns null if unparseable.
 */
function parseDateFromTabName(name: string): Date | null {
  // Match MM-DD-YY or MM/DD/YY
  const match = name.trim().match(/^(\d{1,2})[-/](\d{1,2})[-/](\d{2,4})$/);
  if (!match) return null;

  const month = parseInt(match[1], 10);
  const day = parseInt(match[2], 10);
  let year = parseInt(match[3], 10);

  // Two-digit year: assume 2000s
  if (year < 100) year += 2000;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  return new Date(year, month - 1, day);
}

/**
 * List all tabs in a spreadsheet, sorted by date (most recent first).
 */
async function listTabs(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheets: any,
  spreadsheetId: string,
): Promise<SheetTab[]> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const rawSheets = meta.data.sheets ?? [];

  const tabs: SheetTab[] = rawSheets.map(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (s: any) => ({
      title: s.properties.title,
      sheetId: s.properties.sheetId,
      date: parseDateFromTabName(s.properties.title),
    }),
  );

  // Sort by date descending — tabs without parseable dates go last
  tabs.sort((a, b) => {
    if (a.date && b.date) return b.date.getTime() - a.date.getTime();
    if (a.date) return -1;
    if (b.date) return 1;
    return 0;
  });

  return tabs;
}

/**
 * Read column A from a specific tab and sum all hours.
 */
async function sumHoursFromTab(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheets: any,
  spreadsheetId: string,
  tabTitle: string,
): Promise<number> {
  const range = `'${tabTitle}'!A:A`;
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId,
    range,
  });

  const rows: string[][] = res.data.values ?? [];
  let total = 0;

  // Skip header row (row 0)
  for (let i = 1; i < rows.length; i++) {
    const cell = rows[i]?.[0];
    total += parseHours(cell);
  }

  return total;
}

// ---------------------------------------------------------------------------
// Weeks-to-monthly conversion
// ---------------------------------------------------------------------------

const WEEKS_PER_MONTH = 4.33;
const MAX_WEEKS = 4;

// ---------------------------------------------------------------------------
// Route handler
// ---------------------------------------------------------------------------

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const memberId = searchParams.get('member_id');

    // -----------------------------------------------------------------------
    // 1. Fetch contractors with prework spreadsheet IDs
    // -----------------------------------------------------------------------
    const supabase = createServiceClient();

    let query = supabase
      .from('team_members')
      .select('id, name, prework_spreadsheet_id')
      .not('prework_spreadsheet_id', 'is', null)
      .eq('status', 'active');

    if (memberId) {
      query = query.eq('id', memberId);
    }

    const { data: members, error: dbError } = await query;

    if (dbError) {
      return NextResponse.json({ error: dbError.message }, { status: 500 });
    }

    if (!members || members.length === 0) {
      return NextResponse.json({
        members: [],
        message: 'No contractors with prework_spreadsheet_id found.',
      });
    }

    // -----------------------------------------------------------------------
    // 2. Build Google Sheets client
    // -----------------------------------------------------------------------
    const sheets = await getSheetsClient();

    if (!sheets) {
      return NextResponse.json(
        {
          error:
            'Google Sheets API not configured. ' +
            'Set GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, and ' +
            'GOOGLE_OAUTH_REFRESH_TOKEN env vars, and install googleapis.',
        },
        { status: 503 },
      );
    }

    // -----------------------------------------------------------------------
    // 3. Read hours from each contractor's spreadsheet
    // -----------------------------------------------------------------------
    const results: MemberHours[] = [];

    for (const member of members) {
      try {
        const spreadsheetId = member.prework_spreadsheet_id as string;
        const tabs = await listTabs(sheets, spreadsheetId);

        // Pick the most recent tabs with parseable dates, up to MAX_WEEKS
        const datedTabs = tabs.filter((t) => t.date !== null).slice(0, MAX_WEEKS);

        // Fallback: if no dated tabs, try the first tab (single-sheet pattern)
        const tabsToRead =
          datedTabs.length > 0 ? datedTabs : tabs.slice(0, 1);

        const weeklyHours: number[] = [];

        for (const tab of tabsToRead) {
          const hours = await sumHoursFromTab(sheets, spreadsheetId, tab.title);
          weeklyHours.push(Math.round(hours * 100) / 100);
        }

        const avgWeekly =
          weeklyHours.length > 0
            ? weeklyHours.reduce((sum, h) => sum + h, 0) / weeklyHours.length
            : 0;

        const monthlyEstimate = Math.round(avgWeekly * WEEKS_PER_MONTH * 100) / 100;

        results.push({
          id: member.id,
          name: member.name,
          weekly_hours: weeklyHours,
          avg_weekly: Math.round(avgWeekly * 100) / 100,
          monthly_estimate: monthlyEstimate,
        });

        // -------------------------------------------------------------------
        // 4. Optionally persist calculated estimate to team_members
        //    Use ?persist=true query param to write; otherwise this is read-only.
        // -------------------------------------------------------------------
        if (searchParams.get('persist') === 'true') {
          await supabase
            .from('team_members')
            .update({ estimated_hours_per_month: monthlyEstimate })
            .eq('id', member.id);
        }
      } catch (sheetErr) {
        // Don't let one bad spreadsheet block the rest
        results.push({
          id: member.id,
          name: member.name,
          weekly_hours: [],
          avg_weekly: 0,
          monthly_estimate: 0,
        });
        console.error(
          `[team/hours] Failed to read sheet for ${member.name}:`,
          sheetErr instanceof Error ? sheetErr.message : sheetErr,
        );
      }
    }

    return NextResponse.json({ members: results });
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : 'Unknown error' },
      { status: 500 },
    );
  }
}
