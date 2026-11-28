import type { ApprovalException, Grade, Money } from "@loan/core";
import { Column, Entity, PrimaryColumn } from "typeorm";
import { moneyColumn } from "../database/money.transformer";

/**
 * One delegated authority level of the approval matrix (PRD WF-004), as data: what an approver
 * at this level may approve, by product, amount, risk grade and exception type. Approvers hold
 * a level (StaffEntity.approvalLevel); the authority check reads it at decision time.
 */
@Entity({ name: "approval_level" })
export class ApprovalLevelEntity {
  /** e.g. "L1". */
  @PrimaryColumn({ type: "varchar", length: 10 })
  code!: string;

  @Column({ type: "varchar", length: 80 })
  name!: string;

  @Column({ name: "product_code", type: "varchar", length: 10 })
  productCode!: string;

  /** Higher ranks may approve more; the lowest level that covers a case is shown as its route. */
  @Column({ type: "integer" })
  rank!: number;

  /** The largest amount this level approves (required: a missing limit is no authority). */
  @Column(moneyColumn({ name: "max_amount" }))
  maxAmount!: Money;

  @Column({ type: "jsonb" })
  grades!: Grade[];

  /** The exception types this level may approve (an approval without one needs none). */
  @Column({ type: "jsonb" })
  exceptions!: ApprovalException[];
}
