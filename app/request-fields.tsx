"use client";
import { Plus, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type {
  BookingOption,
  BookingOptions,
  RequestInput,
  TransportRequest,
} from "@/lib/kova-api";

const OTHER_OPTION = "__other__";
const NO_PROJECT = "__none__";

export type RequestDraft = {
  date: string;
  requestType: "REGULAR" | "URGENT";
  projectId: string;
  projectOther: string;
  projectOtherMode: boolean;
  // key keeps React rows stable while destinations are added and removed.
  destinations: Array<{ key: string; destinationId: string; purposeId: string }>;
};

const newRow = () => ({ key: crypto.randomUUID(), destinationId: "", purposeId: "" });

export function emptyDraft(date: string, requestType: "REGULAR" | "URGENT"): RequestDraft {
  return { date, requestType, projectId: "", projectOther: "", projectOtherMode: false, destinations: [newRow()] };
}

export function draftFromRequest(request: TransportRequest): RequestDraft {
  return {
    date: request.date,
    requestType: request.requestType,
    projectId: request.projectId ?? "",
    projectOther: request.projectIsOther ? request.projectName : "",
    projectOtherMode: request.projectIsOther,
    destinations: request.destinations.map((item) => ({
      key: item.id,
      destinationId: item.destinationId,
      purposeId: item.purposeId,
    })),
  };
}

export function draftToInput(draft: RequestDraft): RequestInput {
  return {
    date: draft.date,
    requestType: draft.requestType,
    projectId: draft.projectOtherMode ? "" : draft.projectId,
    projectOther: draft.projectOtherMode ? draft.projectOther.trim() : "",
    destinations: draft.destinations.map(({ destinationId, purposeId }) => ({ destinationId, purposeId })),
  };
}

export function draftComplete(draft: RequestDraft) {
  return (
    !!draft.date &&
    draft.destinations.length > 0 &&
    draft.destinations.every((item) => item.destinationId && item.purposeId) &&
    (!draft.projectOtherMode || !!draft.projectOther.trim())
  );
}

/**
 * Choices for one dropdown: Active options, plus any the request being
 * edited already uses (the server lets an edit keep those even after
 * they're made Inactive; see 0024_v2_keep_inactive_on_edit.sql).
 */
function choices(options: BookingOption[], kept: Array<{ id: string; name: string }>) {
  const list = options
    .filter((item) => item.status === "Active")
    .map((item) => ({ id: item.id, name: item.name }));
  for (const item of kept)
    if (item.id && !list.some((option) => option.id === item.id))
      list.push({ id: item.id, name: `${item.name} (inactive)` });
  return list;
}

/** Name to show for a chosen option id, for the Review modal. */
export function optionName(
  options: BookingOption[],
  id: string,
  kept: Array<{ id: string; name: string }> = [],
) {
  return options.find((item) => item.id === id)?.name ?? kept.find((item) => item.id === id)?.name ?? "";
}

export function keptOptions(request?: TransportRequest | null) {
  return {
    projects: request && !request.projectIsOther && request.projectId ? [{ id: request.projectId, name: request.projectName }] : [],
    destinations: request?.destinations.map((item) => ({ id: item.destinationId, name: item.destinationName })) ?? [],
    purposes: request?.destinations.map((item) => ({ id: item.purposeId, name: item.purposeName })) ?? [],
  };
}

export default function RequestFields({
  draft,
  onChange,
  options,
  requestedBy,
  kept = keptOptions(),
  dateHint,
}: {
  draft: RequestDraft;
  onChange: (draft: RequestDraft) => void;
  options: BookingOptions;
  requestedBy: string;
  kept?: ReturnType<typeof keptOptions>;
  dateHint?: string;
}) {
  const projects = choices(options.projects, kept.projects);
  const destinations = choices(options.destinations, kept.destinations);
  const purposes = choices(options.purposes, kept.purposes);
  const setRow = (key: string, change: Partial<RequestDraft["destinations"][number]>) =>
    onChange({
      ...draft,
      destinations: draft.destinations.map((item) => (item.key === key ? { ...item, ...change } : item)),
    });

  return (
    <div className="request-fields">
      <div className="fields booking-fields">
        <label className="field">
          <span>REQUEST TYPE *</span>
          <Select
            value={draft.requestType}
            onValueChange={(value) => onChange({ ...draft, requestType: value as RequestDraft["requestType"] })}
          >
            <SelectTrigger aria-label="Request type">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="REGULAR">Regular · 7 days notice</SelectItem>
              <SelectItem value="URGENT">Urgent · today or tomorrow</SelectItem>
            </SelectContent>
          </Select>
          {dateHint && <small className="field-hint">{dateHint}</small>}
        </label>
        <label className="field">
          <span>REQUESTED BY</span>
          <Input readOnly value={requestedBy} aria-label="Requested by" />
        </label>
        <label className="field">
          <span>PROJECT / SITE</span>
          {draft.projectOtherMode ? (
            <div className="field-other">
              <Input
                aria-label="Project / Site"
                placeholder="Type a Project / Site"
                value={draft.projectOther}
                onChange={(event) => onChange({ ...draft, projectOther: event.target.value })}
                maxLength={120}
                autoFocus
              />
              <button
                type="button"
                className="field-other-back"
                onClick={() => onChange({ ...draft, projectOtherMode: false, projectOther: "" })}
              >
                Choose from list
              </button>
            </div>
          ) : (
            <Select
              value={draft.projectId || NO_PROJECT}
              onValueChange={(value) =>
                value === OTHER_OPTION
                  ? onChange({ ...draft, projectOtherMode: true, projectId: "" })
                  : onChange({ ...draft, projectId: value === NO_PROJECT ? "" : value })
              }
            >
              <SelectTrigger aria-label="Project / Site">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={NO_PROJECT}>None</SelectItem>
                {projects.map((item) => (
                  <SelectItem key={item.id} value={item.id}>
                    {item.name}
                  </SelectItem>
                ))}
                <SelectItem value={OTHER_OPTION}>Other…</SelectItem>
              </SelectContent>
            </Select>
          )}
        </label>
      </div>

      <div className="section-heading request-destinations-heading">
        <h2>Destinations</h2>
        <span className="availability-total">
          {draft.destinations.length} {draft.destinations.length === 1 ? "stop" : "stops"}
        </span>
      </div>
      {draft.destinations.map((item, index) => (
        <div className="request-destination" key={item.key}>
          <b>{index + 1}</b>
          <label className="field">
            <span>DESTINATION *</span>
            <Select value={item.destinationId} onValueChange={(value) => setRow(item.key, { destinationId: value })}>
              <SelectTrigger aria-label={`Destination ${index + 1}`}>
                <SelectValue placeholder="Select Destination" />
              </SelectTrigger>
              <SelectContent>
                {destinations.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <label className="field">
            <span>PURPOSE *</span>
            <Select value={item.purposeId} onValueChange={(value) => setRow(item.key, { purposeId: value })}>
              <SelectTrigger aria-label={`Purpose for destination ${index + 1}`}>
                <SelectValue placeholder="Select Purpose" />
              </SelectTrigger>
              <SelectContent>
                {purposes.map((option) => (
                  <SelectItem key={option.id} value={option.id}>
                    {option.name}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </label>
          <Button
            variant="ghost"
            size="icon"
            aria-label={`Remove destination ${index + 1}`}
            disabled={draft.destinations.length === 1}
            onClick={() =>
              onChange({ ...draft, destinations: draft.destinations.filter((row) => row.key !== item.key) })
            }
          >
            <X size={16} />
          </Button>
        </div>
      ))}
      <Button
        variant="outline"
        className="request-add-destination"
        disabled={draft.destinations.length >= 20}
        onClick={() => onChange({ ...draft, destinations: [...draft.destinations, newRow()] })}
      >
        <Plus size={16} /> Add destination
      </Button>
    </div>
  );
}
