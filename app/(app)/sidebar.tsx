"use client";
import { useEffect } from "react";
import { usePathname, useRouter } from "next/navigation";
import { CircleHelp, LogOut, X } from "lucide-react";
import { useAccount } from "./providers";
import { activeHref, navItems } from "./nav-items";

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
  const items = navItems(viewRole);
  const active = activeHref(items, pathname);

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

  return (
    <>
      <div className={"sidebar-scrim" + (open ? " open" : "")} onClick={onClose} aria-hidden="true" />
      <aside className={"sidebar" + (open ? " open" : "")} aria-label="Main menu">
        <div className="sidebar-brand">
          <img className="kova-logo" src="/images/kova-print-logo.png" alt="Kayelen's Construction" />
          <div className="sidebar-lockup">
            <strong>KOVA</strong>
            <span>Kayelen&apos;s Operations and Vehicle Allocation</span>
          </div>
          <button type="button" className="sidebar-close" aria-label="Close menu" onClick={onClose}>
            <X size={18} />
          </button>
        </div>
        <nav className="sidebar-nav">
          <span className="sidebar-section">{viewAs ? `Viewing as ${viewAs}` : "Menu"}</span>
          {items.map(({ href, label, icon: Icon }) => (
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
          ))}
        </nav>
        <div className="sidebar-footer">
          <button type="button" className="sidebar-link" onClick={onHelp}>
            <CircleHelp size={18} />
            <span>Help</span>
          </button>
          <div className="sidebar-account">
            <span className="sidebar-avatar" aria-hidden="true">
              {account.name.trim().charAt(0).toUpperCase()}
            </span>
            <div>
              <strong>{account.name}</strong>
              <small>{account.role}</small>
            </div>
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
