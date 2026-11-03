"use client";
import { Phone } from "lucide-react";
import { contactPhone, stopWhat, type StopInfo } from "@/lib/trip-record";
import { hhmmLabel } from "@/lib/stop-times";
import type { JobFlag } from "@/lib/stop-reports";

const FLAG_TEXT: Record<JobFlag, string> = {
  REPORTED: "Reported, waiting for the Scheduler",
  SKIPPED: "Skipped, don't do this one",
};

/**
 * What to do at a stop, one request per line: its number, what it asks for,
 * the requester's notes and contact. A shared stop lists each request, so two
 * deliveries don't read as one. Drivers don't see the requester (0067). A
 * request a report names says so, and one the Scheduler skipped is crossed out.
 */
export default function StopJobs({
  stops,
  showRequester = false,
  flags,
}: {
  stops: StopInfo[];
  showRequester?: boolean;
  /** Requests a report names (lib/stop-reports), by request id. */
  flags?: Map<string, JobFlag>;
}) {
  if (!stops.length) return null;
  return (
    <ul className="stop-jobs">
      {stops.map((stop) => {
        const phone = contactPhone(stop.contact ?? "");
        const flag = flags?.get(stop.requestId);
        return (
          <li key={stop.id} className={flag === "SKIPPED" ? "skipped" : flag === "REPORTED" ? "reported" : undefined}>
            {flag && <span className="stop-job-flag">{FLAG_TEXT[flag]}</span>}
            <b>
              {[stop.stopNumber, showRequester && stop.requester, stopWhat(stop), stop.fixedTime && `At ${hhmmLabel(stop.fixedTime)}`]
                .filter(Boolean)
                .join(" · ")}
            </b>
            {stop.details && <div>{stop.details}</div>}
            {stop.contact && (
              <div>
                {phone ? (
                  <a href={`tel:${phone}`}>
                    <Phone size={14} /> {stop.contact}
                  </a>
                ) : (
                  `Contact: ${stop.contact}`
                )}
              </div>
            )}
          </li>
        );
      })}
    </ul>
  );
}
