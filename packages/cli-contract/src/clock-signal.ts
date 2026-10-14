import { z } from "zod";

import { DateOnlySchema, TimestampSchema } from "./timestamp";

const SignalTypeSchema = z.enum(["clock_in", "clock_out"]);

// `POST /api/clock-signal`.
export const ClockSignalResponseSchema = z.object({
  success: z.boolean(),
  signal: z.object({
    id: z.string(),
    signalType: SignalTypeSchema,
    workDate: DateOnlySchema,
    effectiveTime: z.string(),
    timezone: z.string(),
    signalTimestamp: TimestampSchema,
    alreadyExists: z.boolean(),
    blockedReason: z.enum(["already_clocked_in", "not_clocked_in"]).nullable(),
    clamped: z.boolean().optional(),
    requestedTime: z.string().nullable().optional(),
    reopened: z.boolean().optional(),
  }),
});

// `GET /api/clock-signal?date=YYYY-MM-DD`.
export const ClockSignalsListSchema = z.object({
  signals: z.array(
    z.object({
      id: z.string(),
      userId: z.string(),
      signalType: SignalTypeSchema,
      signalTimestamp: TimestampSchema,
      workDate: DateOnlySchema,
      timezone: z.string(),
      effectiveTime: z.string(),
      createdAt: TimestampSchema,
    }),
  ),
});
