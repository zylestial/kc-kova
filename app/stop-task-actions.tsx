"use client";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { tapTimeLabel } from "@/lib/attendance";
import type { StopTask, StopTaskInput } from "@/lib/kova-api";
import type { JobFlag } from "@/lib/stop-reports";
import { taskDone } from "@/lib/stop-tasks";

/**
 * One request's answer at a stop (0088): its Done time, or, at the stop the
 * Driver is at, Done and Not yet done. Not yet done is the stop report naming
 * this request, so a task reported or skipped says so instead (StopJobs).
 */
export default function StopTaskActions({
  legId,
  requestId,
  tasks,
  flag,
  live,
  busy,
  onTask,
  onNotDone,
}: {
  legId: string;
  requestId: string;
  tasks: StopTask[];
  flag?: JobFlag;
  /** The Driver is at this stop and can answer. */
  live: boolean;
  busy: boolean;
  onTask: (legId: string, requestId: string, kind: StopTaskInput["kind"]) => void;
  onNotDone: (legId: string, requestId: string) => void;
}) {
  const done = taskDone(tasks, legId, requestId);
  if (done) {
    return (
      <div className="stop-task-done">
        <Check size={16} />
        <span>Done</span>
        <b>{tapTimeLabel(done.at)}</b>
        {done.saved && <small>waiting for signal</small>}
        {live && (
          <button type="button" className="stop-task-undo" disabled={busy} onClick={() => onTask(legId, requestId, "UNDO")}>
            Undo
          </button>
        )}
      </div>
    );
  }
  if (!live || flag) return null;
  return (
    <div className="stop-task-buttons">
      <Button variant="outline" className="stop-task-yes" disabled={busy} onClick={() => onTask(legId, requestId, "DONE")}>
        Done
      </Button>
      <Button variant="outline" disabled={busy} onClick={() => onNotDone(legId, requestId)}>
        Not yet done
      </Button>
    </div>
  );
}
