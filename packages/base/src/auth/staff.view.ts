import type { StaffView } from "@loan/core";
import type { StaffEntity } from "./staff.entity";

export function toStaffView(s: StaffEntity): StaffView {
  return {
    id: s.id,
    fullName: s.fullName,
    role: s.role,
    title: s.title,
    approvalLimit: s.approvalLimit ? s.approvalLimit.toString() : null,
    approvalGrades: s.approvalGrades,
  };
}
