import { Button, Callout } from "@loan/ui";

/**
 * The loading and error states every fetching screen shows. A module the bank has switched off
 * (`code` FEATURE_DISABLED, PRD PLT-006) is a statement of fact, not a failure: shown neutral,
 * with no "Try again" (trying again cannot help until an administrator switches it on).
 */
export function LoadState({
  loading,
  error,
  code,
  onRetry,
}: {
  loading: boolean;
  error: string | null;
  code?: string | null;
  onRetry: () => void;
}) {
  if (error && code === "FEATURE_DISABLED") {
    return (
      <Callout tone="neutral" lead={error}>
        <p className="mt-1">An administrator can switch it on under Feature flags.</p>
      </Callout>
    );
  }
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
