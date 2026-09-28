"use client";
import { useRouter } from "next/navigation";
import Settings from "../../settings";
import { RequireRole } from "../require-role";
import { useAccount } from "../providers";

export default function SettingsGate() {
  const router = useRouter();
  const { account } = useAccount();
  return (
    <RequireRole allow={account.role === "Admin"}>
      <Settings onBack={() => router.push("/home")} />
    </RequireRole>
  );
}
