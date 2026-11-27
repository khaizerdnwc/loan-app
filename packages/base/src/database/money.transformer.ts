import { MONEY_PRECISION, MONEY_SCALE, Money } from "@loan/core";
import type { ColumnOptions, ValueTransformer } from "typeorm";

/**
 * numeric(14,2) ⇄ Money (ADR 0019 R2). The pg driver returns NUMERIC as a string, so the
 * value never passes through a JavaScript number on the way in or out.
 */
export const moneyTransformer: ValueTransformer = {
  to: (value: Money | null | undefined) => (value == null ? value : value.toString()),
  from: (value: string | null) => (value == null ? value : Money.of(value)),
};

/** Column options for a money amount. Use with `@Column(moneyColumn())`. */
export function moneyColumn(options: Partial<ColumnOptions> = {}): ColumnOptions {
  return {
    type: "numeric",
    precision: MONEY_PRECISION,
    scale: MONEY_SCALE,
    transformer: moneyTransformer,
    ...options,
  };
}
