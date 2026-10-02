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
import { removeLeg, type LegDraft } from "@/lib/trip-record";

type Props = {
  removingLeg: number | null;
  setRemovingLeg: (index: number | null) => void;
  legs: LegDraft[];
  applyLegs: (next: LegDraft[]) => void;
};

export default function RemoveLegDialog({
  removingLeg,
  setRemovingLeg,
  legs,
  applyLegs,
}: Props) {
  return (
    <AlertDialog open={removingLeg !== null} onOpenChange={(open) => !open && setRemovingLeg(null)}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Remove leg {removingLeg === null ? "" : removingLeg + 1}?</AlertDialogTitle>
          <AlertDialogDescription>
            Its destination, times, contact details and ticked requests are removed. The requests stay selected, so
            you can put them on another leg.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Keep leg</AlertDialogCancel>
          <AlertDialogAction
            className="danger"
            onClick={() => {
              if (removingLeg !== null) applyLegs(removeLeg(legs, removingLeg));
              setRemovingLeg(null);
            }}
          >
            Remove leg
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
