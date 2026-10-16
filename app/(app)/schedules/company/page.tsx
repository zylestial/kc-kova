import { Suspense } from "react";
import CompanyPlannerGate from "./company-planner-gate";

export const metadata = { title: "KOVA — Company Trips" };

export default function CompanyTripsPage() {
  return (
    <Suspense>
      <CompanyPlannerGate />
    </Suspense>
  );
}
