"use client";
import { useEffect, useState } from "react";
import { ArrowLeft } from "lucide-react";
import { useRouter, useSearchParams } from "next/navigation";
import { Button } from "@/components/ui/button";
import MyRequests from "../../my-requests";
import { useAutoClear } from "@/lib/use-auto-clear";
import { RequireRole } from "../require-role";
import { useAccount } from "../providers";

export default function RequestsGate() {
  const router = useRouter();
  const { account } = useAccount();
  const params = useSearchParams();
  // Read once, then strip from the URL so a refresh doesn't re-show it.
  const [notice, setNotice] = useState(() => params.get("notice") ?? "");
  useAutoClear(notice, setNotice);
  useEffect(() => {
    if (params.get("notice")) router.replace("/requests");
    // Only ever runs once, on mount, to consume the initial ?notice=.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return (
    <RequireRole allow={account.role === "Requester" || account.role === "Admin"}>
      <Button variant="ghost" className="back" onClick={() => router.push("/home")}>
        <ArrowLeft size={17} /> {account.role} Home
      </Button>
      <MyRequests notice={notice} />
    </RequireRole>
  );
}
