"use client";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import DriverFinishedTrips from "../../../driver-finished-trips";
import { RequireRole } from "../../require-role";
import { useAccount } from "../../providers";

export default function FinishedDriverGate() {
  const router = useRouter();
  const { viewRole } = useAccount();
  return (
    <RequireRole allow={viewRole === "Driver"}>
      <Button variant="ghost" className="back" onClick={() => router.push("/home")}>
        <ArrowLeft size={17} /> {viewRole} Home
      </Button>
      <DriverFinishedTrips />
    </RequireRole>
  );
}
