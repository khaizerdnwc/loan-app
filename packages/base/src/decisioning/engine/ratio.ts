/**
 * Display of non-negative decimal ratios such as a debt-to-income of "0.4300". A ratio is
 * not money (it has four or more decimals), so it does not go through Money; it is scaled
 * to an integer, never handled as a float. Policy never compares these strings: the engine
 * compares exact amounts (obligations > income × cap).
 */
const SCALE = 8;

function scaled(ratio: string): bigint {
  const [whole = "0", fraction = ""] = ratio.split(".");
  if (!/^\d+$/.test(whole) || (fraction !== "" && !/^\d+$/.test(fraction))) {
    throw new Error(`"${ratio}" is not a non-negative decimal ratio`);
  }
  return BigInt(whole + fraction.padEnd(SCALE, "0").slice(0, SCALE));
}

/** "0.4300" → "43.0%" for rule results shown to staff (display only). */
export function ratioAsPercent(ratio: string): string {
  const tenthsOfPercent = (scaled(ratio) + 50_000n) / 100_000n;
  return `${tenthsOfPercent / 10n}.${tenthsOfPercent % 10n}%`;
}
