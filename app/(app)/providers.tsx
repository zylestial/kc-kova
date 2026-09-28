"use client";
import { createContext, useCallback, useContext, useState } from "react";
import type { Account } from "@/lib/kova-api";
import { hasUnsavedChanges } from "@/lib/unsaved-changes";

type AccountContextValue = {
  account: Account;
  // Admin "view as Scheduler / Driver": client-side view state only, never
  // persisted anywhere. It always starts null and resets whenever this
  // provider remounts (sign-in, refresh), so it can never be a standing or
  // resumable session -- Admin must always click the toggle again. The
  // backend RPCs enforce what Admin may actually do; this only controls
  // what screens Admin sees, and never changes the URL.
  viewAs: "Scheduler" | "Driver" | null;
  setViewAs: (viewAs: "Scheduler" | "Driver" | null) => void;
  viewRole: Account["role"];
  // Runs the action unless there's unsaved work, in which case it asks
  // first. Used both for navigation (`leave(() => router.push(path))`) and
  // for sign-out.
  leave: (action: () => void) => void;
  pendingLeave: (() => void) | null;
  confirmLeave: () => void;
  cancelLeave: () => void;
};

const AccountContext = createContext<AccountContextValue | null>(null);

export function useAccount(): AccountContextValue {
  const ctx = useContext(AccountContext);
  if (!ctx) throw new Error("useAccount must be used inside the (app) layout");
  return ctx;
}

export function AccountProvider({ account, children }: { account: Account; children: React.ReactNode }) {
  const [viewAs, setViewAs] = useState<"Scheduler" | "Driver" | null>(null);
  const [pendingLeave, setPendingLeave] = useState<(() => void) | null>(null);
  const viewRole: Account["role"] = account.role === "Admin" && viewAs ? viewAs : account.role;
  const leave = useCallback((action: () => void) => {
    if (hasUnsavedChanges()) setPendingLeave(() => action);
    else action();
  }, []);
  const confirmLeave = useCallback(() => {
    pendingLeave?.();
    setPendingLeave(null);
  }, [pendingLeave]);
  const cancelLeave = useCallback(() => setPendingLeave(null), []);
  return (
    <AccountContext.Provider
      value={{ account, viewAs, setViewAs, viewRole, leave, pendingLeave, confirmLeave, cancelLeave }}
    >
      {children}
    </AccountContext.Provider>
  );
}
