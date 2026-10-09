"use client";
import { scheduleStateLabel, scheduleStatePill, type Commitment } from "@/lib/trip-record";

type Props = {
  commitments: Commitment[];
  clashes: Commitment[];
};

/**
 * Time already held on the day by other schedules, including drafts. Folded
 * by default to keep the Planner short; it opens by itself on a clash, so
 * the Scheduler sees what they're clashing with.
 */
export default function CommitmentsPanel({
  commitments,
  clashes,
}: Props) {
  // Nothing held: one line under the pool rather than an empty half-row panel.
  if (!commitments.length) return <p className="helper planner-no-commitments">Nothing else is scheduled on this day yet.</p>;
  return (
    <details className="editor-panel planner-fold" open={clashes.length > 0 || undefined}>
      <summary>
        <h2>Other trips this day ({commitments.length})</h2>
      </summary>
      <ul className="planner-commitments">
        {commitments.map((item, index) => (
          <li key={`${item.scheduleId}-${index}`} className={clashes.includes(item) ? "clash" : ""}>
            <b>
              {item.start}–{item.end}
            </b>
            <span>
              {item.plate} · {item.driverName}
            </span>
            <span className={"status-pill " + scheduleStatePill[item.state]}>{scheduleStateLabel[item.state]}</span>
          </li>
        ))}
      </ul>
    </details>
  );
}
