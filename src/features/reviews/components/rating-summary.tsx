import { averageRating, ratingLabel } from "@/lib/validation";
import type { ReviewStats } from "../queries";
import { StarRating } from "./star-rating";

/** Average, count and star breakdown of a product's published reviews. */
export function RatingSummary({ stats }: { stats: ReviewStats }) {
  const average = averageRating(stats.rating_sum, stats.review_count);
  if (average === null) {
    return <p className="text-sm text-ink-soft">No reviews yet.</p>;
  }
  const rows = [
    [5, stats.rating_5],
    [4, stats.rating_4],
    [3, stats.rating_3],
    [2, stats.rating_2],
    [1, stats.rating_1],
  ] as const;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-end gap-3">
        <p className="display-2 leading-none tabular-nums">{average.toFixed(1)}</p>
        <div className="flex flex-col gap-1 pb-1">
          <StarRating value={average} size="md" label={ratingLabel(average, stats.review_count)} />
          <p className="text-xs text-ink-soft">
            {stats.review_count} {stats.review_count === 1 ? "review" : "reviews"} from verified buyers
          </p>
        </div>
      </div>
      <dl className="grid gap-1.5">
        {rows.map(([stars, count]) => (
          <div key={stars} className="grid grid-cols-[3.5rem_1fr_2rem] items-center gap-3 text-xs">
            <dt className="text-ink-soft">
              {stars} {stars === 1 ? "star" : "stars"}
            </dt>
            <dd className="h-1.5 overflow-hidden rounded-full bg-surface-muted">
              <span
                className="block h-full rounded-full bg-ink"
                style={{ width: `${stats.review_count ? Math.round((count / stats.review_count) * 100) : 0}%` }}
              />
            </dd>
            <dd className="text-right text-ink-soft tabular-nums">{count}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}
