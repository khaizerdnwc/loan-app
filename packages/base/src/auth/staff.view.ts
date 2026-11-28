import type { StaffView } from "@loan/core";
import type { StaffEntity } from "./staff.entity";

export function toStaffView(s: StaffEntity): StaffView {
  return {
    id: s.id,
    username: s.username,
    fullName: s.fullName,
    role: s.role,
    title: s.title,
    approvalLimit: s.approvalLevel?.maxAmount.toString() ?? null,
    approvalGrades: s.approvalLevel?.grades ?? null,
    approvalLevel: s.approvalLevel
      ? { code: s.approvalLevel.code, name: s.approvalLevel.name }
      : null,
  };
}
