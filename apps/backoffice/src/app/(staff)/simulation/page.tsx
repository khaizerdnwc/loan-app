"use client";

import type { CoreBankingSimulationMode, SimulationServiceView } from "@loan/core";
import {
  Card,
  ConfirmDialog,
  Field,
  formatDateTime,
  Pill,
  Select,
  SimulatedLabel,
  useToast,
} from "@loan/ui";
import { useState } from "react";
import { PageHeader, useShellRefresh } from "@/components/app-shell";
import { LoadState } from "@/components/load-state";
import { api, errorMessage } from "@/lib/api";
import { useSession } from "@/lib/session";
import { MODE_EFFECT, MODE_LABEL } from "@/lib/simulation";
import { useApi } from "@/lib/use-api";

/**
 * Every external service is a simulation (Engineering Standard 9). An administrator can make
 * one fail to show how the system degrades; a failure mode switches itself back after a while
 * so the shared demo is never left broken. Other roles see the current modes.
 */
export default function SimulationPage() {
  const me = useSession();
  const toast = useToast();
  const refreshShell = useShellRefresh();
  const services = useApi<SimulationServiceView[]>("/simulation/services");
  const [change, setChange] = useState<{
    service: SimulationServiceView;
    mode: CoreBankingSimulationMode;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const isAdmin = me.role === "ADMIN";

  async function confirm() {
    if (!change) return;
    setBusy(true);
    setError(null);
    try {
      await api(`/simulation/services/${change.service.service}`, {
        method: "PUT",
        body: { mode: change.mode },
      });
      toast(
        `${change.service.label}: ${MODE_LABEL[change.mode].toLowerCase()}`,
        change.mode === "OK" ? "ok" : "warn",
      );
      setChange(null);
      refreshShell();
      await services.reload();
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <PageHeader
        title="Simulated services"
        description="WhiteBank's external services are simulated in this release: no real bureau, screening, core banking, payments or e-signature provider is called."
      />
      <LoadState
        loading={services.loading && !services.data}
        error={services.error}
        onRetry={services.reload}
      />
      {services.data && (
        <div className="grid gap-4 min-[1100px]:grid-cols-2">
          {services.data.map((s) => (
            <Card key={s.service} title={s.label} aside={<SimulatedLabel />}>
              <div className="flex flex-wrap items-center gap-3 text-sm">
                <Pill tone={s.mode === "OK" ? "ok" : "bad"}>{MODE_LABEL[s.mode]}</Pill>
                {s.resetsAt && (
                  <span className="text-xs text-mist-500">
                    Returns to normal {formatDateTime(s.resetsAt)}
                  </span>
                )}
                {s.setBy && <span className="text-xs text-mist-500">Set by {s.setBy}</span>}
              </div>
              {isAdmin ? (
                <div className="mt-4">
                  <Field label="Failure mode">
                    <Select
                      value={s.mode}
                      onChange={(e) =>
                        setChange({ service: s, mode: e.target.value as CoreBankingSimulationMode })
                      }
                    >
                      {s.supportedModes.map((m) => (
                        <option key={m} value={m}>
                          {MODE_LABEL[m]}
                        </option>
                      ))}
                    </Select>
                  </Field>
                </div>
              ) : (
                <p className="mt-4 text-xs text-mist-500">
                  Only an administrator can change failure modes.
                </p>
              )}
            </Card>
          ))}
        </div>
      )}
      <ConfirmDialog
        open={change !== null}
        title={change ? `Set ${change.service.label} to “${MODE_LABEL[change.mode]}”?` : ""}
        description={
          change && (
            <>
              {MODE_EFFECT[change.mode]}
              {change.mode !== "OK" &&
                " Every staff member is affected until it is set back, or until the reset time shown on the card."}
            </>
          )
        }
        confirmLabel="Change mode"
        variant={change?.mode === "OK" ? "primary" : "danger"}
        busy={busy}
        error={error}
        onConfirm={confirm}
        onCancel={() => {
          setChange(null);
          setError(null);
        }}
      />
    </>
  );
}
