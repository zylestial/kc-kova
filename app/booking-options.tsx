"use client";
import { useAutoClear } from "@/lib/use-auto-clear";
import { stillNeeded } from "@/lib/missing-fields";
import { useState } from "react";
import { ListChecks, MapPin, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { saveBookingOption, type BookingOption, type OptionGroup } from "@/lib/kova-api";
import { coordinatesLabel, mapUrl } from "@/lib/attendance";
import { parseCoordinates } from "@/lib/coordinates";
import { useKovaData } from "@/lib/use-kova-data";
import { CHOICE_LISTS, activeCount, choiceGaps, gapEffect, needLabel } from "@/lib/choice-lists";
import { ListLayout, PaneHead, PaneTools, SearchResults, SetupBanner, matchesSearch, type StatusFilter } from "./settings-lists";

type Group = OptionGroup;
type Draft = {
  id: string;
  name: string;
  status: "Active" | "Inactive";
  isOtherStop: boolean;
  /** As typed or pasted: coordinates or a Google Maps link. */
  location: string;
};
/** Settings → Request choices: one list at a time, picked from the rail (lib/choice-lists.ts). */
export default function BookingOptions() {
  const { options } = useKovaData();
  const [selected, setSelected] = useState<Group>("projects");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("Active");
  const [searchAll, setSearchAll] = useState("");
  /** A list is open on its own (phones show one or the other). */
  const [open, setOpen] = useState(false);
  const [modal, setModal] = useState<{
    group: Group;
    mode: "add" | "edit";
  } | null>(null);
  const [draft, setDraft] = useState<Draft>({
    id: "",
    name: "",
    status: "Active",
    isOtherStop: false,
    location: "",
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useAutoClear(notice, setNotice);
  const [busy, setBusy] = useState(false);
  function openModal(group: Group, mode: "add" | "edit", item?: BookingOption) {
    setModal({ group, mode });
    setDraft(
      item
        ? {
            id: item.id,
            name: item.name,
            status: item.status,
            isOtherStop: item.isOtherStop === true,
            location: item.location ? coordinatesLabel(item.location) : "",
          }
        : {
            id: crypto.randomUUID(),
            name: "",
            status: "Active",
            isOtherStop: false,
            location: "",
          },
    );
    setError("");
    setNotice("");
  }
  async function save() {
    if (!modal) return;
    if (!draft.name.trim()) {
      setError(stillNeeded(["Name"]));
      return;
    }
    const location = modal.group === "destinations" ? parseCoordinates(draft.location) : null;
    if (location === "invalid") {
      setError("Location isn't readable. In Google Maps, right-click the place and click its coordinates to copy them, then paste here.");
      return;
    }
    setBusy(true);
    setError("");
    try {
      await saveBookingOption(modal.group, {
        id: draft.id,
        name: draft.name,
        status: draft.status,
        isOtherStop: modal.group === "destinations" ? draft.isOtherStop : undefined,
        location: modal.group === "destinations" ? location : undefined,
      });
      setModal(null);
      setNotice("Choice saved.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const title = CHOICE_LISTS.find((list) => list.group === modal?.group)?.one || "";
  const list = CHOICE_LISTS.find((item) => item.group === selected)!;
  const items = options[selected];
  const term = search.trim().toLowerCase();
  const shown = items
    .filter((item) => (status === "all" || item.status === status) && matchesSearch(term, item.name))
    .sort((a, b) => a.name.localeCompare(b.name));
  const gaps = choiceGaps(options);
  const isDestinations = selected === "destinations";
  const noLocation = isDestinations ? items.filter((item) => item.status === "Active" && !item.location).length : 0;
  const allTerm = searchAll.trim().toLowerCase();
  function pick(group: Group, query = "") {
    setSelected(group);
    setSearch(query);
    setStatus(query ? "all" : "Active");
    setSearchAll("");
    setOpen(true);
  }
  const add = (
    <Button className="primary" onClick={() => openModal(selected, "add")}>
      <Plus size={16} /> Add {list.one}
    </Button>
  );
  return (
    <div className="booking-options">
      {notice && (
        <div className="notice success" role="status">
          {notice}
        </div>
      )}
      {gaps.length > 0 && (
        <SetupBanner title={`${gaps.length} list${gaps.length === 1 ? " still needs" : "s still need"} a choice.`}>
          {gaps.some((gap) => gap.need === "every") && "Nobody can send a request until Projects / Sites, Destinations and Purposes each have one. "}
          Missing: {gaps.map((gap) => gap.label).join(", ")}.
        </SetupBanner>
      )}
      <ListLayout
        items={CHOICE_LISTS.map((item) => ({
          id: item.group,
          section: item.section,
          label: item.label,
          count: activeCount(options, item.group),
          warn: gaps.includes(item),
          note: gaps.includes(item) ? needLabel[item.need] : undefined,
        }))}
        selected={selected}
        onSelect={(id) => pick(id as Group)}
        search={searchAll}
        onSearch={setSearchAll}
        searchLabel="Search all choices"
        open={open || !!allTerm}
      >
        {allTerm ? (
          <SearchResults
            term={searchAll.trim()}
            onBack={() => {
              setSearchAll("");
              setOpen(false);
            }}
            hits={CHOICE_LISTS.flatMap((choice) =>
              options[choice.group]
                .filter((item) => matchesSearch(allTerm, item.name))
                .map((item) => ({
                  key: choice.group + item.id,
                  title: item.name,
                  detail: `${choice.label} · ${item.status}`,
                  open: () => pick(choice.group, item.name),
                })),
            )}
          />
        ) : (
          <>
            <PaneHead
              title={list.label}
              tag={<span className={"settings-tag" + (list.need === "optional" ? "" : " required")}>{needLabel[list.need]}</span>}
              about={list.about}
              onBack={() => setOpen(false)}
              action={add}
            />
            {items.length > 0 && (
              <PaneTools
                search={search}
                onSearch={setSearch}
                searchLabel={`Search ${list.label.toLowerCase()}`}
                status={status}
                onStatus={setStatus}
              />
            )}
            {gaps.includes(list) && items.length > 0 && (
              <div className="notice">Every {list.one.toLowerCase()} is Inactive, so nobody can pick one. Make one Active or add a new one.</div>
            )}
            {noLocation > 0 && (
              <div className="notice">
                {noLocation} active destination{noLocation === 1 ? " has" : "s have"} no location, so Drivers&apos; taps there can&apos;t be
                checked.
              </div>
            )}
            {!items.length ? (
              <div className="empty">
                <div className="empty-icon">
                  <ListChecks size={30} />
                </div>
                <h3>No {list.label.toLowerCase()} yet</h3>
                <p>{list.need === "optional" ? "Optional. Add one if requesters need it." : `Add at least one. ${gapEffect(list)}`}</p>
                {add}
              </div>
            ) : !shown.length ? (
              <div className="empty">
                <h3>Nothing matches</h3>
                <p>No {list.label.toLowerCase()} match this search and status.</p>
                <Button
                  variant="outline"
                  onClick={() => {
                    setSearch("");
                    setStatus("all");
                  }}
                >
                  Clear filters
                </Button>
              </div>
            ) : (
              <div className="schedule-table">
                <table>
                  <thead>
                    <tr>
                      <th>NAME</th>
                      {isDestinations && <th>LOCATION</th>}
                      <th>STATUS</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((item) => (
                      <tr key={item.id}>
                        <td>
                          <b>{item.name}</b>
                          {isDestinations && item.isOtherStop && <small>Fuel or errand stop</small>}
                        </td>
                        {isDestinations && (
                          <td>
                            {item.location ? (
                              <a href={mapUrl(item.location.lat, item.location.lng)} target="_blank" rel="noreferrer">
                                <MapPin size={13} /> {coordinatesLabel(item.location)}
                              </a>
                            ) : (
                              <small>No location</small>
                            )}
                          </td>
                        )}
                        <td>
                          <span className={"badge " + (item.status === "Active" ? "complete" : "")}>{item.status}</span>
                        </td>
                        <td>
                          <Button variant="outline" onClick={() => openModal(selected, "edit", item)}>
                            Edit
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {items.length > 0 && (
              <div className="panel-foot">
                <span>
                  {activeCount(options, selected)} active · {items.length - activeCount(options, selected)} inactive
                </span>
                <span>Inactive choices stay on old requests.</span>
              </div>
            )}
          </>
        )}
      </ListLayout>
      <Dialog
        open={!!modal}
        onOpenChange={(v) => {
          if (!v) setModal(null);
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>
              {modal?.mode === "edit" ? "Edit" : "Add"} {title}
            </DialogTitle>
            <DialogDescription>
              Inactive choices stay on old requests but are not offered for new ones.
            </DialogDescription>
          </DialogHeader>
          <div className="modal-fields">
            <label className="field">
              <span>{title} *</span>
              <Input
                value={draft.name}
                maxLength={100}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            {modal?.group === "destinations" && (
              <div className="field">
                <span>Fuel/errand stop</span>
                <div className="person-projects">
                  <label>
                    <Checkbox
                      checked={draft.isOtherStop}
                      onCheckedChange={(v) => setDraft({ ...draft, isOtherStop: v === true })}
                    />
                    A Scheduler can pick this for a leg even when no request needs it.
                  </label>
                </div>
              </div>
            )}
            {modal?.group === "destinations" && (
              <label className="field">
                <span>Location</span>
                <Input
                  value={draft.location}
                  maxLength={2000}
                  placeholder="16.103769, 120.436222"
                  onChange={(e) => setDraft({ ...draft, location: e.target.value })}
                />
                <small className="field-hint">
                  Paste coordinates or a Google Maps link. Drivers&apos; Arrived and Leaving taps here are checked against it; leave blank to skip the check.
                </small>
              </label>
            )}
            <label className="field">
              <span>Status</span>
              <Select
                value={draft.status}
                onValueChange={(v) =>
                  setDraft({ ...draft, status: v as Draft["status"] })
                }
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="Active">Active</SelectItem>
                  <SelectItem value="Inactive">Inactive</SelectItem>
                </SelectContent>
              </Select>
            </label>
          </div>
          {error && (
            <p className="modal-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <Button variant="outline" onClick={() => setModal(null)}>
              Go back
            </Button>
            <Button className="primary" disabled={busy} onClick={save}>
              {busy ? "Saving…" : modal?.mode === "add" ? "Add" : "Save"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
