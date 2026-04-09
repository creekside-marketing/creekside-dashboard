'use client';

export default function ClientDetailError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="p-8">
      <h2 className="text-lg font-semibold text-red-500">Something went wrong</h2>
      <p className="text-sm text-slate-400 mt-2">{error.message}</p>
      {error.digest && <p className="text-xs text-slate-500 mt-1">Digest: {error.digest}</p>}
      <button
        onClick={reset}
        className="mt-4 px-4 py-2 text-sm font-medium text-white bg-[var(--accent)] rounded-lg hover:brightness-110 transition-all"
      >
        Try again
      </button>
    </div>
  );
}
