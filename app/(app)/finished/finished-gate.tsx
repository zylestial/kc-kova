"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import AdminFinishedTrips from "../../admin-finished-trips";
import { RequireRole } from "../require-role";
import { useAccount } from "../providers";

export default function FinishedGate() {
  const router = useRouter();
  const { viewRole } = useAccount();
  const params = useSearchParams();
  const [openId] = useState(() => params.get("open") ?? undefined);
  useEffect(() => {
    if (params.get("open")) router.replace("/finished");
    // Only ever runs once, on mount, to consume the initial ?open=.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <RequireRole allow={viewRole === "Admin"}>
      <AdminFinishedTrips initialOpenId={openId} />
    </RequireRole>
  );
}
