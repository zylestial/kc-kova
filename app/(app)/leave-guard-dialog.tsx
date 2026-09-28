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
import { useAccount } from "./providers";

export default function LeaveGuardDialog() {
  const { pendingLeave, confirmLeave, cancelLeave } = useAccount();
  return (
    <AlertDialog open={pendingLeave !== null} onOpenChange={(open) => !open && cancelLeave()}>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Leave this page?</AlertDialogTitle>
          <AlertDialogDescription>
            You have changes that haven&apos;t been saved. If you leave now, they&apos;ll be lost.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Stay here</AlertDialogCancel>
          <AlertDialogAction className="danger" onClick={confirmLeave}>
            Leave page
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
