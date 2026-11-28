const MIN = 450;
const MAX = 820;

export interface ScoreBandProps {
  score: number;
  /** Decline below this score. */
  declineBelow: number;
  /** Approve from this score. */
  approveFrom: number;
}

const pct = (value: number) => `${(((value - MIN) / (MAX - MIN)) * 100).toFixed(2)}%`;

/** The 450–820 scale with the decline, refer and approve zones and a marker at the score. */
export function ScoreBand({ score, declineBelow, approveFrom }: ScoreBandProps) {
  const clamped = Math.min(MAX, Math.max(MIN, score));
  return (
    <figure className="w-full">
      <div
        role="img"
        aria-label={`Score ${score} on a scale of ${MIN} to ${MAX}: decline below ${declineBelow}, refer ${declineBelow} to ${approveFrom - 1}, approve from ${approveFrom}`}
        className="relative h-2.5 w-full overflow-hidden rounded-full"
      >
        <div
          className="absolute inset-y-0 left-0 bg-bad-100"
          style={{ width: pct(declineBelow) }}
        />
        <div
          className="absolute inset-y-0 bg-gold-100"
          style={{
            left: pct(declineBelow),
            width: `calc(${pct(approveFrom)} - ${pct(declineBelow)})`,
          }}
        />
        <div className="absolute inset-y-0 right-0 bg-ok-100" style={{ left: pct(approveFrom) }} />
      </div>
      <div className="relative h-4">
        <span
          aria-hidden="true"
          className="absolute -top-3.5 h-5 w-1 -translate-x-1/2 rounded-full bg-ink-800"
          style={{ left: pct(clamped) }}
        />
      </div>
      <figcaption className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-2xs text-mist-500">
        <span>{MIN}</span>
        <span className="order-last basis-full text-center sm:order-none sm:basis-auto">
          decline &lt; {declineBelow} · refer {declineBelow}–{approveFrom - 1} · approve{" "}
          {approveFrom}+
        </span>
        <span>{MAX}</span>
      </figcaption>
    </figure>
  );
}
