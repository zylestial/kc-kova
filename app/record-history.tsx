import type { HistoryEntry } from "@/lib/kova-api";

export default function RecordHistory({
  entries,
}: {
  entries: HistoryEntry[];
}) {
  return (
    <section className="editor-panel record-history">
      <h2>Record History</h2>
      {entries.length ? (
        entries
          .slice()
          .reverse()
          .map((entry, i) => (
            <div className="history-entry" key={`${entry.timestamp}-${i}`}>
              <strong>
                {entry.action === "MARK AS DONE" ? "Marked as Done" : "Edited"}{" "}
                by {entry.adminName}
              </strong>
              <span>
                {new Date(entry.timestamp).toLocaleString()} · Record{" "}
                {entry.recordId}
              </span>
              {entry.changes.length > 0 && (
                <ul>
                  {entry.changes.map((c) => (
                    <li key={c.field}>
                      {c.field.replace(/([A-Z])/g, " $1")}:{" "}
                      {typeof c.before === "object"
                        ? "Updated"
                        : `${String(c.before ?? "—")} → ${String(c.after ?? "—")}`}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          ))
      ) : (
        <p>No Admin changes yet.</p>
      )}
    </section>
  );
}
