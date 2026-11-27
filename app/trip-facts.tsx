/** One labelled fact; `key` facts (the vehicle, the Driver) are shown larger. */
export type TripFact = { label: string; value: React.ReactNode; key?: boolean; note?: React.ReactNode };

/**
 * The labelled facts under a trip or request popup's title (owner's call
 * 2026-11-26: one format everywhere): a small uppercase label over each
 * value, the vehicle and Driver largest so a wrong one stands out.
 */
export default function TripFacts({ facts }: { facts: TripFact[] }) {
  return (
    <dl className="trip-facts">
      {facts.map((fact) => (
        <div key={fact.label}>
          <dt>{fact.label}</dt>
          <dd className={fact.key ? "trip-facts-key" : undefined}>{fact.value}</dd>
          {fact.note && <dd className="trip-facts-note">{fact.note}</dd>}
        </div>
      ))}
    </dl>
  );
}
