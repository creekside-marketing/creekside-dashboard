/**
 * GET /api/leads/srm-prequalified
 *
 * Reads the SRM "Pricing Qualified Leads (Meta)" Google Sheet and returns rows
 * where fbclid is non-empty, indicating a Meta-attributed prequalified lead.
 *
 * Sheet: 1dbR6cuP6gdnmL_zKVmnhFti_Ma0HqAV2awJjt1nNssE, gid 1938170830
 * Column A = event_time (Unix timestamp in seconds, stored as text)
 * Column J = fbclid
 *
 * Returns: { leads: { event_time: string (ISO 8601), fbclid: string }[] }
 *
 * Requires: GOOGLE_OAUTH_CLIENT_ID, GOOGLE_OAUTH_CLIENT_SECRET, GOOGLE_OAUTH_REFRESH_TOKEN
 */

import { NextResponse } from 'next/server';

const SPREADSHEET_ID = '1dbR6cuP6gdnmL_zKVmnhFti_Ma0HqAV2awJjt1nNssE';
const GID = 1938170830;

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

async function resolveSheetName(
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  sheets: any,
  spreadsheetId: string,
  gid: number,
): Promise<string | null> {
  const meta = await sheets.spreadsheets.get({ spreadsheetId });
  const rawSheets = meta.data.sheets ?? [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const match = rawSheets.find((s: any) => s.properties.sheetId === gid);
  return match?.properties?.title ?? null;
}

function parseUnixTimestamp(raw: string | null | undefined): string | null {
  if (!raw || typeof raw !== 'string') return null;
  const cleaned = raw.replace(/^'/, '').trim();
  const ts = Number(cleaned);
  if (isNaN(ts) || ts < 1_000_000_000 || ts > 2_000_000_000) return null;
  return new Date(ts * 1000).toISOString();
}

export async function GET() {
  try {
    const sheets = await getSheetsClient();
    if (!sheets) {
      return NextResponse.json(
        { error: 'Google Sheets API not configured.' },
        { status: 503 },
      );
    }

    const sheetName = await resolveSheetName(sheets, SPREADSHEET_ID, GID);
    if (!sheetName) {
      return NextResponse.json(
        { error: `Sheet with gid ${GID} not found.` },
        { status: 404 },
      );
    }

    // Read columns A (event_time) and J (fbclid), skip header
    const res = await sheets.spreadsheets.values.get({
      spreadsheetId: SPREADSHEET_ID,
      range: `'${sheetName}'!A:J`,
    });

    const rows: string[][] = res.data.values ?? [];
    if (rows.length < 2) {
      return NextResponse.json({ leads: [] });
    }

    // Row 0 = headers, rows 1+ = data
    // Column A (index 0) = event_time, Column J (index 9) = fbclid
    const leads: { event_time: string; fbclid: string }[] = [];

    for (let i = 1; i < rows.length; i++) {
      const fbclid = (rows[i][9] ?? '').trim();
      if (!fbclid) continue;

      const eventTime = parseUnixTimestamp(rows[i][0]);
      if (!eventTime) continue;

      leads.push({ event_time: eventTime, fbclid });
    }

    return NextResponse.json(
      { leads },
      { headers: { 'Cache-Control': 'no-store' } },
    );
  } catch (err) {
    console.error('[srm-prequalified] Error:', err instanceof Error ? err.message : err);
    return NextResponse.json(
      { error: 'Failed to read lead sheet.' },
      { status: 500 },
    );
  }
}
