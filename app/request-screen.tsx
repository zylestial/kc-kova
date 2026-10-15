"use client";
import { useMemo, useState } from "react";
import {
  createRequestGroup,
  hydrateKovaData,
  updateRequestGroup,
  type RequestForm as FormType,
  type RequestGroup,
  type TransportRequest,
} from "@/lib/kova-api";
import { canRequestCompany, canRequestDaily } from "@/lib/request-access";
import { useKovaData } from "@/lib/use-kova-data";
import { manilaToday } from "@/lib/timezone";
import { useUnsavedChanges } from "@/lib/unsaved-changes";
import { draftFromGroup, draftHasContent, draftToInput, emptyRequestDraft, type RequestDraft } from "@/lib/request-draft";
import { useAccount } from "./(app)/providers";
import RequestForm, { type KeptChoices } from "./request-form";

/** Not yet in a schedule (or sent back): the requester can still change it. */
export const stopEditable = (request: TransportRequest) =>
  request.status === "ACTIVE" &&
  !request.cancellationPending &&
  (request.progress === "NOT_YET_SCHEDULED" || request.progress === "SENT_BACK");

/** The choices a saved request uses, so an edit can keep them after they're made Inactive. */
function keptChoices(group: RequestGroup, stops: TransportRequest[]): KeptChoices {
  const pick = (pairs: Array<[string | undefined, string]>) =>
    pairs.filter(([id]) => !!id).map(([id, name]) => ({ id: id!, name }));
  return {
    projects: pick(stops.filter((stop) => !stop.projectIsOther).map((stop) => [stop.projectId, stop.projectName])),
    destinations: pick(
      stops.flatMap((stop) => stop.destinations.filter((item) => !item.destinationIsOther).map((item) => [item.destinationId, item.destinationName] as [string | undefined, string])),
    ),
    purposes: pick(
      stops.flatMap((stop) =>
        stop.urgentReason ? [] : stop.destinations.filter((item) => !item.purposeIsOther).map((item) => [item.purposeId, item.purposeName] as [string | undefined, string]),
      ),
    ),
    urgent_reasons: pick(stops.map((stop) => [stop.urgentReason?.id, stop.urgentReason?.name ?? ""])),
    suppliers: pick(stops.map((stop) => [stop.supplier?.id, stop.supplier?.name ?? ""])),
    starting_points: pick([[group.startingPoint?.id, group.startingPoint?.name ?? ""]]),
    supervisors: pick([[group.supervisor?.id, group.supervisor?.name ?? ""]]),
    heads: pick([[group.head?.id, group.head?.name ?? ""]]),
    vehicle: group.vehiclePlate ? { id: group.vehiclePlate, name: group.vehiclePlate } : undefined,
    driver: group.driver,
  };
}

const stopNumbers = (stops: TransportRequest[]) =>
  stops.map((stop) => `${stop.group?.number}-${stop.stopLetter}`).join(", ");

/**
 * New request (Daily form), or editing one of the requester's own requests
 * (groupId). onDone gets the notice to show on My requests.
 */
export default function RequestScreen({ groupId, onDone }: { groupId?: string; onDone: (notice: string) => void }) {
  const { account } = useAccount();
  const isAdmin = account?.role === "Admin";
  const { options, requests, since, vehicles, accounts } = useKovaData();
  // The Daily form first when the account may use both; an edit keeps its form.
  const allowed: FormType[] = [
    ...(canRequestDaily(account) ? (["DAILY"] as const) : []),
    ...(canRequestCompany(account) ? (["COMPANY"] as const) : []),
  ];
  const [created] = useState(() => emptyRequestDraft(allowed[0] ?? "DAILY", manilaToday()));
  // An edit starts from the request as it was when opened: its row version is
  // what the save is checked against, so a newer change isn't overwritten.
  const [openedVersion, setOpenedVersion] = useState<number | null>(null);
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState("");

  const stops = useMemo(
    () =>
      groupId
        ? requests
            .filter((item) => item.group?.id === groupId && item.ownerAccountId === account?.id)
            .sort((a, b) => a.stopLetter.localeCompare(b.stopLetter))
        : [],
    [requests, groupId, account?.id],
  );
  const group = stops[0]?.group;
  const lockedIds = new Set(stops.filter((stop) => stop.status === "ACTIVE" && !stopEditable(stop)).map((stop) => stop.id));
  const rowVersion = openedVersion ?? group?.rowVersion;
  const current = draft ?? (groupId ? (group ? draftFromGroup(group, stops, lockedIds) : null) : created);

  useUnsavedChanges("new-request", !sent && !!current && (groupId ? draft !== null : draftHasContent(current)));

  function change(next: RequestDraft) {
    if (openedVersion === null && group) setOpenedVersion(group.rowVersion);
    setDraft(next);
    setError("");
  }

  async function submit() {
    if (!current) return;
    setBusy(true);
    setError("");
    try {
      if (groupId && rowVersion !== undefined) {
        const saved = await updateRequestGroup(groupId, rowVersion, draftToInput(current));
        setSent(true);
        onDone(`Request #${saved[0]?.group?.number ?? group?.number} updated.`);
      } else {
        const saved = await createRequestGroup(current.form, draftToInput(current));
        setSent(true);
        onDone(
          `${current.form === "COMPANY" ? "Company trip" : "Request"} #${saved[0]?.group?.number} sent: ${stopNumbers(saved)}. Each stop is Not yet scheduled; you'll be notified as each one is planned.`,
        );
      }
    } catch (caught) {
      setError((caught as Error).message);
      // Pull the current state so the form shows why (e.g. a stop is now being scheduled).
      if (groupId) await hydrateKovaData().catch(() => undefined);
    } finally {
      setBusy(false);
    }
  }

  const heading = groupId ? `Edit request${group ? " #" + group.number : ""}` : "New request";
  const lockedCount = stops.filter((stop) => lockedIds.has(stop.id)).length;

  return (
    <>
      <div className="page-heading">
        <div>
          <div className="eyebrow">{account?.role.toUpperCase()}</div>
          <h1>
            {heading}
            <span className="title-dot">.</span>
          </h1>
          <p>
            Requesting as {account?.name}
            {account?.position ? ` · ${account.position}` : ""}.{" "}
            {current?.form === "COMPANY"
              ? "You pick the vehicle and its Driver; a Scheduler sets the times."
              : "A Scheduler assigns the vehicle, Driver and times."}
          </p>
        </div>
      </div>
      {groupId && !group ? (
        <div className="notice" role="status">
          {since ? "This request isn't in your list any more." : "Loading the request…"}
        </div>
      ) : (
        current && (
          <>
            {groupId && lockedCount > 0 && (
              <div className="notice info" role="status">
                {lockedCount === stops.filter((stop) => stop.status === "ACTIVE").length
                  ? "Every stop is being scheduled, so nothing can change. Ask for a cancellation from My requests instead."
                  : "Stops that are being scheduled stay as they are. You can still change, add or remove the others."}
              </div>
            )}
            <RequestForm
              draft={current}
              onChange={change}
              options={options}
              isAdmin={isAdmin}
              requestedBy={account?.name ?? ""}
              position={account?.position ?? ""}
              forms={group ? [group.form] : allowed}
              vehicles={vehicles}
              accounts={accounts}
              kept={group ? keptChoices(group, stops) : undefined}
              usedLetters={stops.length}
              dateLocked={lockedCount > 0}
              number={group?.number}
              busy={busy}
              error={error}
              submitLabel={groupId ? "Save changes" : "Send request"}
              cancelLabel={groupId ? "Go back" : "Clear"}
              onCancel={() => {
                setError("");
                if (groupId) onDone("");
                else setDraft(emptyRequestDraft(current.form, current.date));
              }}
              onSubmit={submit}
            />
          </>
        )
      )}
    </>
  );
}
