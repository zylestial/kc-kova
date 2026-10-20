"use client";
import AdminAttendance from "../../admin-attendance";
import { RequireRole } from "../require-role";
import { useAccount } from "../providers";

export default function AttendanceGate() {
  const { viewRole } = useAccount();
  return (
    <RequireRole allow={viewRole === "Admin" || viewRole === "Finance"}>
      <AdminAttendance eyebrow={viewRole === "Finance" ? "FINANCE" : "ADMIN"} />
    </RequireRole>
  );
}
