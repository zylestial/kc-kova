"use client";
import { useSearchParams } from "next/navigation";
import MyTrips from "../../my-trips";
import { RequireRole } from "../require-role";
import { useAccount } from "../providers";
import { canRequestCompany } from "@/lib/request-access";

/** /my-trips, or ?open=<schedule id> to open one trip. */
export default function MyTripsGate() {
  const { account } = useAccount();
  const params = useSearchParams();
  return (
    <RequireRole allow={canRequestCompany(account)}>
      <MyTrips accountId={account.id} initialOpenId={params.get("open") ?? undefined} />
    </RequireRole>
  );
}
