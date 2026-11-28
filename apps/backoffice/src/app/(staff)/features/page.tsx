"use client";

import type { FeatureFlagView } from "@loan/core";
import { Card, EmptyState } from "@loan/ui";
import { useEffect, useState } from "react";
import { PageHeader } from "@/components/app-shell";
import { FeatureFlagsPanel } from "@/components/features/feature-flags-panel";
import { LoadState } from "@/components/load-state";
import { useApi } from "@/lib/use-api";

/**
 * Feature flags (PRD PLT-006: switch modules on or off for the bank). Administrators draft a
 * change and a second administrator approves it; each step is in the audit log.
 */
export default function FeaturesPage() {
  const flags = useApi<FeatureFlagView[]>("/features/flags");
  const [views, setViews] = useState<FeatureFlagView[] | null>(null);

  useEffect(() => {
    if (flags.data) setViews(flags.data);
  }, [flags.data]);

  return (
    <>
      <PageHeader
        title="Feature flags"
        description="Optional modules the bank can switch on or off. A switched-off module leaves every screen, and the API refuses it. Each change is drafted by one administrator and approved by another."
      />
      <LoadState loading={flags.loading && !views} error={flags.error} onRetry={flags.reload} />
      {views && views.length === 0 && (
        <Card>
          <EmptyState title="No switchable modules" hint="Every module is always on." />
        </Card>
      )}
      {views && views.length > 0 && (
        <div className="max-w-3xl">
          <FeatureFlagsPanel views={views} onChanged={setViews} />
        </div>
      )}
    </>
  );
}
