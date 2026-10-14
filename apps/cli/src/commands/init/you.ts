import type { OnboardingState } from "@repo/cli-contract/onboarding";

import type { Checkout, InitDeps, InitOptions } from "./types.js";

// What the web's "You" step saves: `autoLockAfterDays` is always written.
const AUTO_LOCK_AFTER_DAYS = 7;
const DEFAULT_HOURS = "9-17";

// `9-17`, `8.5-17` or `08:30-17:00`, as hours of the day.
export function parseWorkingHours(value: string): [number, number] | null {
  const match = value
    .trim()
    .match(/^(\d{1,2}(?:[.:]\d{1,2})?)\s*-\s*(\d{1,2}(?:[.:]\d{1,2})?)$/);
  if (!match?.[1] || !match[2]) return null;
  const toHours = (part: string) => {
    if (part.includes(":")) {
      const [hours = "", minutes = ""] = part.split(":");
      return Number(hours) + Number(minutes) / 60;
    }
    return Number(part);
  };
  const start = toHours(match[1]);
  const end = toHours(match[2]);
  if (![start, end].every((hour) => hour >= 0 && hour <= 24)) return null;
  if (start >= end) return null;
  return [start, end];
}

export function isValidTimezone(timezone: string): boolean {
  try {
    Intl.DateTimeFormat(undefined, { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

function formatHour(hour: number): string {
  const whole = Math.floor(hour);
  const minutes = Math.round((hour - whole) * 60);
  return `${String(whole).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
}

// Confirmed preferences are left alone unless a flag changes them.
export async function runYouStep(
  deps: InitDeps,
  options: InitOptions,
  checkout: Checkout,
  onboarding: OnboardingState,
): Promise<void> {
  const flagged =
    options.timezone !== undefined ||
    options.hours !== undefined ||
    options.workingHours !== undefined;
  const current = onboarding.preferences;
  if (onboarding.preferencesConfirmed && current && !flagged) {
    const hours = current.workingHoursEnabled
      ? `${current.workDayStartTime.slice(0, 5)}–${current.workDayEndTime.slice(0, 5)}`
      : "hours vary";
    deps.log(`✓ You           ${current.timezone}, ${hours}`);
    return;
  }

  const timezone =
    options.timezone ??
    (await deps.prompt.text("Your timezone", checkout.osTimezone));
  if (!isValidTimezone(timezone)) {
    throw new Error(
      `Unknown timezone: ${timezone}. Use an IANA name such as Europe/Lisbon.`,
    );
  }

  const workingHoursEnabled =
    options.workingHours ??
    (options.hours !== undefined ||
      (await deps.prompt.confirm(
        "Do you work set hours? (No if they vary)",
        true,
      )));

  let workingHours: [number, number] | null = null;
  if (workingHoursEnabled) {
    const answer =
      options.hours ??
      (await deps.prompt.text("A usual day, start-end", DEFAULT_HOURS));
    workingHours = parseWorkingHours(answer);
    if (!workingHours) {
      throw new Error(
        `Could not read working hours "${answer}". Use start-end, such as 9-17 or 08:30-17:00.`,
      );
    }
  }

  await deps.api.put("/api/onboarding/preferences", {
    timezone,
    workingHoursEnabled,
    ...(workingHours ? { workingHours } : {}),
    preferencesConfirmed: true,
    autoLockAfterDays: AUTO_LOCK_AFTER_DAYS,
  });

  deps.log(
    `✓ You           ${timezone}, ${
      workingHours
        ? `${formatHour(workingHours[0])}–${formatHour(workingHours[1])}`
        : "hours vary"
    }`,
  );
}
