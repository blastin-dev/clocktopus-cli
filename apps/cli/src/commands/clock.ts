import {
  ClockSignalResponseSchema,
  ClockSignalsListSchema,
} from "@repo/cli-contract/clock-signal";
import { parseDurationToMinutes } from "@repo/cli-contract/duration";
import { format } from "date-fns";

import { ApiError, get, post } from "../lib/api.js";
import { isLoggedIn } from "../lib/config.js";

function checkAuth(): boolean {
  if (!isLoggedIn()) {
    console.error(
      "You are not logged in. Use 'clocktopus login' to authenticate first.",
    );
    return false;
  }
  return true;
}

function formatSignalType(type: "clock_in" | "clock_out"): string {
  return type === "clock_in" ? "Clock In" : "Clock Out";
}

export async function clockInCommand(
  options: { ago?: string; at?: string } = {},
): Promise<void> {
  if (!checkAuth()) {
    process.exit(1);
  }

  if (options.ago && options.at) {
    console.error("Cannot use --ago and --at together. Pick one.");
    process.exit(1);
  }

  const body: Record<string, unknown> = { signalType: "clock_in" };

  if (options.ago) {
    try {
      body.minutesAgo = parseDurationToMinutes(options.ago);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  if (options.at) {
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(options.at)) {
      console.error(
        `Invalid time "${options.at}". Use HH:mm or HH:mm:ss format.`,
      );
      process.exit(1);
    }
    body.effectiveTime = options.at;
  }

  try {
    const data = await post("/api/clock-signal", body);
    const response = ClockSignalResponseSchema.parse(data);

    if (response.signal.alreadyExists) {
      console.log(`\nAlready clocked in - must clock out first.`);
      console.log(`  Current clock-in:`);
      console.log(`    Date: ${response.signal.workDate}`);
      console.log(`    Time: ${response.signal.effectiveTime}`);
      console.log(`    Timezone: ${response.signal.timezone}`);
    } else if (response.signal.reopened) {
      console.log(`\nPrevious session reopened — clock-out removed.`);
      console.log(`  Clocked in since:`);
      console.log(`    Date: ${response.signal.workDate}`);
      console.log(`    Time: ${response.signal.effectiveTime}`);
      console.log(`    Timezone: ${response.signal.timezone}`);
    } else {
      console.log(`\nClock In recorded!`);
      console.log(`  Date: ${response.signal.workDate}`);
      console.log(`  Time: ${response.signal.effectiveTime}`);
      console.log(`  Timezone: ${response.signal.timezone}`);
      if (response.signal.clamped && response.signal.requestedTime) {
        console.log(
          `  Adjusted: you asked for ${response.signal.requestedTime}, but that's outside the allowed window for this day.`,
        );
      }
    }
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        console.error(
          "Session expired. Use 'clocktopus login' to authenticate again.",
        );
      } else {
        console.error(`Failed to record clock-in: ${error.message}`);
      }
    } else {
      console.error(
        `Failed to record clock-in: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
    process.exit(1);
  }
}

export async function clockOutCommand(
  options: { ago?: string; at?: string } = {},
): Promise<void> {
  if (!checkAuth()) {
    process.exit(1);
  }

  if (options.ago && options.at) {
    console.error("Cannot use --ago and --at together. Pick one.");
    process.exit(1);
  }

  const body: Record<string, unknown> = { signalType: "clock_out" };

  if (options.ago) {
    try {
      body.minutesAgo = parseDurationToMinutes(options.ago);
    } catch (err) {
      console.error(err instanceof Error ? err.message : String(err));
      process.exit(1);
    }
  }

  if (options.at) {
    if (!/^\d{2}:\d{2}(:\d{2})?$/.test(options.at)) {
      console.error(
        `Invalid time "${options.at}". Use HH:mm or HH:mm:ss format.`,
      );
      process.exit(1);
    }
    body.effectiveTime = options.at;
  }

  try {
    const data = await post("/api/clock-signal", body);
    const response = ClockSignalResponseSchema.parse(data);

    if (response.signal.alreadyExists) {
      console.log(`\nNot clocked in - must clock in first.`);
      if (response.signal.id) {
        console.log(`  Last signal:`);
        console.log(`    Date: ${response.signal.workDate}`);
        console.log(`    Time: ${response.signal.effectiveTime}`);
        console.log(`    Timezone: ${response.signal.timezone}`);
      }
    } else {
      console.log(`\nClock Out recorded!`);
      console.log(`  Date: ${response.signal.workDate}`);
      console.log(`  Time: ${response.signal.effectiveTime}`);
      console.log(`  Timezone: ${response.signal.timezone}`);
      if (response.signal.clamped && response.signal.requestedTime) {
        console.log(
          `  Adjusted: you asked for ${response.signal.requestedTime}, but that's before this session's earliest allowed time.`,
        );
      }
    }
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        console.error(
          "Session expired. Use 'clocktopus login' to authenticate again.",
        );
      } else {
        console.error(`Failed to record clock-out: ${error.message}`);
      }
    } else {
      console.error(
        `Failed to record clock-out: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
    process.exit(1);
  }
}

export async function clockStatusCommand(options: {
  date?: string;
}): Promise<void> {
  if (!checkAuth()) {
    process.exit(1);
  }

  const date = options.date ?? format(new Date(), "yyyy-MM-dd");

  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    console.error("Invalid date format. Use YYYY-MM-DD.");
    process.exit(1);
  }

  try {
    const data = await get(`/api/clock-signal?date=${date}`);
    const response = ClockSignalsListSchema.parse(data);

    console.log(`\nClock signals for ${date}:`);

    if (response.signals.length === 0) {
      console.log("  No clock signals recorded for this date.");
      console.log("  (Default work hours from your preferences will be used)");
    } else {
      for (let i = 0; i < response.signals.length; i++) {
        const signal = response.signals[i];
        if (!signal) continue;
        console.log(
          `  ${i + 1}. ${formatSignalType(signal.signalType)} at ${signal.effectiveTime} (${signal.timezone})`,
        );
      }
    }
  } catch (error) {
    if (error instanceof ApiError) {
      if (error.status === 401) {
        console.error(
          "Session expired. Use 'clocktopus login' to authenticate again.",
        );
      } else {
        console.error(`Failed to fetch clock status: ${error.message}`);
      }
    } else {
      console.error(
        `Failed to fetch clock status: ${error instanceof Error ? error.message : "Unknown error"}`,
      );
    }
    process.exit(1);
  }
}
