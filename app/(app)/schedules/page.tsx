import { Suspense } from "react";
import SchedulesGate from "./schedules-gate";

export const metadata = { title: "KOVA — Schedules" };

export default function SchedulesPage() {
  return (
    <Suspense>
      <SchedulesGate />
    </Suspense>
  );
}
