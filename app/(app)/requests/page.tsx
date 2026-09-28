import { Suspense } from "react";
import RequestsGate from "./requests-gate";

export const metadata = { title: "KOVA — My Requests" };

export default function RequestsPage() {
  return (
    <Suspense>
      <RequestsGate />
    </Suspense>
  );
}
