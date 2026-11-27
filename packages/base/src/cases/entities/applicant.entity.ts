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

  @Column(moneyColumn({ name: "monthly_income" }))
  monthlyIncome!: Money;

  @Column(moneyColumn({ name: "monthly_obligations" }))
  monthlyObligations!: Money;

  /** The (simulated) WhiteBank deposit account a loan is disbursed to. */
  @Column({ name: "deposit_account", type: "varchar", length: 40 })
  depositAccount!: string;
}
