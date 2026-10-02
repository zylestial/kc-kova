/** A "YYYY-MM-DD" date written out in the viewer's locale, e.g. "Fri, Oct 2". */
export const dateLabel = (value: string, options: Intl.DateTimeFormatOptions) =>
  new Date(value + "T12:00:00").toLocaleDateString("en-US", options);

/** The same date in full, e.g. "Friday, October 2, 2026". */
export const fullDate = (value: string) =>
  dateLabel(value, { weekday: "long", month: "long", day: "numeric", year: "numeric" });
