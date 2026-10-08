"use client";
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
import type { Schedule } from "@/lib/kova-api";

type Props = {
  confirm: "submit" | "discard" | null;
  setConfirm: (value: "submit" | "discard" | null) => void;
  busy: boolean;
  current: Schedule | undefined;
  discard: () => void;
};

export default function DiscardDialog({
  confirm,
  setConfirm,
  busy,
  current,
  discard,
}: Props) {
  return (
    <AlertDialog open={confirm === "discard"} onOpenChange={(open) => !busy && setConfirm(open ? "discard" : null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Discard this draft?</AlertDialogTitle>
          <AlertDialogDescription>
            Any time it holds is released, and its requests go back to Not yet scheduled, where they can be edited
            and planned again.
            {current?.publishedRevisionId && " The approved schedule stays in force."}
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>Keep draft</AlertDialogCancel>
          <AlertDialogAction
            className="danger"
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              discard();
            }}
          >
            {busy ? "Discarding…" : "Discard draft"}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
