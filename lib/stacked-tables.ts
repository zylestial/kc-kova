/**
 * Labels every table cell with its column heading (as a data-label) and
 * marks the table for stacking, so the stylesheet can show each row as a
 * card of "Heading: value" lines on a phone instead of a table that scrolls
 * sideways. Tables without a header row, and the printed trip form, are
 * left alone.
 */
export function labelTables(root: ParentNode = document) {
  root.querySelectorAll("table").forEach((table) => {
    if (table.closest(".print-form")) return;
    const headings = [...table.querySelectorAll("thead th")].map((th) => (th.textContent ?? "").trim());
    if (!headings.length) return;
    table.setAttribute("data-stack", "");
    table.querySelectorAll("tbody tr").forEach((row) => {
      [...row.children].forEach((cell, index) => {
        const label = headings[index] ?? "";
        if (cell.getAttribute("data-label") !== label) cell.setAttribute("data-label", label);
      });
    });
  });
}

/** Keeps tables labelled as screens and dialogs come and go; returns a stop function. */
export function watchTables(): () => void {
  let frame = 0;
  const schedule = () => {
    cancelAnimationFrame(frame);
    frame = requestAnimationFrame(() => labelTables());
  };
  labelTables();
  const observer = new MutationObserver(schedule);
  observer.observe(document.body, { childList: true, subtree: true });
  return () => {
    cancelAnimationFrame(frame);
    observer.disconnect();
  };
}
