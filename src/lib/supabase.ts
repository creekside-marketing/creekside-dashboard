import { createClient } from '@supabase/supabase-js';

// Lazy-initialized clients — env vars are read at call time, not import time,
// so Next.js can import this module during build without crashing.

const PLACEHOLDER = 'https://placeholder.supabase.co';

let _anonClient: ReturnType<typeof createClient> | null = null;

export function supabase() {
  if (!_anonClient) {
    _anonClient = createClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL || PLACEHOLDER,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY || 'placeholder',
    );
  }
  return _anonClient;
}

// Server-side client with service role key for write operations
export function createServiceClient() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL || PLACEHOLDER,
    process.env.SUPABASE_SERVICE_ROLE_KEY || 'placeholder',
  );
}
