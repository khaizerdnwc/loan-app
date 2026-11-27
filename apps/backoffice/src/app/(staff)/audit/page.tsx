"use client";

import { PageHeader } from "@/components/app-shell";
import { AuditLog } from "@/components/audit/audit-log";
import { ChainCheck } from "@/components/audit/chain-check";
import { useSession } from "@/lib/session";

/**
 * The audit log (PRD PLT-004, CMP-010) for Compliance and the administrator: sign-ins,
 * simulation mode changes, consent records and every case action, in one hash chain.
 */
export default function AuditPage() {
  const me = useSession();
  return (
    <>
      <PageHeader
        title="Audit log"
        description="Every sign-in, simulation change and case action, newest first. Tamper-evident and searchable; entries cannot be edited or deleted."
      />
      <div className="grid gap-5 min-[1100px]:grid-cols-[3fr_1fr]">
        <AuditLog canOpenCases={me.role === "COMPLIANCE"} />
        <div>
          <ChainCheck />
        </div>
      </div>
    </>
  );
}
