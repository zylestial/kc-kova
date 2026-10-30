"use client";
import { useRef, useState, useSyncExternalStore } from "react";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { markTourSeen, type Role } from "@/lib/kova-api";
import { canDriveCompany, canRequestTransport } from "@/lib/request-access";
import { menuNote, tourImage, tourLastStep, tourSteps, type TourDevice } from "@/lib/welcome-tour";
import { navItems, navLinks } from "./nav-items";
import { useAccount } from "./providers";

// The same widths the layout switches at: up to 700px the phone layout
// (cards), up to 1023px the tablet one (tables, menu in a drawer). Turning
// a tablet switches the screenshots too.
const PHONE = "(max-width: 700px)";
const TABLET = "(max-width: 1023px)";
function watchDevice(onChange: () => void) {
  const queries = [window.matchMedia(PHONE), window.matchMedia(TABLET)];
  queries.forEach((query) => query.addEventListener("change", onChange));
  return () => queries.forEach((query) => query.removeEventListener("change", onChange));
}
const currentDevice = (): TourDevice => (window.matchMedia(PHONE).matches ? "phone" : window.matchMedia(TABLET).matches ? "tablet" : "pc");

/**
 * The welcome tour: opens by itself on an account's first sign-in (the
 * layout opens it while `tourSeen` is false) and from Help in the menu,
 * always at step 1, for the role being viewed. Closing it any way marks it
 * seen for the account (0084).
 */
export function WelcomeTour({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { account } = useAccount();
  const marked = useRef(account.tourSeen);
  function close() {
    onOpenChange(false);
    if (marked.current) return;
    marked.current = true;
    // If this fails, the tour opens again on the next sign-in.
    void markTourSeen().catch(() => undefined);
  }
  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="tour-dialog gap-0 p-0 sm:max-w-[640px]" showCloseButton={false}>
        {/* Mounted only while open, so each opening starts at step 1. */}
        <TourSteps onClose={close} />
      </DialogContent>
    </Dialog>
  );
}

function TourSteps({ onClose }: { onClose: () => void }) {
  const { account, viewRole } = useAccount();
  const device = useSyncExternalStore(watchDevice, currentDevice, (): TourDevice => "pc");
  const [index, setIndex] = useState(0);
  const steps = tourSteps[viewRole];
  const total = steps.length + 2;
  const last = index === total - 1;
  const step = index === 0 ? null : last ? tourLastStep : steps[index - 1];
  const firstName = account.name.replace(/^(Engr|Arch|Atty|Dr|Mr|Mrs|Ms)\.?\s+/i, "").split(" ")[0];

  return (
    <>
      <div className="tour-head">
        <span className="tour-eyebrow">{viewRole} tour</span>
        <span className="tour-count">
          {index + 1} of {total}
        </span>
      </div>
      <div className="tour-text">
        <DialogTitle>{step ? step.title : `Welcome to KOVA, ${firstName}`}</DialogTitle>
        <DialogDescription>{step ? step.text : `You're signed in as a ${viewRole}. This is your menu and what you can do from it.`}</DialogDescription>
      </div>
      {step ? (
        <div className={"tour-shot" + (step.whole ? " whole" : "")}>
          {/* eslint-disable-next-line @next/next/no-img-element -- fixed screenshots in public/, already sized */}
          <img src={tourImage(device, viewRole, step.image)} alt={`${step.title} screen`} />
        </div>
      ) : (
        <TourMenu device={device} role={viewRole} />
      )}
      <div className="tour-dots" aria-hidden="true">
        {Array.from({ length: total }, (_, n) => (
          <span key={n} className={n === index ? "current" : undefined} />
        ))}
      </div>
      <div className="tour-foot">
        {!last && (
          <button type="button" className="tour-skip" onClick={onClose}>
            Skip tour
          </button>
        )}
        <div className="tour-nav">
          {index > 0 && (
            <Button variant="outline" onClick={() => setIndex(index - 1)}>
              Back
            </Button>
          )}
          <Button className="primary" onClick={() => (last ? onClose() : setIndex(index + 1))}>
            {last ? "Done" : "Next"}
          </Button>
        </div>
      </div>
    </>
  );
}

function TourMenu({ device, role }: { device: TourDevice; role: Role }) {
  const { account } = useAccount();
  const links = navLinks(navItems(role, canRequestTransport(account), canDriveCompany(account))).filter((link) => link.href !== "/home");
  const items = [...links.map((link) => ({ label: link.label, href: link.href })), { label: "My account", href: "/account" }];
  return (
    <div className="tour-menu">
      <div className="tour-menu-shot">
        {/* eslint-disable-next-line @next/next/no-img-element -- fixed screenshots in public/, already sized */}
        <img src={tourImage(device, role, "menu")} alt={`The ${role} menu`} />
      </div>
      <div>
        <h3>You can open</h3>
        <ul>
          {items.map((item) => (
            <li key={item.href}>
              <Check size={16} aria-hidden="true" />
              <span>
                <b>{item.label}</b>
                {menuNote(role, item.href) && <> · {menuNote(role, item.href)}</>}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
