import { GoogleAdsApi } from 'google-ads-api';

let client: GoogleAdsApi | null = null;

export function getGoogleAdsClient() {
  if (!client) {
    client = new GoogleAdsApi({
      client_id: process.env.GOOGLE_ADS_CLIENT_ID!,
      client_secret: process.env.GOOGLE_ADS_CLIENT_SECRET!,
      developer_token: process.env.GOOGLE_ADS_DEVELOPER_TOKEN!,
    });
  }
  return client;
}

// Transient network failures (seen on Railway when Google closes the
// connection mid-response during the OAuth token refresh). These are safe to
// retry; real errors (invalid_grant, GAQL errors, permission issues) are not.
const TRANSIENT_ERROR = /premature close|invalid response body|econnreset|econnrefused|etimedout|socket hang up|network socket disconnected|eai_again|getaddrinfo/i;

async function withTransientRetry<T>(fn: () => Promise<T>, attempts = 3): Promise<T> {
  let lastError: unknown;
  for (let i = 0; i < attempts; i++) {
    try {
      return await fn();
    } catch (error) {
      lastError = error;
      const message = error instanceof Error ? error.message : String(error);
      if (i === attempts - 1 || !TRANSIENT_ERROR.test(message)) throw error;
      await new Promise((resolve) => setTimeout(resolve, 500 * 2 ** i));
    }
  }
  throw lastError;
}

export function getCustomer(customerId: string) {
  const client = getGoogleAdsClient();
  const customer = client.Customer({
    customer_id: customerId,
    login_customer_id: process.env.GOOGLE_ADS_MCC_ID!,
    refresh_token: process.env.GOOGLE_ADS_REFRESH_TOKEN!,
  });
  // Wrap query so every caller gets automatic retry on transient failures.
  const originalQuery = customer.query.bind(customer);
  customer.query = ((...args: Parameters<typeof originalQuery>) =>
    withTransientRetry(() => originalQuery(...args))) as typeof customer.query;
  return customer;
}
