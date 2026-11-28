"use client";

import type { DriftView, ModelRegistryView, OverrideMonitorView } from "@loan/core";
import { PageHeader } from "@/components/app-shell";
import { LoadState } from "@/components/load-state";
import { DriftMonitor, ModelRegistry, OverrideMonitor } from "@/components/models/model-governance";
import { useApi } from "@/lib/use-api";

/**
 * Model governance (PRD AIS-008, AIS-009, AIS-011, AIS-012; prototype: Configuration › AI
 * models). Administrators and compliance read the registry, overrides and drift.
 */
export default function ModelsPage() {
  const registry = useApi<ModelRegistryView>("/models");
  const overrides = useApi<OverrideMonitorView>("/models/overrides");
  const drift = useApi<DriftView>("/models/drift");
  return (
    <>
      <PageHeader
        title="Model governance"
        description="The scorecards and rule sets decisions ran on, the prohibited-features check, how often people override the engine, and whether scores are drifting. A demonstration scorecard over simulated data, not a validated model."
      />
      <div className="flex flex-col gap-4">
        <LoadState
          loading={registry.loading && !registry.data}
          error={registry.error}
          onRetry={registry.reload}
        />
        {registry.data && <ModelRegistry registry={registry.data} />}
        <div className="grid gap-4 min-[1100px]:grid-cols-2">
          <div>
            <LoadState
              loading={overrides.loading && !overrides.data}
              error={overrides.error}
              onRetry={overrides.reload}
            />
            {overrides.data && <OverrideMonitor monitor={overrides.data} />}
          </div>
          <div>
            <LoadState
              loading={drift.loading && !drift.data}
              error={drift.error}
              onRetry={drift.reload}
            />
            {drift.data && <DriftMonitor drift={drift.data} />}
          </div>
        </div>
      </div>
    </>
  );
}
