"use client";
import { useRouter, useSearchParams } from "next/navigation";
import RequestScreen from "../../../request-screen";
import { RequireRole } from "../../require-role";
import { useAccount } from "../../providers";
import { canRequestTransport } from "@/lib/request-access";

/** /requests/new for a new Daily request or Company Trip; /requests/new?edit=<group id> to edit one. */
export default function NewRequestGate() {
  const router = useRouter();
  const params = useSearchParams();
  const { account } = useAccount();
  const groupId = params.get("edit") ?? undefined;
  return (
    <RequireRole allow={canRequestTransport(account)}>
      <RequestScreen
        key={groupId ?? "new"}
        groupId={groupId}
        onDone={(notice) => router.push(notice ? "/requests?notice=" + encodeURIComponent(notice) : "/requests")}
      />
    </RequireRole>
  );
}
