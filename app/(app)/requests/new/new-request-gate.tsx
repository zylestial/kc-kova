"use client";
import { ArrowLeft } from "lucide-react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import RequestFlow from "../../../request-flow";
import { RequireRole } from "../../require-role";
import { useAccount } from "../../providers";

export default function NewRequestGate() {
  const router = useRouter();
  const { account, leave } = useAccount();
  return (
    <RequireRole allow={account.role === "Requester" || account.role === "Admin"}>
      <Button variant="ghost" className="back" onClick={() => leave(() => router.push("/home"))}>
        <ArrowLeft size={17} /> {account.role} Home
      </Button>
      <RequestFlow
        onSubmitted={() =>
          router.push("/requests?notice=" + encodeURIComponent("Request submitted. A Scheduler will plan the trip."))
        }
      />
    </RequireRole>
  );
}
