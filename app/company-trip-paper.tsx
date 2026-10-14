/**
 * The Company Trip Form as it prints (Company Trip Flow prototype): the paper
 * form's header and signatories, with the legs as a table. Signatures and
 * For Finance Use print blank, to fill in by hand. Shown as a preview on the
 * request form; Finished Trips prints it with the recorded times.
 */

export type PaperLeg = {
  /** "Pick up – 40 bags cement", or the urgent reason. */
  purpose: string;
  origin: string;
  destination: string;
  timeOut?: string;
  timeIn?: string;
  contact: string;
  supplier: string;
};

export type CompanyTripPaperData = {
  date: string;
  vehicleName: string;
  plate: string;
  driverName: string;
  requestedBy: string;
  position: string;
  department: string;
  legs: PaperLeg[];
  supervisor: string;
  head: string;
  siteOfficer: string;
  siteCompany: string;
  odometerStart?: number;
  odometerEnd?: number;
};

/** The paper form has room for this many legs; more rows are added when a trip has more. */
const PAPER_ROWS = 8;
const BLANK = "____________";

const paperDate = (date: string) =>
  date ? new Date(date + "T12:00:00").toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : BLANK;

export default function CompanyTripPaper({ data }: { data: CompanyTripPaperData }) {
  const value = (text: string) => text || BLANK;
  const km = (reading?: number) => (reading === undefined ? BLANK : `${reading} km`);
  const distance =
    data.odometerStart !== undefined && data.odometerEnd !== undefined ? `${data.odometerEnd - data.odometerStart} km` : BLANK;
  const rows = Array.from({ length: Math.max(PAPER_ROWS, data.legs.length) }, (_, index) => data.legs[index]);
  const info: Array<[string, string]> = [
    ["DATE", paperDate(data.date)],
    ["VEHICLE", value(data.vehicleName)],
    ["PLATE NO.", value(data.plate)],
    ["DRIVER", value(data.driverName)],
    ["REQUESTED BY", value(data.requestedBy)],
    ["POSITION", value(data.position)],
    ["DEPARTMENT / SITE", value(data.department)],
    ["STARTING ODOMETER", km(data.odometerStart)],
    ["ENDING ODOMETER", km(data.odometerEnd)],
    ["TOTAL DISTANCE", distance],
    ["NO. OF TRIP LEGS", String(data.legs.length)],
  ];

  return (
    <article className="trip-paper" aria-label="Company Trip Form">
      <div className="trip-paper-head">
        <b>KAYELEN&apos;S CONSTRUCTION</b>
      </div>
      <h1>COMPANY TRIP FORM</h1>
      <div className="trip-paper-info">
        {info.map(([label, text]) => (
          <div key={label}>
            {label} <b>{text}</b>
          </div>
        ))}
      </div>
      <h2>ROUTE &amp; RECORDING RULE</h2>
      <p>
        The first trip leg starts at the starting point on the request, and the trip ends at the last destination. Record every
        movement chronologically. The destination of the preceding leg must be the origin of the succeeding leg.
      </p>
      <h2>TRIP RECORD</h2>
      <table>
        <colgroup>
          {[15, 22, 4, 10, 7, 12, 7, 23].map((width, index) => (
            <col key={index} style={{ width: `${width}%` }} />
          ))}
        </colgroup>
        <thead>
          <tr>
            {[
              "REQUESTOR / SIGNATURE",
              "PURPOSE / ACTIVITY AT DESTINATION",
              "LEG",
              "ORIGIN",
              "TIME OUT",
              "DESTINATION",
              "TIME IN",
              "SITE OFFICER / SUPPLIER / CONTACT",
            ].map((title) => (
              <th key={title}>{title}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((leg, index) => (
            <tr key={index}>
              <td>
                Name: {leg ? data.requestedBy : BLANK}
                <div className="trip-paper-sign">Sign: ______________</div>
              </td>
              <td>{leg?.purpose}</td>
              <td className="trip-paper-center">{index + 1}</td>
              <td>{leg?.origin}</td>
              <td>{leg?.timeOut}</td>
              <td>{leg?.destination}</td>
              <td>{leg?.timeIn}</td>
              <td>
                Name: {leg?.contact || "________________"}
                <div className="trip-paper-sign">{leg?.supplier ? `Supplier: ${leg.supplier}` : "Contact: ______________"}</div>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <h2>SIGNATURES / APPROVALS</h2>
      <div className="trip-paper-approvals">
        {(
          [
            ["REQUESTED BY", data.requestedBy],
            ["IMMEDIATE SUPERVISOR APPROVAL", data.supervisor],
            ["SITE OFFICER / SUPPLIER CONFIRMATION", [data.siteOfficer, data.siteCompany].filter(Boolean).join(" · ")],
            ["PROJECT MANAGER / CONSTRUCTION MANAGER / DEPT. HEAD APPROVAL", data.head],
          ] as const
        ).map(([label, name]) => (
          <div key={label} className="trip-paper-approval">
            <span>{label}</span>
            <span>{value(name)}</span>
            <span>SIGNATURE ________________________</span>
          </div>
        ))}
      </div>
      <h2>FOR FINANCE USE</h2>
      <div className="trip-paper-row">
        <span>
          DATE SUBMITTED TO FINANCE <b>{BLANK}</b>
        </span>
        <span>
          RECEIVED BY <b>{BLANK}</b>
        </span>
      </div>
      <p>
        <b>Note:</b> TRIP FORMS must be submitted to the Finance Department by the next business day. Late forms will be considered
        invalid.
      </p>
    </article>
  );
}
