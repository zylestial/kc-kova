"use client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogTitle } from "@/components/ui/dialog";

export type ConfirmRow = { label: string; value: string };

/**
 * Send request asks first, listing what is being sent, so a wrong date,
 * vehicle or destination is caught before anyone else sees it.
 */
export default function RequestConfirmDialog({
  open,
  title,
  description,
  rows,
  confirmLabel,
  onCancel,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  rows: ConfirmRow[];
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => !next && onCancel()}>
      <DialogContent>
        <DialogTitle>{title}</DialogTitle>
        <DialogDescription>{description}</DialogDescription>
        <dl className="sc-confirm request-confirm">
          {rows.map((row) => (
            <div key={row.label} className="request-confirm-row">
              <dt>{row.label}</dt>
              <dd>{row.value}</dd>
            </div>
          ))}
        </dl>
        <DialogFooter>
          <Button variant="outline" onClick={onCancel}>
            Go back
          </Button>
          <Button className="primary" onClick={onConfirm}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
