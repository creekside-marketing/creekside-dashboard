import { NextResponse } from 'next/server';
import { supabase } from '@/lib/supabase';

/**
 * Computes weekly average lead-response time in BUSINESS HOURS
 * (8am-6pm America/Chicago, Mon-Fri) from upwork_conversations.
 *
 * A "response" = the gap between the earliest unanswered lead message
 * and our next reply (senders starting with Samuel / Peterson / Creekside).
 * Time outside business hours does not count toward the gap.
 */

const PAGE_SIZE = 500;
const OUR_SENDER_PREFIXES = ['samuel', 'peterson', 'creekside'];
const OPEN_HOUR = 8;
const CLOSE_HOUR = 18;
// Gaps over this are late follow-ups to stale threads, not responses — excluded
const MAX_GAP_BUSINESS_HOURS = 24;

interface ConvMessage {
  timestamp?: string;
  sender?: string | null;
  message?: string | null;
}

const CHI_FMT = new Intl.DateTimeFormat('en-US', {
  timeZone: 'America/Chicago',
  year: 'numeric', month: '2-digit', day: '2-digit',
  hour: '2-digit', minute: '2-digit', second: '2-digit',
  hourCycle: 'h23',
});

/** Convert a UTC instant to a Date whose UTC fields equal Chicago wall-clock time. */
function toChicagoWall(d: Date): Date {
  const parts: Record<string, string> = {};
  for (const p of CHI_FMT.formatToParts(d)) parts[p.type] = p.value;
  return new Date(Date.UTC(
    +parts.year, +parts.month - 1, +parts.day,
    +parts.hour, +parts.minute, +parts.second,
  ));
}

/** Business hours (8-18, Mon-Fri) elapsed between two Chicago wall-clock dates. */
function businessHoursBetween(a: Date, b: Date): number {
  if (b.getTime() <= a.getTime()) return 0;
  let totalMs = 0;
  let day = new Date(Date.UTC(a.getUTCFullYear(), a.getUTCMonth(), a.getUTCDate()));
  const endDayMs = Date.UTC(b.getUTCFullYear(), b.getUTCMonth(), b.getUTCDate());
  let guard = 0;
  while (day.getTime() <= endDayMs && guard++ < 400) {
    const dow = day.getUTCDay();
    if (dow >= 1 && dow <= 5) {
      const open = day.getTime() + OPEN_HOUR * 3_600_000;
      const close = day.getTime() + CLOSE_HOUR * 3_600_000;
      const s = Math.max(a.getTime(), open);
      const e = Math.min(b.getTime(), close);
      if (e > s) totalMs += e - s;
    }
    day = new Date(day.getTime() + 86_400_000);
  }
  return totalMs / 3_600_000;
}

/** Monday (YYYY-MM-DD) of the week containing the given Chicago wall date. */
function mondayKey(wall: Date): string {
  const day = new Date(Date.UTC(wall.getUTCFullYear(), wall.getUTCMonth(), wall.getUTCDate()));
  const dow = day.getUTCDay();
  const monday = new Date(day.getTime() - ((dow + 6) % 7) * 86_400_000);
  return monday.toISOString().slice(0, 10);
}

function isOurs(sender: string | null | undefined): boolean {
  const s = (sender ?? '').trim().toLowerCase();
  return OUR_SENDER_PREFIXES.some((p) => s.startsWith(p));
}

function parseMessages(raw: unknown): ConvMessage[] {
  let msgs: unknown = raw;
  // messages jsonb is often a double-encoded JSON string
  let guard = 0;
  while (typeof msgs === 'string' && guard++ < 3) {
    try { msgs = JSON.parse(msgs); } catch { return []; }
  }
  return Array.isArray(msgs) ? (msgs as ConvMessage[]) : [];
}

async function fetchAllConversations(): Promise<{ data: any[]; error: any }> {
  const allRows: any[] = [];
  let from = 0;
  while (true) {
    const { data, error } = await supabase()
      .from('upwork_conversations')
      .select('room_id, messages')
      .gte('message_count', 2)
      .order('room_id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) return { data: [], error };
    if (!data || data.length === 0) break;
    allRows.push(...data);
    if (data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return { data: allRows, error: null };
}

export async function GET() {
  try {
    const { data: conversations, error } = await fetchAllConversations();
    if (error) throw error;

    // weekKey -> business-hour gaps for lead messages in that week
    const byWeek = new Map<string, number[]>();

    for (const conv of conversations) {
      const messages = parseMessages(conv.messages)
        .filter((m) => m.timestamp)
        .sort((x, y) => String(x.timestamp).localeCompare(String(y.timestamp)));

      // Earliest unanswered lead message since our last reply
      let pendingLead: Date | null = null;

      for (const msg of messages) {
        const t = new Date(msg.timestamp as string);
        if (Number.isNaN(t.getTime())) continue;

        if (isOurs(msg.sender)) {
          if (pendingLead) {
            const leadWall = toChicagoWall(pendingLead);
            const replyWall = toChicagoWall(t);
            const gap = businessHoursBetween(leadWall, replyWall);
            if (gap <= MAX_GAP_BUSINESS_HOURS) {
              const key = mondayKey(leadWall);
              const arr = byWeek.get(key) ?? [];
              arr.push(gap);
              byWeek.set(key, arr);
            }
            pendingLead = null;
          }
        } else if (!pendingLead) {
          pendingLead = t;
        }
      }
    }

    // Exclude the current incomplete week (Chicago time)
    const currentWeekKey = mondayKey(toChicagoWall(new Date()));

    const weekly = Array.from(byWeek.entries())
      .filter(([weekOf]) => weekOf < currentWeekKey)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([weekOf, gaps]) => {
        const sorted = [...gaps].sort((a, b) => a - b);
        const avg = sorted.reduce((s, v) => s + v, 0) / sorted.length;
        const mid = Math.floor(sorted.length / 2);
        const median = sorted.length % 2 === 0
          ? (sorted[mid - 1] + sorted[mid]) / 2
          : sorted[mid];
        const d = new Date(weekOf + 'T00:00:00Z');
        const weekLabel = `${d.getUTCMonth() + 1}/${d.getUTCDate()}/${String(d.getUTCFullYear()).slice(2)}`;
        return {
          weekOf,
          weekLabel,
          avgHours: +avg.toFixed(2),
          medianHours: +median.toFixed(2),
          responses: sorted.length,
        };
      });

    return NextResponse.json({ weekly, fetchedAt: new Date().toISOString() });
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to compute response times';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
