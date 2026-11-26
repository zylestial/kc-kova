"use client";
import { useState } from "react";
import { Button } from "@/components/ui/button";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * Last in a single waiting stop's sheet: delete it for good (0091), after a
 * confirm. A missed stop was on a trip, so it can only be sent back or moved.
 */
export default function DeleteStop({
  label,
  missed,
  busy,
  onDelete,
}: {
  /** The stop's number, e.g. "52-A". */
  label: string;
  missed: boolean;
  busy: boolean;
  onDelete: () => void;
}) {
  const [asking, setAsking] = useState(false);
  return (
    <div>
      <div className="sc-section">Or delete it</div>
      <div className="sc-remove">
        {missed ? (
          <span className="sc-muted">This stop was on a trip, so it can&apos;t be deleted. Send it back or move it instead.</span>
        ) : (
          <span className="sc-muted">Removes {label} for good. The requester isn&apos;t told.</span>
        )}
        <Button variant="outline" className="danger" disabled={busy || missed} onClick={() => setAsking(true)}>
          Delete {label}
        </Button>
      </div>
      <AlertDialog open={asking} onOpenChange={setAsking}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete {label} permanently?</AlertDialogTitle>
            <AlertDialogDescription>This can&apos;t be undone. The requester won&apos;t see it anymore.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Keep it</AlertDialogCancel>
            <AlertDialogAction
              className="danger"
              onClick={() => {
                setAsking(false);
                onDelete();
              }}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
