"use client";
import { type ChecklistItem } from "@/lib/trip-record";

type Props = {
  ready: boolean;
  checklist: ChecklistItem[];
};

export default function TripChecklist({
  ready,
  checklist,
}: Props) {
  return (
    <div className={"planner-checklist" + (ready ? " ready" : "")}>
      <b>{ready ? "Ready to submit" : "Before you submit"}</b>
      {!ready && <p>You can save a draft once the first four are done. Submitting needs all five.</p>}
      <ul>
        {checklist.map((item) => (
          <li key={item.label} className={item.done ? "done" : ""}>
            <span aria-hidden="true">{item.done ? "✓" : "○"}</span>
            <span>
              <span className="sr-only">{item.done ? "Done: " : "To do: "}</span>
              {item.label}
              {!item.done && item.detail && <small>{item.detail}</small>}
            </span>
          </li>
        ))}
      </ul>
    </div>
  );
}
