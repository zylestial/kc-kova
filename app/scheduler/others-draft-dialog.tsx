"use client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";

/**
 * Before a change to a trip another Scheduler is planning: "Sam is
 * drafting this trip. Edit anyway?" Nothing stops the edit; it's a warning.
 */
export default function OthersDraftDialog({ question, onAnswer }: { question: string | null; onAnswer: (edit: boolean) => void }) {
  return (
    <Dialog open={!!question} onOpenChange={(open) => !open && onAnswer(false)}>
      <DialogContent>
        <DialogTitle>Someone else is planning this trip</DialogTitle>
        <DialogDescription>{question}</DialogDescription>
        <p className="sc-muted">Your change saves into their draft. Check with them first if you can.</p>
        <DialogFooter>
          <Button variant="outline" onClick={() => onAnswer(false)}>
            Cancel
          </Button>
          <Button className="primary" onClick={() => onAnswer(true)}>
            Edit anyway
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
