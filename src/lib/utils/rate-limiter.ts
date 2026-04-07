// In-memory sliding window rate limiter.
// Limitations:
// - Resets on cold starts (serverless scale-to-zero). Acceptable for cost protection, not a hard security boundary.
// - Relies on x-forwarded-for from the hosting platform (Railway/Vercel inject a trusted value).
//   On self-hosted setups without a reverse proxy, this header can be spoofed.
const requests = new Map<string, number[]>();

const WINDOW_MS = 60_000; // 1 minute
const LIMITS: Record<string, number> = {
  insights: 5,  // 5 AI requests per minute per IP
  leads: 10,    // 10 lead submissions per minute per IP
};

export function checkRateLimit(
  ip: string,
  route: string
): { allowed: boolean; remaining: number; retryAfter?: number } {
  const key = `${route}:${ip}`;
  const now = Date.now();
  const limit = LIMITS[route] ?? 10;

  const timestamps = (requests.get(key) ?? []).filter((t) => now - t < WINDOW_MS);

  if (timestamps.length >= limit) {
    const oldest = timestamps[0];
    const retryAfter = Math.ceil((oldest + WINDOW_MS - now) / 1000);
    requests.set(key, timestamps);
    return { allowed: false, remaining: 0, retryAfter };
  }

  timestamps.push(now);
  requests.set(key, timestamps);

  // Cleanup old keys periodically (every 100 requests)
  if (Math.random() < 0.01) {
    for (const [k, v] of requests.entries()) {
      const active = v.filter((t) => now - t < WINDOW_MS);
      if (active.length === 0) requests.delete(k);
      else requests.set(k, active);
    }
  }

  return { allowed: true, remaining: limit - timestamps.length };
}
