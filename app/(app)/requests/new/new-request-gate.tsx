"use client";
import { useRouter } from "next/navigation";
import RequestFlow from "../../../request-flow";
import { RequireRole } from "../../require-role";
import { useAccount } from "../../providers";
import { useKovaData } from "@/lib/use-kova-data";
import { canRequestTransport } from "@/lib/request-access";

export default function NewRequestGate() {
  const router = useRouter();
  const { account } = useAccount();
  const { vehicles } = useKovaData();
  return (
    <RequireRole allow={canRequestTransport(account, vehicles)}>
      <RequestFlow
        onSubmitted={() =>
          router.push("/requests?notice=" + encodeURIComponent("Request submitted. A Scheduler will plan the trip."))
        }
      />
    </RequireRole>
  );
}
