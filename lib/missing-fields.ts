/**
 * Names the fields a form still needs, so a disabled button or a failed
 * save can say what to fill in instead of leaving the person to hunt.
 */

/** "Still needed: Name, Username." or "" when nothing is missing. */
export function stillNeeded(fields: string[]): string {
  return fields.length ? `Still needed: ${fields.join(", ")}.` : "";
}

/** The parts of a New or Edit request form that are not filled in yet. */
export function requestDraftMissing(draft: {
  date: string;
  projectOtherMode: boolean;
  projectOther: string;
  destinations: Array<{
    destinationId: string;
    destinationOtherMode: boolean;
    destinationOther: string;
    purposeId: string;
    purposeOtherMode: boolean;
    purposeOther: string;
  }>;
}): string[] {
  const missing: string[] = [];
  if (!draft.date) missing.push("Date");
  if (draft.projectOtherMode && !draft.projectOther.trim()) missing.push("Project / Site");
  if (!draft.destinations.length) missing.push("at least one destination");
  const many = draft.destinations.length > 1;
  draft.destinations.forEach((item, index) => {
    const stop = many ? ` ${index + 1}` : "";
    if (item.destinationOtherMode ? !item.destinationOther.trim() : !item.destinationId) missing.push(`Destination${stop}`);
    if (item.purposeOtherMode ? !item.purposeOther.trim() : !item.purposeId) missing.push(`Purpose${stop}`);
  });
  return missing;
}

export function accountMissing(account: { name: string; username: string; password?: string }, isNew: boolean): string[] {
  const missing: string[] = [];
  if (!account.name.trim()) missing.push("Name");
  if (!account.username.trim()) missing.push("Username");
  if (isNew && !account.password) missing.push("Password");
  return missing;
}

export function vehicleMissing(vehicle: { plate: string; name: string }): string[] {
  const missing: string[] = [];
  if (!vehicle.plate.trim()) missing.push("Plate");
  if (!vehicle.name.trim()) missing.push("Name");
  return missing;
}
