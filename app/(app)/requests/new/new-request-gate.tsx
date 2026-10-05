"use client";
import { useRouter } from "next/navigation";
import RequestFlow from "../../../request-flow";
import { RequireRole } from "../../require-role";
import { useAccount } from "../../providers";

export default function NewRequestGate() {
  const router = useRouter();
  const { account } = useAccount();
  return (
    <RequireRole allow={account.role === "Requester" || account.role === "Admin"}>
      <RequestFlow
        onSubmitted={() =>
          router.push("/requests?notice=" + encodeURIComponent("Request submitted. A Scheduler will plan the trip."))
        }
      />
    </RequireRole>
  );
}
