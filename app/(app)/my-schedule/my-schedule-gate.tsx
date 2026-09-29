"use client";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import DriverSchedules from "../../driver-schedules";
import { RequireRole } from "../require-role";
import { useAccount } from "../providers";

export default function MyScheduleGate() {
  const router = useRouter();
  const { account, viewAs, viewRole } = useAccount();
  const params = useSearchParams();
  const [openId] = useState(() => params.get("open") ?? undefined);
  useEffect(() => {
    if (params.get("open")) router.replace("/my-schedule");
    // Only ever runs once, on mount, to consume the initial ?open=.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <RequireRole allow={viewRole === "Driver"}>
      <Button variant="ghost" className="back" onClick={() => router.push("/home")}>
        <ArrowLeft size={17} /> {viewRole} Home
      </Button>
      {/* Admin viewing as Driver has no driver_id of their own: pass null so
          every vehicle's trips show, not just one driver's. */}
      <DriverSchedules driverId={viewAs === "Driver" ? null : account.id} initialOpenId={openId} />
    </RequireRole>
  );
}
