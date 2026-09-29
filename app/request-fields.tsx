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
import { requestDraftMissing } from "@/lib/missing-fields";

const OTHER_OPTION = "__other__";
const NO_PROJECT = "__none__";

export type RequestDraft = {
  date: string;
  requestType: "REGULAR" | "URGENT";
  projectId: string;
  projectOther: string;
  projectOtherMode: boolean;
  // key keeps React rows stable while destinations are added and removed.
  destinations: Array<{
    key: string;
    destinationId: string;
    destinationOther: string;
    destinationOtherMode: boolean;
    purposeId: string;
    purposeOther: string;
    purposeOtherMode: boolean;
  }>;
};

const newRow = () => ({
  key: crypto.randomUUID(),
  destinationId: "",
  destinationOther: "",
  destinationOtherMode: false,
  purposeId: "",
  purposeOther: "",
  purposeOtherMode: false,
});

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
      destinationId: item.destinationIsOther ? "" : (item.destinationId ?? ""),
      destinationOther: item.destinationIsOther ? item.destinationName : "",
      destinationOtherMode: item.destinationIsOther,
      purposeId: item.purposeIsOther ? "" : (item.purposeId ?? ""),
      purposeOther: item.purposeIsOther ? item.purposeName : "",
      purposeOtherMode: item.purposeIsOther,
    })),
  };
}

export function draftToInput(draft: RequestDraft): RequestInput {
  return {
    date: draft.date,
    requestType: draft.requestType,
    projectId: draft.projectOtherMode ? "" : draft.projectId,
    projectOther: draft.projectOtherMode ? draft.projectOther.trim() : "",
    destinations: draft.destinations.map((item) => ({
      destinationId: item.destinationOtherMode ? "" : item.destinationId,
      destinationOther: item.destinationOtherMode ? item.destinationOther.trim() : "",
      purposeId: item.purposeOtherMode ? "" : item.purposeId,
      purposeOther: item.purposeOtherMode ? item.purposeOther.trim() : "",
    })),
  };
}

export function draftComplete(draft: RequestDraft) {
  return requestDraftMissing(draft).length === 0;
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
    destinations:
      request?.destinations
        .filter((item) => !item.destinationIsOther && item.destinationId)
        .map((item) => ({ id: item.destinationId!, name: item.destinationName })) ?? [],
    purposes:
      request?.destinations
        .filter((item) => !item.purposeIsOther && item.purposeId)
        .map((item) => ({ id: item.purposeId!, name: item.purposeName })) ?? [],
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
          <span>Request type *</span>
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
          <span>Requested by (you)</span>
          <Input readOnly value={requestedBy} aria-label="Requested by" />
        </label>
        <label className="field">
          <span>Project / Site (optional)</span>
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
            <span>Destination *</span>
            {item.destinationOtherMode ? (
              <div className="field-other">
                <Input
                  aria-label={`Destination ${index + 1}`}
                  placeholder="Type a destination"
                  value={item.destinationOther}
                  onChange={(event) => setRow(item.key, { destinationOther: event.target.value })}
                  maxLength={120}
                  autoFocus
                />
                <button
                  type="button"
                  className="field-other-back"
                  onClick={() => setRow(item.key, { destinationOtherMode: false, destinationOther: "" })}
                >
                  Choose from list
                </button>
              </div>
            ) : (
              <Select
                value={item.destinationId}
                onValueChange={(value) =>
                  value === OTHER_OPTION
                    ? setRow(item.key, { destinationOtherMode: true, destinationId: "" })
                    : setRow(item.key, { destinationId: value })
                }
              >
                <SelectTrigger aria-label={`Destination ${index + 1}`}>
                  <SelectValue placeholder="Select Destination" />
                </SelectTrigger>
                <SelectContent>
                  {destinations.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={OTHER_OPTION}>Other…</SelectItem>
                </SelectContent>
              </Select>
            )}
          </label>
          <label className="field">
            <span>Purpose *</span>
            {item.purposeOtherMode ? (
              <div className="field-other">
                <Input
                  aria-label={`Purpose for destination ${index + 1}`}
                  placeholder="Type a purpose"
                  value={item.purposeOther}
                  onChange={(event) => setRow(item.key, { purposeOther: event.target.value })}
                  maxLength={120}
                  autoFocus
                />
                <button
                  type="button"
                  className="field-other-back"
                  onClick={() => setRow(item.key, { purposeOtherMode: false, purposeOther: "" })}
                >
                  Choose from list
                </button>
              </div>
            ) : (
              <Select
                value={item.purposeId}
                onValueChange={(value) =>
                  value === OTHER_OPTION
                    ? setRow(item.key, { purposeOtherMode: true, purposeId: "" })
                    : setRow(item.key, { purposeId: value })
                }
              >
                <SelectTrigger aria-label={`Purpose for destination ${index + 1}`}>
                  <SelectValue placeholder="Select Purpose" />
                </SelectTrigger>
                <SelectContent>
                  {purposes.map((option) => (
                    <SelectItem key={option.id} value={option.id}>
                      {option.name}
                    </SelectItem>
                  ))}
                  <SelectItem value={OTHER_OPTION}>Other…</SelectItem>
                </SelectContent>
              </Select>
            )}
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
