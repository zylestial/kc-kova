import { Suspense } from "react";
import FinishedGate from "./finished-gate";

export const metadata = { title: "KOVA — Finished Trips" };

export default function FinishedPage() {
  return (
    <Suspense>
      <FinishedGate />
    </Suspense>
  );
}
