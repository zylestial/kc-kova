"use client";
import { useState } from "react";
import { Car, Plus } from "lucide-react";
import type { Account, Vehicle } from "@/lib/kova-api";
import { VEHICLE_VIEWS, vehicleNeedsDriver } from "@/lib/settings-filters";
import { Button } from "@/components/ui/button";
import { ListLayout, PaneHead, PaneTools, SearchResults, SetupBanner, matchesSearch, type StatusFilter } from "./settings-lists";

/** Settings → Vehicles: one view at a time, picked from the rail (VEHICLE_VIEWS). */
export default function VehicleList({
  vehicles,
  accounts,
  onAdd,
  onEdit,
}: {
  vehicles: Vehicle[];
  accounts: Account[];
  /** Add vehicle, already ticked for company trips when added from that view. */
  onAdd: (companyTrips: boolean) => void;
  onEdit: (vehicle: Vehicle) => void;
}) {
  const [selected, setSelected] = useState("all");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("Active");
  const [searchAll, setSearchAll] = useState("");
  /** A view is open on its own (phones show one or the other). */
  const [open, setOpen] = useState(false);
  const activeDriverIds = new Set(accounts.filter((a) => a.role === "Driver" && a.status === "Active").map((a) => a.id));
  const driverName = (id?: string | null) => (id && accounts.find((a) => a.id === id)?.name) || "";
  const view = VEHICLE_VIEWS.find((item) => item.id === selected)!;
  const inView = vehicles.filter((v) => view.test(v, activeDriverIds));
  // Inactive vehicles show only when asked for, or in their own view.
  const shownStatus = view.id === "inactive" ? "all" : status;
  const term = search.trim().toLowerCase();
  const shown = inView
    .filter((v) => (shownStatus === "all" || v.status === shownStatus) && matchesSearch(term, v.plate, v.name, driverName(v.assignedDriverId)))
    .sort((a, b) => a.plate.localeCompare(b.plate));
  const needDriver = vehicles.filter((v) => vehicleNeedsDriver(v, activeDriverIds)).length;
  const active = vehicles.filter((v) => v.status === "Active").length;
  const allTerm = searchAll.trim().toLowerCase();
  function pick(id: string, query = "") {
    setSelected(id);
    setSearch(query);
    setStatus(query ? "all" : "Active");
    setSearchAll("");
    setOpen(true);
  }
  const add = (
    <Button className="primary" onClick={() => onAdd(view.id === "company")}>
      <Plus size={16} /> Add vehicle
    </Button>
  );
  return (
    <>
      {!active ? (
        <SetupBanner title="No vehicles yet.">Add the company&apos;s vehicles so trips can be planned.</SetupBanner>
      ) : (
        needDriver > 0 && (
          <SetupBanner title={`${needDriver} vehicle${needDriver === 1 ? " has" : "s have"} no Driver.`}>
            An active Daily vehicle needs an assigned Driver before it can go on a Daily trip.
          </SetupBanner>
        )
      )}
      <ListLayout
        items={VEHICLE_VIEWS.map((item) => {
          const count = vehicles.filter((v) => (item.id === "inactive" || v.status === "Active") && item.test(v, activeDriverIds)).length;
          return { id: item.id, section: item.section, label: item.label, count, warn: !!item.warn && count > 0 };
        })}
        selected={selected}
        onSelect={(id) => pick(id)}
        search={searchAll}
        onSearch={setSearchAll}
        searchLabel="Search plates and names"
        open={open || !!allTerm}
      >
        {allTerm ? (
          <SearchResults
            term={searchAll.trim()}
            onBack={() => {
              setSearchAll("");
              setOpen(false);
            }}
            hits={vehicles
              .filter((v) => matchesSearch(allTerm, v.plate, v.name, driverName(v.assignedDriverId)))
              .map((v) => ({ key: v.plate, title: `${v.plate} · ${v.name}`, detail: v.status, open: () => pick("all", v.plate) }))}
          />
        ) : (
          <>
            <PaneHead title={view.label} about={view.about} onBack={() => setOpen(false)} action={view.canAdd ? add : undefined} />
            {vehicles.length > 0 && (
              <PaneTools
                search={search}
                onSearch={setSearch}
                searchLabel="Search plates, names, Drivers"
                status={view.id === "inactive" ? undefined : status}
                onStatus={setStatus}
              />
            )}
            {!inView.length ? (
              <div className="empty">
                {!vehicles.length && (
                  <div className="empty-icon">
                    <Car size={30} />
                  </div>
                )}
                <h3>{view.warn ? "Nothing needs attention" : vehicles.length ? "No vehicles here" : "No vehicles yet"}</h3>
                <p>{view.canAdd ? "Add a vehicle to plan trips with it." : "All clear."}</p>
                {view.canAdd && add}
              </div>
            ) : !shown.length ? (
              <div className="empty">
                <h3>Nothing matches</h3>
                <p>No vehicles here match this search and status.</p>
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
                      <th>VEHICLE</th>
                      <th>USED FOR</th>
                      <th>DRIVER</th>
                      <th>ODOMETER</th>
                      <th>STATUS</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((v) => (
                      <tr key={v.plate}>
                        <td>
                          <b>{v.plate}</b>
                          <small>{v.name}</small>
                        </td>
                        <td>{v.companyTrips ? "Company trips" : "Daily trips"}</td>
                        <td>
                          {v.companyTrips ? (
                            <small>Picked per request</small>
                          ) : vehicleNeedsDriver(v, activeDriverIds) ? (
                            <span className="status-pill pending">No Driver</span>
                          ) : (
                            driverName(v.assignedDriverId) || <small>No Driver assigned</small>
                          )}
                        </td>
                        <td>{v.hasOdometer ? "Yes" : <small>No odometer</small>}</td>
                        <td>
                          <span className={"badge " + (v.status === "Active" ? "complete" : "")}>{v.status}</span>
                        </td>
                        <td>
                          <Button variant="outline" onClick={() => onEdit(v)}>
                            Edit
                          </Button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {vehicles.length > 0 && (
              <div className="panel-foot">
                <span>
                  {active} active · {vehicles.length - active} inactive
                </span>
                <span>Inactive vehicles stay on old trips.</span>
              </div>
            )}
          </>
        )}
      </ListLayout>
    </>
  );
}
