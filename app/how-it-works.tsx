"use client";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { howItWorks, whoToAsk } from "@/lib/help-content";
import type { Role } from "@/lib/kova-api";

/** The short numbered guide for a role, shown on Home and in the Help dialog. */
export function HowItWorks({ role }: { role: Role }) {
  return (
    <ol className="how-steps">
      {howItWorks[role].map((step) => (
        <li key={step.title}>
          <b>{step.title}</b>
          <span>{step.detail}</span>
        </li>
      ))}
    </ol>
  );
}

export function HelpDialog({ role, open, onOpenChange }: { role: Role; open: boolean; onOpenChange: (open: boolean) => void }) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Help</DialogTitle>
          <DialogDescription>How KOVA works for a {role}.</DialogDescription>
        </DialogHeader>
        <HowItWorks role={role} />
        <p className="helper">{whoToAsk[role]}</p>
        <DialogFooter>
          <Button className="primary" onClick={() => onOpenChange(false)}>
            Got it
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
