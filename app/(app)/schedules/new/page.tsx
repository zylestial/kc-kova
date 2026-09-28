import { Suspense } from "react";
import CreateScheduleGate from "./create-schedule-gate";

export const metadata = { title: "KOVA — Create Schedule" };

export default function CreateSchedulePage() {
  return (
    <Suspense>
      <CreateScheduleGate />
    </Suspense>
  );
}
