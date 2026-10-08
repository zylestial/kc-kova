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

/**
 * What is being thrown away: unsaved changes to an approved schedule (nothing
 * on the server yet), a saved revision of one, or a draft of a new schedule.
 */
export type DiscardKind = "changes" | "revision" | "draft";

export const discardLabel: Record<DiscardKind, string> = {
  changes: "Discard changes",
  revision: "Discard revision",
  draft: "Discard draft",
};

const text: Record<DiscardKind, { title: string; description: string; keep: string }> = {
  changes: {
    title: "Discard these changes?",
    description: "Nothing has been saved yet. The approved schedule stays as it is.",
    keep: "Keep editing",
  },
  revision: {
    title: "Discard this revision?",
    description:
      "Any time it holds is released. The approved schedule stays in force; requests added only in this revision go back to Not yet scheduled.",
    keep: "Keep revision",
  },
  draft: {
    title: "Discard this draft?",
    description:
      "Any time it holds is released, and its requests go back to Not yet scheduled, where they can be edited and planned again.",
    keep: "Keep draft",
  },
};

type Props = {
  confirm: "submit" | "discard" | null;
  setConfirm: (value: "submit" | "discard" | null) => void;
  busy: boolean;
  kind: DiscardKind;
  discard: () => void;
};

export default function DiscardDialog({
  confirm,
  setConfirm,
  busy,
  kind,
  discard,
}: Props) {
  return (
    <AlertDialog open={confirm === "discard"} onOpenChange={(open) => !busy && setConfirm(open ? "discard" : null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>{text[kind].title}</AlertDialogTitle>
          <AlertDialogDescription>{text[kind].description}</AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel disabled={busy}>{text[kind].keep}</AlertDialogCancel>
          <AlertDialogAction
            className="danger"
            disabled={busy}
            onClick={(event) => {
              event.preventDefault();
              discard();
            }}
          >
            {busy ? "Discarding…" : discardLabel[kind]}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
