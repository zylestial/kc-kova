"use client";
import { useState } from "react";
import type { Account, EmailStatus, Invite } from "@/lib/kova-api";
import { canDriveCompany } from "@/lib/request-access";
import { ACCOUNT_VIEWS, INVITES_VIEW, accessLabels } from "@/lib/settings-filters";
import { Button } from "@/components/ui/button";
import { InviteTable, roleLabel } from "./invites-panel";
import { ListLayout, PaneHead, PaneTools, SearchResults, SetupBanner, matchesSearch, type StatusFilter } from "./settings-lists";

/** Settings → Accounts: one view at a time, picked from the rail, with Pending invites last (ACCOUNT_VIEWS). */
export default function AccountList({
  accounts,
  emails,
  invites,
  invitesError,
  onInvitesRetry,
  inviteBusy,
  onInviteAct,
  onEdit,
  resending,
  onResendLink,
}: {
  accounts: Account[];
  /** Every account's email (0072), by account id. */
  emails: Record<string, EmailStatus>;
  invites: Invite[];
  invitesError: string;
  onInvitesRetry: () => void;
  inviteBusy: string;
  onInviteAct: (invite: Invite, action: "resend" | "cancel") => void;
  onEdit: (account: Account) => void;
  /** The account whose confirm link is being sent again. */
  resending: string;
  onResendLink: (account: Account) => void;
}) {
  const [selected, setSelected] = useState("all");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>("Active");
  const [searchAll, setSearchAll] = useState("");
  /** A view is open on its own (phones show one or the other). */
  const [open, setOpen] = useState(false);
  const email = (account: Account) => emails[account.id]?.email ?? "";
  const term = search.trim().toLowerCase();
  const allTerm = searchAll.trim().toLowerCase();
  const isInvites = selected === INVITES_VIEW.id;
  const view = ACCOUNT_VIEWS.find((item) => item.id === selected) ?? ACCOUNT_VIEWS[0];
  // A view's accounts; the Access views count only Active ones, as their rules do.
  const inView = accounts.filter((a) => view.test({ ...a, status: "Active" }));
  const shown = inView
    .filter((a) => (status === "all" || a.status === status) && matchesSearch(term, a.name, a.username, email(a)))
    .sort((a, b) => a.name.localeCompare(b.name));
  const shownInvites = invites.filter((invite) => matchesSearch(term, invite.email));
  const expired = invites.filter((invite) => invite.expired).length;
  const noEmail = inView.filter((a) => a.status === "Active" && !email(a)).length;
  const active = accounts.filter((a) => a.status === "Active").length;
  const setup = [
    !accounts.some(canDriveCompany) && "Nobody can drive Company trips yet: switch on “Can drive company trips” for the people who will.",
    !accounts.some((a) => a.role === "Scheduler" && a.status === "Active") && "There's no Scheduler, so nobody can plan trips.",
    expired > 0 && `${expired} invite${expired === 1 ? " has" : "s have"} expired. Resend ${expired === 1 ? "it" : "them"} under Pending invites.`,
  ].filter(Boolean);
  function pick(id: string, query = "") {
    setSelected(id);
    setSearch(query);
    setStatus(query ? "all" : "Active");
    setSearchAll("");
    setOpen(true);
  }
  const rail = [
    ...ACCOUNT_VIEWS.map((item) => {
      const count = accounts.filter((a) => a.status === "Active" && item.test(a)).length;
      const warn = !!item.warnIfEmpty && count === 0;
      return { id: item.id, section: item.section, label: item.label, count, warn, note: warn ? item.warnIfEmpty : undefined };
    }),
    { ...INVITES_VIEW, count: invites.length, warn: expired > 0, note: expired ? `${expired} expired` : undefined },
  ];
  return (
    <>
      {setup.length > 0 && <SetupBanner title="Check before people start.">{setup.join(" ")}</SetupBanner>}
      <ListLayout
        items={rail}
        selected={selected}
        onSelect={(id) => pick(id)}
        search={searchAll}
        onSearch={setSearchAll}
        searchLabel="Search names, usernames, emails"
        open={open || !!allTerm}
      >
        {allTerm ? (
          <SearchResults
            term={searchAll.trim()}
            onBack={() => {
              setSearchAll("");
              setOpen(false);
            }}
            hits={[
              ...accounts
                .filter((a) => matchesSearch(allTerm, a.name, a.username, email(a)))
                .map((a) => ({ key: a.id, title: a.name, detail: `${roleLabel(a)} · ${a.status}`, open: () => pick("all", a.username) })),
              ...invites
                .filter((invite) => matchesSearch(allTerm, invite.email))
                .map((invite) => ({ key: invite.id, title: invite.email, detail: "Pending invite", open: () => pick(INVITES_VIEW.id, invite.email) })),
            ]}
          />
        ) : isInvites ? (
          <>
            <PaneHead title={INVITES_VIEW.label} about={INVITES_VIEW.about} onBack={() => setOpen(false)} />
            {invitesError && (
              <div className="notice" role="alert">
                {invitesError}{" "}
                <Button variant="ghost" onClick={onInvitesRetry}>
                  Retry
                </Button>
              </div>
            )}
            {invites.length > 0 && <PaneTools search={search} onSearch={setSearch} searchLabel="Search emails" />}
            {!invites.length ? (
              <div className="empty">
                <h3>No pending invites</h3>
                <p>Use Invite people at the top to add someone. They set up their own name, username and password from the emailed link.</p>
              </div>
            ) : !shownInvites.length ? (
              <div className="empty">
                <h3>Nothing matches</h3>
                <p>No invites match this search.</p>
              </div>
            ) : (
              <InviteTable invites={shownInvites} busy={inviteBusy} onAct={onInviteAct} />
            )}
          </>
        ) : (
          <>
            <PaneHead title={view.label} about={view.about} onBack={() => setOpen(false)} />
            <PaneTools search={search} onSearch={setSearch} searchLabel="Search names, usernames, emails" status={status} onStatus={setStatus} />
            {noEmail > 0 && (
              <div className="notice">
                {noEmail} active account{noEmail === 1 ? " has" : "s have"} no confirmed email, so Forgot password can&apos;t reach{" "}
                {noEmail === 1 ? "it" : "them"}.
              </div>
            )}
            {!inView.length ? (
              <div className="empty">
                <h3>{view.warnIfEmpty ?? `No ${view.label.toLowerCase()} yet`}</h3>
                <p>
                  {view.id === "drive-company"
                    ? "Open someone's account and switch on “Can drive company trips”, or invite a Company car Driver."
                    : "Use Invite people at the top to add them."}
                </p>
              </div>
            ) : !shown.length ? (
              <div className="empty">
                <h3>Nothing matches</h3>
                <p>No accounts here match this search and status.</p>
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
                      <th>ACCOUNT TYPE</th>
                      <th>ACCESS</th>
                      <th>STATUS</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {shown.map((a) => {
                      // What it has when Active, so an Inactive account still shows it.
                      const access = accessLabels({ ...a, status: "Active" });
                      const pending = emails[a.id]?.pendingEmail;
                      return (
                        <tr key={a.id}>
                          <td>
                            <b>{a.name}</b>
                            <small>
                              {a.username}
                              {email(a) && ` · ${email(a)}`}
                            </small>
                            {pending && (
                              <div className="account-email-pending">
                                <span className="badge">Not confirmed</span> {pending}{" "}
                                <Button variant="ghost" disabled={!!resending} onClick={() => onResendLink(a)}>
                                  {resending === a.id ? "Sending…" : "Resend"}
                                </Button>
                              </div>
                            )}
                          </td>
                          <td>
                            {roleLabel(a)}
                            {a.position && <small>{a.position}</small>}
                          </td>
                          <td>
                            {access.length ? (
                              <div className="settings-chips">
                                {access.map((label) => (
                                  <span className="settings-tag" key={label}>
                                    {label}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              "—"
                            )}
                          </td>
                          <td>
                            <span className={"badge " + (a.status === "Active" ? "complete" : "")}>{a.status}</span>
                          </td>
                          <td>
                            <Button variant="outline" onClick={() => onEdit(a)}>
                              Edit
                            </Button>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
            <div className="panel-foot">
              <span>
                {active} active · {accounts.length - active} inactive
              </span>
              <span>Accounts are never deleted; mark one Inactive to stop its sign-in.</span>
            </div>
          </>
        )}
      </ListLayout>
    </>
  );
}
