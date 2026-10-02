"use client";
import { useAutoClear } from "@/lib/use-auto-clear";
import { stillNeeded } from "@/lib/missing-fields";
import { useEffect, useState } from "react";
import { ListChecks, Plus } from "lucide-react";
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
  saveBookingOption,
  type BookingOption,
} from "@/lib/kova-api";

type Group = "projects" | "destinations" | "purposes";
type Draft = {
  id: string;
  name: string;
  status: "Active" | "Inactive";
  isOtherStop: boolean;
};
const groups: [Group, string, string, string][] = [
  ["projects", "Projects / Sites", "Project / Site", "Add"],
  ["destinations", "Destinations", "Destination", "Add Destination"],
  ["purposes", "Purposes", "Purpose", "Add Purpose"],
];
export default function BookingOptions() {
  const [options, setOptions] = useState(() => getBookingOptions());
  const [modal, setModal] = useState<{
    group: Group;
    mode: "add" | "edit";
  } | null>(null);
  const [draft, setDraft] = useState<Draft>({
    id: "",
    name: "",
    status: "Active",
    isOtherStop: false,
  });
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  useAutoClear(notice, setNotice);
  const [busy, setBusy] = useState(false);
  function load() {
    setOptions(getBookingOptions());
  }
  useEffect(() => {
    window.addEventListener("kova-data-update", load);
    return () => window.removeEventListener("kova-data-update", load);
  }, []);
  function open(group: Group, mode: "add" | "edit", item?: BookingOption) {
    setModal({ group, mode });
    setDraft(
      item
        ? {
            id: item.id,
            name: item.name,
            status: item.status,
            isOtherStop: item.isOtherStop === true,
          }
        : {
            id: crypto.randomUUID(),
            name: "",
            status: "Active",
            isOtherStop: false,
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
    setBusy(true);
    setError("");
    try {
      await saveBookingOption(modal.group, {
        id: draft.id,
        name: draft.name,
        status: draft.status,
        isOtherStop: modal.group === "destinations" ? draft.isOtherStop : undefined,
      });
      setModal(null);
      setNotice("Choice saved.");
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
          const items = options[group];
          return (
            <section className="schedule-panel" key={group}>
              <div className="panel-toolbar">
                <div>
                  <h2>{label}</h2>
                  <span className="count">{items.length}</span>
                </div>
                <Button className="primary" onClick={() => open(group, "add")}>
                  <Plus size={16} /> {addLabel}
                </Button>
              </div>
              {items.length ? (
                <div className="schedule-table">
                  <table>
                    <thead>
                      <tr>
                        <th>NAME</th>
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
                  <div className="empty-icon">
                    <ListChecks size={30} />
                  </div>
                  <h3>No {label.toLowerCase()} yet</h3>
                  <p>Add one to make it available for new requests.</p>
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
