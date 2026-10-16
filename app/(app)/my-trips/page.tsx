import { Suspense } from "react";
import MyTripsGate from "./my-trips-gate";

export const metadata = { title: "KOVA — My Trips" };

export default function MyTripsPage() {
  return (
    <Suspense>
      <MyTripsGate />
    </Suspense>
  );
}
