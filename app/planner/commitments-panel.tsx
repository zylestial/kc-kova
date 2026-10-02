"use client";
import { scheduleStateLabel, scheduleStatePill, type Commitment } from "@/lib/trip-record";

type Props = {
  commitments: Commitment[];
  clashes: Commitment[];
};

export default function CommitmentsPanel({
  commitments,
  clashes,
}: Props) {
  return (
    <section className={"editor-panel" + (commitments.length ? "" : " editor-panel-quiet")}>
      {commitments.length ? (
        <>
          <div className="section-heading">
            <div>
              <h2>Existing commitments</h2>
              <p>Time already held on this day by other schedules, including drafts.</p>
            </div>
          </div>
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
        </>
      ) : (
        <p className="helper">Nothing else is scheduled on this day yet.</p>
      )}
    </section>
  );
}
