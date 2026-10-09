"use client";
import { type ChecklistItem } from "@/lib/trip-record";

type Props = {
  ready: boolean;
  checklist: ChecklistItem[];
};

/** What's still to do before Submit; done items drop off, so it shrinks as the trip comes together. */
export default function TripChecklist({
  ready,
  checklist,
}: Props) {
  const left = checklist.filter((item) => !item.done);
  return (
    <div className={"planner-checklist" + (ready ? " ready" : "")}>
      <b>{ready ? "✓ Ready to submit" : "Still to do"}</b>
      {!ready && (
        <ul>
          {left.map((item) => (
            <li key={item.label}>
              <span aria-hidden="true">○</span>
              <span>
                {item.label}
                {item.detail && <small>{item.detail}</small>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
