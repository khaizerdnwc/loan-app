import type { Money } from "@loan/core";
import { Column, Entity, PrimaryColumn } from "typeorm";
import { moneyColumn } from "../../database/money.transformer";

/**
 * A seeded, synthetic applicant (docs/ASSUMPTIONS.md). Bureau and screening data are not
 * here: they live with the simulated providers, as they would at a real bureau.
 */
@Entity({ name: "applicant" })
export class ApplicantEntity {
  @PrimaryColumn({ type: "varchar", length: 40 })
  id!: string;

  @Column({ name: "full_name", type: "varchar", length: 120 })
  fullName!: string;

  @Column({ name: "birth_date", type: "date" })
  birthDate!: string;

  @Column({ name: "government_id_last4", type: "varchar", length: 4 })
  governmentIdLast4!: string;

  @Column({ type: "varchar", length: 160 })
  employer!: string;

  @Column({ name: "employment_months", type: "integer" })
  employmentMonths!: number;

  /** Months as a WhiteBank customer; 0 for new to bank. */
  @Column({ name: "relationship_months", type: "integer" })
  relationshipMonths!: number;

  /** Verified monthly income when available, else the declared one: what DTI uses. */
  @Column(moneyColumn({ name: "monthly_income" }))
  monthlyIncome!: Money;

  /**
   * The monthly income the applicant declared, when it was recorded apart from the verified
   * figure above (PRD F3); null when there is no separate declaration.
   */
  @Column(moneyColumn({ name: "declared_monthly_income", nullable: true }))
  declaredMonthlyIncome!: Money | null;

  /** A WhiteBank insider or a relative of one: every application is reviewed (CMP-006). */
  @Column({ name: "related_party", type: "boolean", default: false })
  relatedParty!: boolean;

  @Column(moneyColumn({ name: "monthly_obligations" }))
  monthlyObligations!: Money;

  /** The (simulated) WhiteBank deposit account a loan is disbursed to. */
  @Column({ name: "deposit_account", type: "varchar", length: 40 })
  depositAccount!: string;
}
