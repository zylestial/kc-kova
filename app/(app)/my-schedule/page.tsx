import { Suspense } from "react";
import MyScheduleGate from "./my-schedule-gate";

export const metadata = { title: "KOVA — My Schedule" };

export default function MySchedulePage() {
  return (
    <Suspense>
      <MyScheduleGate />
    </Suspense>
  );
}
