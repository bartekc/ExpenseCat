import { pieSlices } from "@/lib/expenses/chart";
import { formatPlnCents, percentageShare, type MonthlySummary } from "@/lib/expenses/monthly";

interface Props {
  summary: MonthlySummary | null;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

export default function MonthlyCategoryBreakdown({ summary, loading, error, onRetry }: Props) {
  const slices = summary ? pieSlices(summary.categories.map((category) => category.totalCents)) : [];
  const month = summary
    ? new Intl.DateTimeFormat("en-GB", { month: "long", year: "numeric", timeZone: "Europe/Warsaw" }).format(
        new Date(`${summary.period.month}-15T12:00:00Z`),
      )
    : null;

  return (
    <section
      aria-labelledby="monthly-summary-heading"
      aria-busy={loading}
      className="rounded-2xl border border-white/10 bg-white/10 p-5 backdrop-blur-xl sm:p-6"
    >
      <h2 id="monthly-summary-heading" className="text-xl font-semibold">
        Current-month spending
      </h2>
      <p className="mt-2 text-sm text-blue-100/70">Calendar month in Europe/Warsaw, by operation date.</p>
      {loading && (
        <p role="status" className="mt-5 text-sm text-blue-100/80">
          Loading monthly summary…
        </p>
      )}
      {!loading && error && (
        <div className="mt-5">
          <p role="alert" className="rounded-lg border border-red-300/40 bg-red-950/40 p-3 text-sm text-red-100">
            {error}
          </p>
          <button type="button" onClick={onRetry} className="expense-secondary-button mt-3">
            Retry monthly summary
          </button>
        </div>
      )}
      {!loading && !error && summary && (
        <figure className="mt-5" aria-labelledby="monthly-chart-caption">
          <figcaption id="monthly-chart-caption">
            <h3 className="font-semibold">{month} · Europe/Warsaw</h3>
            <p className="mt-1 text-sm text-blue-100/80">Total positive spending</p>
            <p className="mt-1 text-2xl font-semibold tabular-nums">{formatPlnCents(summary.totalCents)}</p>
            <p className="mt-2 text-sm text-blue-100/70">
              {summary.expenseCount} expenses · {summary.needsReviewCount} need review. Shares may round to a total
              other than 100%.
            </p>
          </figcaption>
          <div className="mt-5 grid items-center gap-6 md:grid-cols-[minmax(0,1fr)_minmax(0,2fr)]">
            {summary.totalCents === "0" ? (
              <p className="rounded-xl border border-white/10 p-5 text-sm text-blue-100/80">
                No spending in this Warsaw month. All category totals are zero.
              </p>
            ) : (
              <svg
                viewBox="-1.05 -1.05 2.1 2.1"
                role="img"
                aria-labelledby="monthly-pie-title monthly-pie-description"
                className="mx-auto aspect-square w-full max-w-64"
              >
                <title id="monthly-pie-title">Spending by category for {month}</title>
                <desc id="monthly-pie-description">
                  Category shares of {formatPlnCents(summary.totalCents)}. Exact amounts and percentages for all ten
                  categories are in the adjacent legend.
                </desc>
                {slices.map((slice) =>
                  slice.kind === "circle" ? (
                    <circle key={slice.index} cx="0" cy="0" r="1" fill={`var(--expense-chart-${slice.index + 1})`} />
                  ) : (
                    <path key={slice.index} d={slice.path} fill={`var(--expense-chart-${slice.index + 1})`} />
                  ),
                )}
              </svg>
            )}
            <dl aria-label="Category spending legend" className="min-w-0 space-y-2">
              {summary.categories.map((category, index) => (
                <div
                  key={category.code}
                  className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1 text-sm"
                >
                  <dt className="flex min-w-0 items-center gap-2 text-blue-100">
                    <span
                      aria-hidden="true"
                      className="h-3 w-3 shrink-0 rounded-sm"
                      style={{ backgroundColor: `var(--expense-chart-${index + 1})` }}
                    />
                    {category.label}
                  </dt>
                  <dd className="text-right text-white tabular-nums">
                    {formatPlnCents(category.totalCents)} · {percentageShare(category.totalCents, summary.totalCents)}%
                  </dd>
                </div>
              ))}
            </dl>
          </div>
        </figure>
      )}
    </section>
  );
}
