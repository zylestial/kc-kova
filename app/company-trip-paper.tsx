/**
 * The Company Trip Form as it prints: the company's one-page "Company Trip
 * Form – Employee Fleet Card Utilization" (Company trip v2 prototype, v26).
 * Sections A and B come from the request; the odometers fill in once the
 * trip has ended. Sections C to F print blank, to fill in by hand. Black
 * and white, A4, one page.
 */

export type CompanyTripPaperData = {
  date: string;
  employeeName: string;
  position: string;
  department: string;
  plate: string;
  vehicleName: string;
  personal: boolean;
  /** Blank when the employee drives. */
  driverName: string;
  fleetCard: string;
  destinations: string[];
  purpose: string;
  passengers: string;
  /** "HH:MM" */
  timeOut: string;
  timeIn: string;
  odometerStart?: number | null;
  odometerEnd?: number | null;
  /** The trip ended in a vehicle without an odometer (0078). */
  noOdometer?: boolean;
};

const paperDate = (date: string) =>
  date ? new Date(date + "T12:00:00").toLocaleDateString("en-PH", { month: "short", day: "numeric", year: "numeric" }) : "";

const clock = (time: string) => {
  if (!time) return "";
  const [hours, minutes] = time.split(":").map(Number);
  return `${hours % 12 || 12}:${String(minutes).padStart(2, "0")} ${hours < 12 ? "AM" : "PM"}`;
};

/** A label and its underlined blank; the blank grows extra lines when the value runs long. */
function Line({ label, value = "", after }: { label: React.ReactNode; value?: React.ReactNode; after?: React.ReactNode }) {
  return (
    <div className="ln">
      <span>{label}</span>
      <span className="u">{value}</span>
      {after}
    </div>
  );
}

function Signature() {
  return (
    <div className="ln">
      <span>Signature:</span>
      <span className="u" />
      <span>Date:</span>
      <span className="u" />
    </div>
  );
}

const Box = () => <span className="bx" />;

function Swoosh({ className }: { className: string }) {
  return (
    <svg className={"sw " + className} viewBox="0 0 100 150" preserveAspectRatio="none" aria-hidden="true">
      <path d="M100 0 H8 C50 6 88 40 100 128 Z" fill="#3a3a42" />
      <path d="M22 2 C62 14 90 52 98 118" stroke="#fff" strokeWidth="3.2" fill="none" />
      <path d="M58 4 H100 M70 10 H100 M80 17 H100" stroke="#8a8a94" strokeWidth=".7" />
    </svg>
  );
}

const icons = {
  phone: (
    <svg viewBox="0 0 10 10" aria-hidden="true">
      <circle cx="5" cy="5" r="5" fill="#222" />
      <path d="M3 2.6c.4 2.3 2 4 4.4 4.6l.6-1-1.3-.7-.6.6C5.3 5.6 4.6 4.9 4.2 4l.6-.6L4.1 2Z" fill="#fff" />
    </svg>
  ),
  email: (
    <svg viewBox="0 0 10 10" aria-hidden="true">
      <circle cx="5" cy="5" r="5" fill="#222" />
      <rect x="2.3" y="3.2" width="5.4" height="3.6" rx=".4" fill="#fff" />
      <path d="M2.4 3.4 5 5.3l2.6-1.9" stroke="#222" strokeWidth=".5" fill="none" />
    </svg>
  ),
  pin: (
    <svg viewBox="0 0 10 10" aria-hidden="true">
      <circle cx="5" cy="5" r="5" fill="#222" />
      <path d="M5 2a2 2 0 0 1 2 2c0 1.5-2 3.8-2 3.8S3 5.5 3 4a2 2 0 0 1 2-2Z" fill="#fff" />
      <circle cx="5" cy="4" r=".7" fill="#222" />
    </svg>
  ),
};

export default function CompanyTripPaper({ data }: { data: CompanyTripPaperData }) {
  const read = data.odometerStart != null && data.odometerEnd != null;
  const na = data.noOdometer ? "N/A" : "";
  return (
    <article className="ctf" aria-label="Company Trip Form">
      <Swoosh className="tr" />
      <Swoosh className="bl" />
      <div className="lh">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src="/images/kova-print-logo.png" alt="Kayelen's Construction" />
        <i />
      </div>
      <div className="ttl">COMPANY TRIP FORM – EMPLOYEE FLEET CARD UTILIZATION</div>

      <div className="h">A. EMPLOYEE AND VEHICLE INFORMATION</div>
      <div className="g2">
        <div>
          <Line label="Date:" value={paperDate(data.date)} />
          <Line label="Employee Name:" value={data.employeeName} />
          <Line label="Position:" value={data.position} />
          <Line label="Department / Project Site:" value={data.department} />
        </div>
        <div>
          <Line
            label="Vehicle / Truck Plate No.:"
            value={data.plate ? `${data.plate}${data.vehicleName ? ` (${data.vehicleName}${data.personal ? ", personal" : ""})` : ""}` : ""}
          />
          <Line label="Driver's Name (if different):" value={data.driverName} />
          <Line label="Fleet Card No. / Last 4 Digits:" value={data.fleetCard} />
        </div>
      </div>

      <div className="h">B. TRIP DETAILS</div>
      <div>Destination / Site to Visit:</div>
      <div className="full ruled">
        {data.destinations.map((name, index) => (
          <span key={index} className="d">
            {index ? "to " : ""}
            {name}
          </span>
        ))}
      </div>
      <div>Purpose of Trip:</div>
      <div className="full ruled">{data.purpose}</div>
      <Line label="Passengers (if applicable):" value={data.passengers} />
      <div className="ln">
        <span>Time Out:</span>
        <span className="u">{clock(data.timeOut)}</span>
        <span>Time In:</span>
        <span className="u">{clock(data.timeIn)}</span>
      </div>
      <div className="ln">
        <span>Odometer – Departure:</span>
        <span className="u">{read ? data.odometerStart : na}</span>
        <span>KM</span>
        <span className="gap">Arrival:</span>
        <span className="u">{read ? data.odometerEnd : na}</span>
        <span>KM</span>
        <span className="gap b">Total Distance Travelled:</span>
        <span className="u">{read ? data.odometerEnd! - data.odometerStart! : na}</span>
        <span className="b">KM</span>
      </div>

      <div className="h">C. FLEET CARD / FUEL TRANSACTION DETAILS</div>
      <div className="g2">
        <div>
          <Line label="Fuel Station / Supplier:" />
          <Line label="Date of Fuel Purchase:" />
          <Line label="Fuel Type:" />
        </div>
        <div>
          <Line label="Quantity of Fuel (Liters):" />
          <Line label="Amount of Fuel Purchased: ₱" />
          <Line label="Odometer During Fuel Purchase:" after={<span>KM</span>} />
        </div>
      </div>
      <Line label="Official Receipt / Transaction Reference No.:" />

      <div className="h">D. EMPLOYEE CERTIFICATION</div>
      <p>
        I hereby certify that the trip and all Fleet Card transactions indicated above were made exclusively for official company business. I
        further certify that all information provided is true and correct and that supporting receipts are attached, where applicable.
      </p>
      <div className="ln">
        <span>Employee Name:</span>
        <span className="u" />
        <span>Signature:</span>
        <span className="u" />
        <span>Date:</span>
        <span className="u" />
      </div>

      <div className="h">E. SIGNATURES / APPROVALS</div>
      <div className="g2">
        <div>
          <div className="h sub">Immediate Supervisor Approval:</div>
          <Line label="Name:" />
          <Signature />
        </div>
        <div>
          <div className="h sub">Project Manager / Construction Manager / Dept. Head:</div>
          <Line label="Name:" />
          <Signature />
        </div>
      </div>

      <div className="h">F. FOR FINANCE DEPARTMENT USE ONLY</div>
      <div className="g2">
        <div>
          <Line label="Date Submitted to Finance:" />
          <Line label="Received By:" />
          <div className="ln">
            <span>Fleet Card Transaction Verified:</span>
            <span>
              <Box />
              Yes
              <Box />
              No
            </span>
          </div>
          <div className="ln">
            <span>Official Receipt Attached:</span>
            <span>
              <Box />
              Yes
              <Box />
              No
              <Box />
              N/A
            </span>
          </div>
        </div>
        <div>
          <div>Remarks / Discrepancies:</div>
          <div className="full" />
          <div className="full" />
          <Line label="Finance Personnel:" />
          <Signature />
        </div>
      </div>

      <div className="rem">
        <b>IMPORTANT REMINDERS:</b>
        <ol>
          <li>
            Fleet Cards must be used exclusively for authorized company-related expenses. Employees must submit this form together with the
            corresponding fuel receipts and supporting documents.
          </li>
          <li>
            All trip forms must be submitted to the Finance Department by the next business day following the trip. Any unauthorized Fleet Card
            transaction or personal use is strictly prohibited.
          </li>
          <li>Missing receipts or incomplete trip details must be properly explained and reported to Finance.</li>
          <li>
            Late or incomplete submissions may be subject to management review and may not be accepted for reimbursement or expense validation.
          </li>
        </ol>
      </div>

      <div className="foot">
        <span>
          {icons.phone}+63 952 480 7393 / +63 948 8366 250
        </span>
        <span>
          {icons.email}info.kayelensconstruction@gmail.com
        </span>
        <span>
          {icons.pin}Unit V-CM2 Commercial Bldg., Cayanga, San Fabian, Pangasinan
        </span>
      </div>
    </article>
  );
}
