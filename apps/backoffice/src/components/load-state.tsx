import { Button, Callout } from "@loan/ui";

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
      <Callout tone="bad" alert className="flex flex-wrap items-center justify-between gap-3">
        <span>{error}</span>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          Try again
        </Button>
      </Callout>
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
