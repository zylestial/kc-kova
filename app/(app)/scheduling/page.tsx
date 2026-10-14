import { Suspense } from "react";
import SchedulingGate from "./scheduling-gate";

export const metadata = { title: "KOVA — Scheduling" };

export default function SchedulingPage() {
  return (
    <Suspense>
      <SchedulingGate />
    </Suspense>
  );
}
