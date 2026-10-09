"use client";
import { ArrowDown, ArrowUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { Select, SelectContent, SelectGroup, SelectItem, SelectLabel, SelectTrigger, SelectValue } from "@/components/ui/select";
import {
  BASE,
  candidatesForLeg,
  changeLegDestination,
  legGroupKey,
  legHasContent,
  moveLeg,
  poolDestinationChoices,
  removeLeg,
  setLegTimeIn,
  type LegDraft,
  type StopInfo,
} from "@/lib/trip-record";

type Props = {
  leg: LegDraft;
  index: number;
  legs: LegDraft[];
  origins: string[];
  legDestinationName: (leg: LegDraft) => string;
  poolStops: StopInfo[];
  stopsById: Map<string, StopInfo>;
  poolChoices: ReturnType<typeof poolDestinationChoices>;
  otherStopChoices: Array<{ id: string; name: string }>;
  otherStopDestinationIds: Set<string>;
  warnings: string[][];
  applyLegs: (next: LegDraft[]) => void;
  changeLeg: (index: number, patch: Partial<LegDraft>) => void;
  setLegs: (next: LegDraft[]) => void;
  toggleStop: (index: number, stopId: string, checked: boolean) => void;
  setRemovingLeg: (index: number | null) => void;
};

export default function LegCard({
  leg,
  index,
  legs,
  origins,
  legDestinationName,
  poolStops,
  stopsById,
  poolChoices,
  otherStopChoices,
  otherStopDestinationIds,
  warnings,
  applyLegs,
  changeLeg,
  setLegs,
  toggleStop,
  setRemovingLeg,
}: Props) {
  const candidates = candidatesForLeg(legs, index, poolStops);
  const served = leg.stops.map((id) => stopsById.get(id)).filter((stop) => !!stop);
  return (
    <div className="leg-card">
      <div className="leg-label">
        <b>
          LEG {String(index + 1).padStart(2, "0")}
          {leg.isFinal && " · RETURN TO ANONANG"}
        </b>
        <span className="leg-actions">
          {!leg.isFinal && (
            <>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Move leg ${index + 1} up`}
                disabled={index === 0}
                onClick={() => applyLegs(moveLeg(legs, index, -1))}
              >
                <ArrowUp size={16} />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                aria-label={`Move leg ${index + 1} down`}
                disabled={index === legs.length - 1 || legs[index + 1].isFinal}
                onClick={() => applyLegs(moveLeg(legs, index, 1))}
              >
                <ArrowDown size={16} />
              </Button>
            </>
          )}
          {legs.length > 1 && (
            <Button
              variant="ghost"
              onClick={() => (legHasContent(leg) ? setRemovingLeg(index) : applyLegs(removeLeg(legs, index)))}
            >
              Remove leg
            </Button>
          )}
        </span>
      </div>
      <div className="fields leg-fields">
        <label className="field">
          <span>Origin (automatic)</span>
          <Input value={origins[index]} readOnly />
        </label>
        <label className="field">
          <span>Planned Time Out</span>
          <Input
            type="time"
            value={leg.plannedTimeOut}
            aria-label={`Leg ${index + 1} planned Time Out`}
            onChange={(event) => changeLeg(index, { plannedTimeOut: event.target.value })}
          />
        </label>
        {leg.isFinal ? (
          <label className="field">
            <span>Destination</span>
            <Input value={BASE} readOnly />
          </label>
        ) : (
          <label className="field">
            <span>Destination *</span>
            <Select
              value={legGroupKey(leg)}
              onValueChange={(value) =>
                applyLegs(changeLegDestination(legs, index, value, poolStops, otherStopDestinationIds))
              }
            >
              <SelectTrigger aria-label={`Leg ${index + 1} destination`}>
                <SelectValue placeholder="Select a destination" />
              </SelectTrigger>
              <SelectContent>
                {leg.stops.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>On this leg</SelectLabel>
                    <SelectItem value={legGroupKey(leg)}>{legDestinationName(leg)}</SelectItem>
                  </SelectGroup>
                )}
                {poolChoices.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>From the request pool</SelectLabel>
                    {poolChoices.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name}
                        {option.urgent && <span className="badge urgent">URGENT</span>}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
                {otherStopChoices.length > 0 && (
                  <SelectGroup>
                    <SelectLabel>Fuel/errand stops</SelectLabel>
                    {otherStopChoices.map((option) => (
                      <SelectItem key={option.id} value={option.id}>
                        {option.name}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                )}
              </SelectContent>
            </Select>
          </label>
        )}
        <label className="field">
          <span>Planned Time In</span>
          <Input
            type="time"
            value={leg.plannedTimeIn}
            aria-label={`Leg ${index + 1} planned Time In`}
            onChange={(event) => setLegs(setLegTimeIn(legs, index, event.target.value))}
          />
        </label>
      </div>
      {!leg.isFinal && (
        <details className="leg-contact" open={!!(leg.contactName || leg.contactNumber) || undefined}>
          <summary>{leg.contactName || leg.contactNumber ? "Contact" : "+ Add contact"}</summary>
          <div className="fields leg-fields">
            <label className="field">
              <span>Destination contact name</span>
              <Input value={leg.contactName} onChange={(event) => changeLeg(index, { contactName: event.target.value })} />
            </label>
            <label className="field">
              <span>Contact number</span>
              <Input value={leg.contactNumber} onChange={(event) => changeLeg(index, { contactNumber: event.target.value })} />
            </label>
          </div>
        </details>
      )}
      {!!warnings[index]?.length && (
        <ul className="leg-warnings" role="alert">
          {warnings[index].map((warning) => (
            <li key={warning}>{warning}</li>
          ))}
        </ul>
      )}
      {!leg.isFinal && leg.stops.length > 0 && (
        <div className="leg-stops">
          <span className="summary-label">
            Requests served here
            {served.length > 1 && <span className="badge">One stop for {served.length} requests</span>}
          </span>
          {candidates.map((stop) => (
            <label key={stop.id}>
              <Checkbox
                checked={leg.stops.includes(stop.id)}
                onCheckedChange={(value) => toggleStop(index, stop.id, value === true)}
              />
              <span>
                <b>{stop.requester}</b> — {stop.purposeName}
              </span>
            </label>
          ))}
          <p className="helper">
            Served automatically — untick only if it shouldn&apos;t travel with this leg.
          </p>
        </div>
      )}
    </div>
  );
}
