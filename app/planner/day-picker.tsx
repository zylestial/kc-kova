"use client";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { TransportRequest } from "@/lib/kova-api";
import { addDays } from "@/lib/timezone";
import { dateLabel, fullDate } from "./format";

type Props = {
  months: string[];
  days: string[];
  date: string;
  anchor: string;
  openOn: (day: string) => TransportRequest[];
  pickDate: (day: string) => void;
  setAnchor: (day: string) => void;
};

export default function DayPicker({
  months,
  days,
  date,
  anchor,
  openOn,
  pickDate,
  setAnchor,
}: Props) {
  return (
    <>
      <div className="request-month" aria-live="polite">
        {months.join(" – ")}
      </div>
      <div className="date-strip-wrap">
        <Button variant="outline" size="icon" aria-label="Previous dates" onClick={() => setAnchor(addDays(anchor, -7))}>
          <ChevronLeft size={18} />
        </Button>
        <div className="date-strip">
          {days.map((day) => {
            const open = openOn(day);
            const count = open.length;
            const urgent = open.filter((request) => request.requestType === "URGENT").length;
            return (
              <button
                key={day}
                className={"date-card " + (date === day ? "selected" : "")}
                onClick={() => pickDate(day)}
                aria-pressed={date === day}
                aria-label={`${fullDate(day)}, ${count} waiting${urgent ? `, ${urgent} urgent` : ""}`}
              >
                <span>{dateLabel(day, { weekday: "short" })}</span>
                <b>{dateLabel(day, { day: "numeric" })}</b>
                <small>{count ? `${count} waiting` : "none"}</small>
                {urgent > 0 && <small className="date-card-urgent">{urgent} urgent</small>}
              </button>
            );
          })}
        </div>
        <Button variant="outline" size="icon" aria-label="Next dates" onClick={() => setAnchor(addDays(anchor, 7))}>
          <ChevronRight size={18} />
        </Button>
      </div>
      <div className="date-other">
        <label>
          Jump to date{" "}
          <Input
            type="date"
            value={date}
            onChange={(event) => {
              if (!event.target.value) return;
              setAnchor(event.target.value);
              pickDate(event.target.value);
            }}
          />
        </label>
      </div>
    </>
  );
}
