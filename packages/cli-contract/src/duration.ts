// "15m", "2h" or "1h30m", case-insensitive. Zero is rejected, so a caller's
// "no backdate" stays a separate case.
export function parseDurationToMinutes(input: string): number {
  const trimmed = input.trim().toLowerCase();
  const match = /^(?:(\d+)h)?(?:(\d+)m)?$/.exec(trimmed);
  if (!match || (!match[1] && !match[2])) {
    throw new Error(
      `Invalid duration "${input}". Use formats like 15m, 1h, or 1h30m.`,
    );
  }
  const hours = match[1] ? Number(match[1]) : 0;
  const minutes = match[2] ? Number(match[2]) : 0;
  const total = hours * 60 + minutes;
  if (total <= 0) {
    throw new Error(`Duration must be greater than zero: "${input}".`);
  }
  return total;
}
