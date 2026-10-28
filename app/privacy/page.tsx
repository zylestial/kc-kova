import KovaBrand from "../kova-brand";

export const metadata = { title: "KOVA — Privacy notice" };

/** Public: Google's consent screen for the backup sign-in links here, and staff can read it before signing in. */
export default function PrivacyPage() {
  return (
    <div className="sign-shell">
      <article className="sign-card privacy-card">
        <KovaBrand signIn />
        <h1>
          Privacy notice<span className="title-dot">.</span>
        </h1>
        <p>Kayelen&apos;s Construction · Last updated 28 October 2026</p>
        <p>
          KOVA is Kayelen&apos;s Construction&apos;s app for requesting, scheduling and recording trips in company
          vehicles. Only company staff with an account can use it. This notice explains what KOVA records about you,
          why, and what you can ask us to do with it.
        </p>

        <h2>In short</h2>
        <ul>
          <li>KOVA records your account details and the trips you request, schedule or drive.</li>
          <li>
            If you drive, KOVA records <b>where your phone is at the moment you tap</b> Start, End, Arrived or Leaving.
            It never tracks you in the background.
          </li>
          <li>Only people who need your information for their work can see it. Nothing is sold or used for advertising.</li>
        </ul>

        <h2>What we record</h2>
        <ul>
          <li>
            <b>Your account:</b> name, username, email address, role, position, and for drivers, the type of vehicle you
            drive.
          </li>
          <li>
            <b>Trips:</b> requests, schedules and trip records, including who asked for the trip, the stops, dates and
            times, the vehicle, and who drove.
          </li>
          <li>
            <b>Driver taps:</b> when you tap Start, End, Arrived or Leaving, KOVA saves the time and your phone&apos;s
            location at that moment. The location is turned into an approximate address. If you don&apos;t allow
            location, the tap is still saved, but without a location, and the Admin can see that none was shared.
          </li>
          <li>
            <b>Vehicle and stop details:</b> odometer readings and notes added to stops.
          </li>
          <li>
            <b>Notifications:</b> if you turn on Push notifications, a code from your browser that lets KOVA send
            notifications to that device. Turning Push off removes it.
          </li>
        </ul>

        <h2>Why we record it</h2>
        <ul>
          <li>To schedule company vehicles and drivers.</li>
          <li>To print trip forms with the actual times.</li>
          <li>To confirm drivers&apos; attendance and that trips were made as scheduled.</li>
          <li>To keep company records of vehicle use.</li>
        </ul>

        <h2>Who can see it</h2>
        <p>What you can see in KOVA depends on your role:</p>
        <ul>
          <li>
            <b>Drivers</b> see their own schedules, trips and taps.
          </li>
          <li>
            <b>Requesters</b> see their own requests.
          </li>
          <li>
            <b>Schedulers</b> and <b>Finance</b> see what they need for their work.
          </li>
          <li>
            <b>Admins</b> see everything.
          </li>
        </ul>

        <h2>Services that handle the data for us</h2>
        <ul>
          <li>
            <b>Supabase:</b> stores the database.
          </li>
          <li>
            <b>Vercel:</b> runs the app.
          </li>
          <li>
            <b>An email service:</b> sends account emails such as invites and password resets.
          </li>
          <li>
            <b>OpenStreetMap:</b> turns a tap&apos;s location into an approximate address.
          </li>
          <li>
            <b>Your browser&apos;s push service:</b> delivers notifications, if you turn them on.
          </li>
          <li>
            <b>The company&apos;s Google Drive:</b> holds encrypted nightly backups for 30 days.
          </li>
        </ul>

        <h2>How long we keep it</h2>
        <p>
          Trip and attendance records are company records. They are kept even after an account is turned off. Backups
          are deleted after 30 days.
        </p>

        <h2>Your rights</h2>
        <p>
          Under the Data Privacy Act of 2012, you can ask to see the information KOVA holds about you, ask us to correct
          it, and object to how it is used. You can also ask us to delete it. Some records must be kept as company
          records, so we&apos;ll tell you if we can&apos;t delete something and why. If you&apos;re unhappy with how we
          handle your information, you can complain to the National Privacy Commission (
          <a href="https://privacy.gov.ph">privacy.gov.ph</a>).
        </p>

        <h2>Contact</h2>
        <p>
          For questions, corrections or requests:{" "}
          <a href="mailto:kayelens.kova@gmail.com">
            <b>kayelens.kova@gmail.com</b>
          </a>
        </p>

        <p className="helper">
          <a href="/sign-in">Back to Sign In</a>
        </p>
      </article>
    </div>
  );
}
