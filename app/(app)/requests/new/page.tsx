import { Suspense } from "react";
import NewRequestGate from "./new-request-gate";

export const metadata = { title: "KOVA — New Request" };

export default function NewRequestPage() {
  return (
    <Suspense>
      <NewRequestGate />
    </Suspense>
  );
}
