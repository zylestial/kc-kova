"use client";
import { Phone } from "lucide-react";
import { contactPhone, stopWhat, type StopInfo } from "@/lib/trip-record";
import { hhmmLabel } from "@/lib/stop-times";

/**
 * What to do at a stop, one request per line: its number, what it asks for,
 * the requester's notes and contact. A shared stop lists each request, so two
 * deliveries don't read as one. Drivers don't see the requester (0067).
 */
export default function StopJobs({ stops, showRequester = false }: { stops: StopInfo[]; showRequester?: boolean }) {
  if (!stops.length) return null;
  return (
    <ul className="stop-jobs">
      {stops.map((stop) => {
        const phone = contactPhone(stop.contact ?? "");
        return (
          <li key={stop.id}>
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
