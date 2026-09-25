"use client";
import { useAutoClear } from "@/lib/use-auto-clear";
import { useEffect, useState } from "react";
import { Plus } from "lucide-react";
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
import {
  getBookingOptions,
  getPeople,
  saveBookingOption,
  savePerson,
  type BookingOption,
  type Person,
} from "@/lib/kova-api";

type Group = "projects" | "people" | "destinations" | "purposes";
type Draft = {
  id: string;
  name: string;
  status: "Active" | "Inactive";
  projectIds: string[];
  accountId?: string;
};
const groups: [Group, string, string, string][] = [
  ["projects", "Projects / Sites", "Project / Site", "Add"],
  ["people", "People", "Person", "Add"],
  ["destinations", "Destinations", "Destination", "Add Destination"],
  ["purposes", "Purposes", "Purpose", "Add Purpose"],
];
export default function BookingOptions() {
  const [options, setOptions] = useState(() => getBookingOptions());
  const [people, setPeople] = useState<Person[]>(() => getPeople());
  const [modal, setModal] = useState<{
    group: Group;
    mode: "add" | "edit";
  } | null>(null);
  const [draft, setDraft] = useState<Draft>({
    id: "",
    name: "",
    status: "Active",
    projectIds: [],
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useAutoClear(notice, setNotice);
  const [busy, setBusy] = useState(false);
  function load() {
    setOptions(getBookingOptions());
    setPeople(getPeople());
  }
  useEffect(() => {
    window.addEventListener("kova-data-update", load);
    return () => window.removeEventListener("kova-data-update", load);
  }, []);
  function open(
    group: Group,
    mode: "add" | "edit",
    item?: BookingOption | Person,
  ) {
    setModal({ group, mode });
    setDraft(
      item
        ? {
            id: item.id,
            name: item.name,
            status: item.status,
            projectIds: "projectIds" in item ? [...item.projectIds] : [],
            accountId: "accountId" in item ? item.accountId : undefined,
          }
        : {
            id: crypto.randomUUID(),
            name: "",
            status: "Active",
            projectIds: [],
          },
    );
    setError("");
    setNotice("");
  }
  async function save() {
    if (!modal) return;
    setBusy(true);
    setError("");
    try {
      if (modal.group === "people")
        await savePerson({
          id: draft.id,
          name: draft.name,
          projectIds: draft.projectIds,
          status: draft.status,
          accountId: draft.accountId,
        });
      else
        await saveBookingOption(modal.group, {
          id: draft.id,
          name: draft.name,
          status: draft.status,
        });
      setModal(null);
      setNotice(`${modal.group === "people" ? "Person" : "Choice"} saved.`);
      load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  const title = groups.find((g) => g[0] === modal?.group)?.[2] || "";
  return (
    <div className="booking-options">
      <div className="page-heading">
        <div>
          <h2>Request choices</h2>
          <p>Manage choices used when creating requests.</p>
        </div>
      </div>
      {notice && (
        <div className="notice success" role="status">
          {notice}
        </div>
      )}
      <div className="booking-option-groups">
        {groups.map(([group, label, , addLabel]) => {
          const items = group === "people" ? people : options[group];
          return (
            <section className="schedule-panel" key={group}>
              <div className="panel-toolbar">
                <div>
                  <h2>{label}</h2>
                  <span className="count">{items.length}</span>
                </div>
                <Button
                  className="primary"
                  onClick={() => open(group, "add")}
                  disabled={
                    group === "people" &&
                    !options.projects.some((p) => p.status === "Active")
                  }
                >
                  <Plus size={16} /> {addLabel}
                </Button>
              </div>
              {items.length ? (
                <div className="schedule-table">
                  <table>
                    <thead>
                      <tr>
                        <th>NAME</th>
                        {group === "people" && <th>PROJECT / SITE</th>}
                        <th>STATUS</th>
                        <th />
                      </tr>
                    </thead>
                    <tbody>
                      {items.map((item) => (
                        <tr key={item.id}>
                          <td>
                            <b>{item.name}</b>
                          </td>
                          {group === "people" && (
                            <td>
                              {(item as Person).projectIds
                                .map(
                                  (id) =>
                                    options.projects.find((p) => p.id === id)
                                      ?.name || "—",
                                )
                                .join(", ") || "—"}
                            </td>
                          )}
                          <td>
                            <span
                              className={
                                "badge " +
                                (item.status === "Active" ? "complete" : "")
                              }
                            >
                              {item.status}
                            </span>
                          </td>
                          <td>
                            <Button
                              variant="outline"
                              onClick={() => open(group, "edit", item)}
                            >
                              Edit
                            </Button>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="empty">
                  <h3>No {label.toLowerCase()} yet</h3>
                  <p>
                    {group === "people" &&
                    !options.projects.some((p) => p.status === "Active")
                      ? "Add an active Project / Site first."
                      : "Add one to make it available for new requests."}
                  </p>
                </div>
              )}
            </section>
          );
        })}
      </div>
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
              {modal?.group === "people"
                ? "Choose where this person may be selected as Requested By."
                : "Inactive choices stay on old requests but are not offered for new ones."}
            </DialogDescription>
          </DialogHeader>
          <div className="modal-fields">
            <label className="field">
              <span>{modal?.group === "people" ? "Name" : title} *</span>
              <Input
                value={draft.name}
                maxLength={100}
                onChange={(e) => setDraft({ ...draft, name: e.target.value })}
              />
            </label>
            {modal?.group === "people" && (
              <div className="field">
                <span>Project / Site *</span>
                <div className="person-projects">
                  {options.projects
                    .filter(
                      (p) =>
                        p.status === "Active" ||
                        draft.projectIds.includes(p.id),
                    )
                    .map((p) => (
                      <label key={p.id}>
                        <Checkbox
                          checked={draft.projectIds.includes(p.id)}
                          onCheckedChange={(v) =>
                            setDraft({
                              ...draft,
                              projectIds:
                                v === true
                                  ? [...draft.projectIds, p.id]
                                  : draft.projectIds.filter(
                                      (id) => id !== p.id,
                                    ),
                            })
                          }
                        />
                        {p.name}
                        {p.status === "Inactive" ? " (Inactive)" : ""}
                      </label>
                    ))}
                </div>
              </div>
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
