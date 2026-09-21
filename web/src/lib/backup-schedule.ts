// Pure: when is a backup policy due? Slots are UTC; weekly = Sundays. Due = the latest slot has passed and no run started since it.
export type Schedule = { frequency: string; hour: number; lastRunAt: Date | null };

export function latestSlot(frequency: string, hour: number, now: Date): Date {
  const slot = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), hour));
  if (frequency === "weekly") slot.setUTCDate(slot.getUTCDate() - slot.getUTCDay());
  while (slot > now) slot.setUTCDate(slot.getUTCDate() - (frequency === "weekly" ? 7 : 1));
  return slot;
}

export function isBackupDue(p: Schedule, now: Date): boolean {
  const slot = latestSlot(p.frequency, p.hour, now);
  return !p.lastRunAt || p.lastRunAt < slot;
}
