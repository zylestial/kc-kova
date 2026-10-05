"use client";
import DriverFinishedTrips from "../../../driver-finished-trips";
import { RequireRole } from "../../require-role";
import { useAccount } from "../../providers";

export default function FinishedDriverGate() {
  const { viewRole } = useAccount();
  return (
    <RequireRole allow={viewRole === "Driver"}>
      <DriverFinishedTrips />
    </RequireRole>
  );
}
