"use client";
import { useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import DriverSchedules from "../../driver-schedules";
import { RequireRole } from "../require-role";
import { useAccount } from "../providers";

export default function MyScheduleGate() {
  const { account, viewAs, viewRole } = useAccount();
  const params = useSearchParams();
  const [openId] = useState(() => params.get("open") ?? undefined);
  useEffect(() => {
    // The browser's own history, not router.replace: that asks the server
    // for the page again, and with no signal (a Driver opening a trip from
    // a notification on the road) the failed fetch reloads it offline.
    if (params.get("open")) window.history.replaceState(null, "", "/my-schedule");
    // Only ever runs once, on mount, to consume the initial ?open=.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <RequireRole allow={viewRole === "Driver"}>
      {/* Admin viewing as Driver has no driver_id of their own: pass null so
          every vehicle's trips show, not just one driver's. */}
      <DriverSchedules driverId={viewAs === "Driver" ? null : account.id} initialOpenId={openId} />
    </RequireRole>
  );
}
