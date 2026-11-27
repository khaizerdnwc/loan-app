import { Button } from "@loan/ui";

/** The loading and error states every fetching screen shows. */
export function LoadState({
  loading,
  error,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}) {
  if (error) {
    return (
      <div
        role="alert"
        className="flex items-center justify-between gap-3 rounded-card border border-bad-100 bg-bad-050 px-5 py-4 text-sm text-bad-700"
      >
        <span>{error}</span>
        <Button variant="secondary" onClick={onRetry}>
          Try again
        </Button>
      </div>
    );
  }
  if (loading) {
    return (
      <p
        aria-live="polite"
        className="rounded-card border border-line bg-white px-5 py-8 text-center text-sm text-mist-500"
      >
        Loading…
      </p>
    );
  }
  return null;
}
