"use client";
import Settings from "../../settings";
import { RequireRole } from "../require-role";
import { useAccount } from "../providers";

export default function SettingsGate() {
  const { account } = useAccount();
  return (
    <RequireRole allow={account.role === "Admin"}>
      <Settings />
    </RequireRole>
  );
}
