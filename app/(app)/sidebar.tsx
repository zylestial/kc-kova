"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CircleHelp, LogOut, X } from "lucide-react";
import { useAccount } from "./providers";
import { activeHref, navItems, navLinks, type NavItem } from "./nav-items";
import { canDriveCompany, canRequestTransport } from "@/lib/request-access";

export default function Sidebar({
  open,
  onClose,
  onHelp,
  onSignOut,
}: {
  open: boolean;
  onClose: () => void;
  onHelp: () => void;
  onSignOut: () => void;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const { account, viewAs, viewRole, leave } = useAccount();
  const nav = navItems(viewRole, canRequestTransport(account), canDriveCompany(account));
  const active = activeHref(navLinks(nav), pathname);

  // The phone drawer closes on Escape.
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  // Plain links, so they can still be opened in a new tab, but an ordinary
  // click goes through leave() like every other way off a screen.
  function go(event: React.MouseEvent<HTMLAnchorElement>, href: string) {
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.button !== 0) return;
    event.preventDefault();
    onClose();
    if (href !== pathname) leave(() => router.push(href));
  }

  const link = ({ href, label, icon: Icon }: NavItem) => (
    <a
      key={href}
      href={href}
      className={"sidebar-link" + (href === active ? " active" : "")}
      aria-current={href === active ? "page" : undefined}
      onClick={(event) => go(event, href)}
    >
      <Icon size={18} />
      <span>{label}</span>
    </a>
  );

  return (
    <>
      <div className={"sidebar-scrim" + (open ? " open" : "")} onClick={onClose} aria-hidden="true" />
      <aside className={"sidebar" + (open ? " open" : "")} aria-label="Main menu">
        <div className="sidebar-brand">
          <img className="sidebar-logo" src="/images/kova-sidebar-logo.png" alt="Kayelen's Construction" width={216} height={59} />
          <div className="sidebar-lockup">
            <strong>KOVA</strong>
          </div>
          <button type="button" className="sidebar-close" aria-label="Close menu" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <nav className="sidebar-nav">
          {viewAs && <span className="sidebar-section">Viewing as {viewAs}</span>}
          {nav.groups.map((group, index) => (
            <div key={group.heading ?? index} className="sidebar-group">
              {group.heading && <span className="sidebar-section">{group.heading}</span>}
              {group.items.map(link)}
            </div>
          ))}
        </nav>
        <div className="sidebar-footer">
          {nav.footer.map(link)}
          <button type="button" className="sidebar-link" onClick={onHelp}>
            <CircleHelp size={18} />
            <span>Help</span>
          </button>
          <div className="sidebar-account">
            {/* The name opens My account, to keep the menu short. */}
            <a
              href="/account"
              className={"sidebar-profile" + (pathname === "/account" ? " active" : "")}
              aria-current={pathname === "/account" ? "page" : undefined}
              aria-label={`My account: ${account.name}`}
              title="My account"
              onClick={(event) => go(event, "/account")}
            >
              <span className="sidebar-avatar" aria-hidden="true">
                {account.name.trim().charAt(0).toUpperCase()}
              </span>
              <div>
                <strong>{account.name}</strong>
                <small>{account.role} · My account</small>
              </div>
            </a>
            <button
              type="button"
              className="sidebar-signout"
              aria-label="Sign out"
              title="Sign out"
              onClick={() => leave(onSignOut)}
            >
              <LogOut size={17} />
            </button>
          </div>
        </div>
      </aside>
    </>
  );
}
