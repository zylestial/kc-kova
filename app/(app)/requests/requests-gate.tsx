"use client";
import { useEffect, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import MyRequests from "../../my-requests";
import type { RequestProgress } from "@/lib/kova-api";
import { requestProgressLabel } from "@/lib/status-text";
import { useAutoClear } from "@/lib/use-auto-clear";
import { RequireRole } from "../require-role";
import { useAccount } from "../providers";
import { useKovaData } from "@/lib/use-kova-data";
import { canRequestTransport } from "@/lib/request-access";

export default function RequestsGate() {
  const router = useRouter();
  const { account } = useAccount();
  const { vehicles } = useKovaData();
  const params = useSearchParams();
  // Read once, then strip from the URL so a refresh doesn't re-show it.
  const [notice, setNotice] = useState(() => params.get("notice") ?? "");
  const [openRequestId] = useState(() => params.get("open") ?? undefined);
  // A Dashboard tile's starting filter.
  const [progress] = useState(() => {
    const value = params.get("progress");
    return value && Object.hasOwn(requestProgressLabel, value) ? (value as RequestProgress) : undefined;
  });
  useAutoClear(notice, setNotice);
  useEffect(() => {
    if (["notice", "open", "progress"].some((key) => params.get(key))) router.replace("/requests");
    // Only ever runs once, on mount, to consume the initial query.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <RequireRole allow={canRequestTransport(account, vehicles)}>
      <MyRequests notice={notice} openRequestId={openRequestId} initialProgress={progress} />
    </RequireRole>
  );
}
