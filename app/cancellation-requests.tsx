"use client";
import { useEffect, useState } from "react";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  confirmCancellation,
  declineCancellation,
  getPendingCancellations,
  getRequests,
  getSchedules,
  hydrateKovaData,
  type CancellationRequest,
} from "@/lib/kova-api";
import { currentRevision } from "@/lib/trip-record";

const dateLabel = (date: string) =>
  new Date(date + "T12:00:00").toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
const askedLabel = (iso: string) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "Asia/Manila", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

const readData = () => ({ pending: getPendingCancellations(), requests: getRequests(), schedules: getSchedules() });

/**
 * Admin: Requesters' asks to cancel a request that is already in a
 * schedule. The schedule stays in force until one is confirmed; declining
 * needs a note so the Requester knows why the request stays.
 */
export default function CancellationRequests() {
  const [data, setData] = useState(readData);
  const [deciding, setDeciding] = useState<{ item: CancellationRequest; action: "confirm" | "decline" } | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    const refresh = () => setData(readData());
    window.addEventListener("kova-data-update", refresh);
    return () => window.removeEventListener("kova-data-update", refresh);
  }, []);

  const { pending, requests, schedules } = data;
  if (!pending.length) return null;

  const scheduleOf = (requestId: string) =>
    schedules.find((schedule) => schedule.status === "ACTIVE" && currentRevision(schedule)?.requestIds.includes(requestId));

  function close() {
    setDeciding(null);
    setNote("");
    setError("");
  }

  async function decide() {
    if (!deciding) return;
    setBusy(true);
    setError("");
    try {
      if (deciding.action === "confirm") await confirmCancellation(deciding.item.id);
      else await declineCancellation(deciding.item.id, note.trim());
      close();
    } catch (caught) {
      setError((caught as Error).message);
      // Pull the current state so a request that changed since shows as it is.
      await hydrateKovaData().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const target = deciding && requests.find((request) => request.id === deciding.item.requestId);

  return (
    <>
      <section className="schedule-panel" aria-label="Cancellation requests">
        <div className="panel-toolbar">
          <div>
            <Ban size={20} />
            <h2>Cancellation requests</h2>
            <span className="count">{pending.length}</span>
          </div>
        </div>
        <div className="schedule-table admin-trip-table">
          <table>
            <thead>
              <tr>
                {["DATE", "REQUESTER", "DESTINATIONS", "REASON", "ASKED", ""].map((title) => (
                  <th key={title}>{title}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {pending.map((item) => {
                const request = requests.find((entry) => entry.id === item.requestId);
                return (
                  <tr key={item.id}>
                    <td>{request && dateLabel(request.date)}</td>
                    <td>{request?.ownerName}</td>
                    <td>
                      {request?.destinations.map((destination) => destination.destinationName).join(" → ")}
                      {!scheduleOf(item.requestId) && <small>Not in a schedule any more</small>}
                    </td>
                    <td>{item.reason || "—"}</td>
                    <td>{askedLabel(item.requestedAt)}</td>
                    <td>
                      <Button variant="outline" onClick={() => setDeciding({ item, action: "decline" })}>
                        Decline
                      </Button>{" "}
                      <Button className="primary" onClick={() => setDeciding({ item, action: "confirm" })}>
                        Confirm
                      </Button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>

      <Dialog open={!!deciding} onOpenChange={(open) => { if (!open && !busy) close(); }}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{deciding?.action === "confirm" ? "Cancel this request?" : "Keep this request?"}</DialogTitle>
            <DialogDescription>
              {target && `${target.ownerName} · ${dateLabel(target.date)}`}
            </DialogDescription>
          </DialogHeader>
          {deciding?.action === "confirm" ? (
            <p className="helper">
              Only this request is cancelled. Anyone else on the same stop keeps their trip. If other requests remain,
              the Scheduler updates the route and you approve the new version; if none do, the schedule is cancelled.
            </p>
          ) : (
            <label className="field">
              <span>WHY DOES THE REQUEST STAY? *</span>
              <Textarea value={note} maxLength={500} onChange={(event) => setNote(event.target.value)} />
            </label>
          )}
          {error && (
            <p className="modal-error" role="alert">
              {error}
            </p>
          )}
          <DialogFooter>
            <Button variant="outline" disabled={busy} onClick={close}>
              Back
            </Button>
            <Button
              className="primary"
              disabled={busy || (deciding?.action === "decline" && !note.trim())}
              onClick={decide}
            >
              {busy ? "Working…" : deciding?.action === "confirm" ? "Cancel request" : "Decline cancellation"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </>
  );
}
