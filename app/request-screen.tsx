"use client";
import { useMemo, useState } from "react";
import {
  createRequestGroup,
  hydrateKovaData,
  requestCompanyTrip,
  updateCompanyTrip,
  updateRequestGroup,
  type RequestForm as FormType,
  type RequestGroup,
  type TransportRequest,
} from "@/lib/kova-api";
import { canDriveCompany, canRequestCompany, canRequestDaily } from "@/lib/request-access";
import { useKovaData } from "@/lib/use-kova-data";
import { manilaToday } from "@/lib/timezone";
import { useUnsavedChanges } from "@/lib/unsaved-changes";
import { draftFromGroup, draftHasContent, draftToInput, emptyRequestDraft, type RequestDraft } from "@/lib/request-draft";
import {
  companyDraftFromGroup,
  companyDraftHasContent,
  companyDraftToInput,
  emptyCompanyTripDraft,
  type CompanyTripDraft,
} from "@/lib/company-trip-draft";
import { useAccount } from "./(app)/providers";
import RequestForm, { type KeptChoices } from "./request-form";
import CompanyTripForm, { type CompanyKept } from "./company-trip-form";

const FORMS: Record<FormType, { label: string; hint: string }> = {
  DAILY: { label: "Daily Vehicle Trip", hint: "Regular transport for site and office runs. A Scheduler picks the vehicle." },
  COMPANY: { label: "Company Trip", hint: "The requester books the vehicle, driver and schedule, subject to the Admin's approval." },
};

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

/** The Company trip choices an edit already uses. */
function companyKept(group: RequestGroup, stops: TransportRequest[]): CompanyKept {
  return {
    department: group.department,
    urgentReason: group.urgentReason,
    destinations: stops.flatMap((stop) =>
      stop.destinations.filter((item) => item.destinationId).map((item) => ({ id: item.destinationId!, name: item.destinationName })),
    ),
    vehicle: group.vehiclePlate ? { id: group.vehiclePlate, name: group.vehiclePlate } : undefined,
  };
}

const stopNumbers = (stops: TransportRequest[]) =>
  stops.map((stop) => `${stop.group?.number}-${stop.stopLetter}`).join(", ");

/**
 * New request (the Daily form or the Company trip form), or editing one of
 * the requester's own requests (groupId). onDone gets the notice to show
 * on My requests.
 */
export default function RequestScreen({ groupId, onDone }: { groupId?: string; onDone: (notice: string) => void }) {
  const { account } = useAccount();
  const isAdmin = account?.role === "Admin";
  const { options, requests, since, vehicles, accounts, companyTrips } = useKovaData();
  // The Daily form first when the account may use both; an edit keeps its form.
  const allowed: FormType[] = [
    ...(canRequestDaily(account) ? (["DAILY"] as const) : []),
    ...(canRequestCompany(account) ? (["COMPANY"] as const) : []),
  ];
  const [created] = useState(() => emptyRequestDraft("DAILY", manilaToday()));
  const [createdCompany] = useState(() =>
    emptyCompanyTripDraft(manilaToday(), { id: account?.id ?? "", canDrive: !!account && canDriveCompany(account) }),
  );
  // Which form a new request is on.
  const [newForm, setNewForm] = useState<FormType>(allowed[0] ?? "DAILY");
  // An edit starts from the request as it was when opened: its row version is
  // what the save is checked against, so a newer change isn't overwritten.
  const [openedVersion, setOpenedVersion] = useState<number | null>(null);
  const [draft, setDraft] = useState<RequestDraft | null>(null);
  const [companyDraft, setCompanyDraft] = useState<CompanyTripDraft | null>(null);
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
  const form: FormType = group?.form ?? newForm;
  const lockedIds = new Set(stops.filter((stop) => stop.status === "ACTIVE" && !stopEditable(stop)).map((stop) => stop.id));
  const rowVersion = openedVersion ?? group?.rowVersion;
  const current = draft ?? (groupId ? (group ? draftFromGroup(group, stops, lockedIds) : null) : created);
  const tripStatus = group ? companyTrips.find((item) => item.groupId === group.id) : undefined;
  const personalPlate = vehicles.find((item) => item.ownerAccountId === account?.id && item.status === "Active")?.plate;
  const currentCompany =
    companyDraft ??
    (groupId ? (group?.form === "COMPANY" ? companyDraftFromGroup(group, stops, tripStatus, personalPlate) : null) : createdCompany);

  useUnsavedChanges(
    "new-request",
    !sent &&
      (form === "COMPANY"
        ? !!currentCompany && (groupId ? companyDraft !== null : companyDraftHasContent(currentCompany))
        : !!current && (groupId ? draft !== null : draftHasContent(current))),
  );

  function change(next: RequestDraft) {
    if (openedVersion === null && group) setOpenedVersion(group.rowVersion);
    setDraft(next);
    setError("");
  }

  function changeCompany(next: CompanyTripDraft) {
    if (openedVersion === null && group) setOpenedVersion(group.rowVersion);
    setCompanyDraft(next);
    setError("");
  }

  async function submitCompany() {
    if (!currentCompany) return;
    setBusy(true);
    setError("");
    try {
      const input = companyDraftToInput(currentCompany, personalPlate);
      if (groupId && rowVersion !== undefined) {
        await updateCompanyTrip(groupId, rowVersion, input);
        setSent(true);
        onDone(`Company trip #${group?.number} has been updated and sent to the Admin for approval.`);
      } else {
        const saved = await requestCompanyTrip(input);
        setSent(true);
        onDone(`Company trip #${saved[0]?.group?.number} has been sent to the Admin for approval. The form can be printed once it is approved.`);
      }
    } catch (caught) {
      setError((caught as Error).message);
      if (groupId) await hydrateKovaData().catch(() => undefined);
    } finally {
      setBusy(false);
    }
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
        const saved = await createRequestGroup("DAILY", draftToInput(current));
        setSent(true);
        onDone(
          `Request #${saved[0]?.group?.number} sent: ${stopNumbers(saved)}. Each stop is Not yet scheduled; you'll be notified as each one is planned.`,
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
  // A Company trip can't change once it has started or was cancelled (0094 refuses it too).
  const companyLocked =
    form === "COMPANY" &&
    !!group &&
    (tripStatus?.state === "CANCELLED" || stops.some((stop) => ["COMPLETED", "DONE"].includes(stop.progress)));

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
            {form === "COMPANY"
              ? "The vehicle, driver and schedule are booked here, subject to the Admin's approval."
              : "A Scheduler assigns the vehicle, Driver and times."}
          </p>
        </div>
      </div>
      {groupId && !group ? (
        <div className="notice" role="status">
          {since ? "This request isn't in your list any more." : "Loading the request…"}
        </div>
      ) : (
        <>
          {!groupId && allowed.length > 1 && (
            <section className="request-panel request-form-choice">
              <h2>Which form is this for?</h2>
              <div className="request-choice-cards" role="radiogroup" aria-label="Form">
                {allowed.map((value) => (
                  <label key={value} className={form === value ? "checked" : ""}>
                    <input type="radio" name="request-form" checked={form === value} onChange={() => setNewForm(value)} />
                    <span>
                      {FORMS[value].label}
                      <small>{FORMS[value].hint}</small>
                    </span>
                  </label>
                ))}
              </div>
            </section>
          )}
          {form === "COMPANY" ? (
            companyLocked ? (
              <div className="notice" role="status">
                {tripStatus?.state === "CANCELLED"
                  ? "This request was cancelled, so it can't be changed."
                  : "This trip has started, so it can't be changed."}
              </div>
            ) : (
              currentCompany &&
              account && (
                <CompanyTripForm
                  draft={currentCompany}
                  onChange={changeCompany}
                  me={account}
                  isAdmin={isAdmin}
                  options={options}
                  vehicles={vehicles}
                  accounts={accounts}
                  groupId={group?.id}
                  kept={group ? companyKept(group, stops) : undefined}
                  dateLocked={!!tripStatus && ["APPROVED", "CHANGES_WAITING", "CHANGES_RETURNED"].includes(tripStatus.state)}
                  number={group?.number}
                  busy={busy}
                  error={error}
                  submitLabel={groupId ? "Send changes to the Admin" : "Send request"}
                  cancelLabel={groupId ? "Go back" : "Clear"}
                  onCancel={() => {
                    setError("");
                    if (groupId) onDone("");
                    else setCompanyDraft(createdCompany);
                  }}
                  onSubmit={submitCompany}
                />
              )
            )
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
                    else setDraft(emptyRequestDraft("DAILY", current.date));
                  }}
                  onSubmit={submit}
                />
              </>
            )
          )}
        </>
      )}
    </>
  );
}
