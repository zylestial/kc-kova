"use client";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import DriverSchedules from "../../driver-schedules";
import { RequireRole } from "../require-role";
import { useAccount } from "../providers";

export default function MyScheduleGate() {
  const router = useRouter();
  const { account, viewAs, viewRole } = useAccount();
  return (
    <RequireRole allow={viewRole === "Driver"}>
      <Button variant="ghost" className="back" onClick={() => router.push("/home")}>
        <ArrowLeft size={17} /> {viewRole} Home
      </Button>
      {/* Admin viewing as Driver has no driver_id of their own: pass null so
          every vehicle's trips show, not just one driver's. */}
      <DriverSchedules driverId={viewAs === "Driver" ? null : account.id} />
    </RequireRole>
  );
}
