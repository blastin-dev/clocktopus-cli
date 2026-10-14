import { z } from "zod";

// A timestamp in a response body, as an ISO 8601 date-time with `Z` or an
// offset. `JSON.stringify` writes a `Date` as its ISO string, so a route may
// hand over either and the CLI always reads a string.
export const TimestampSchema = z.union([
  z.iso.datetime({ offset: true }),
  z.date().transform((date) => date.toISOString()),
]);

// A calendar day, `YYYY-MM-DD`, such as a `workDate`: it carries no time and no
// timezone, so it is never a `TimestampSchema`.
export const DateOnlySchema = z.iso.date();
