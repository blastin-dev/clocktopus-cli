import { z } from "zod";

import { TimestampSchema } from "./timestamp";

// `GET /api/auth/me`.
export const UserSchema = z.object({
  user: z.object({
    id: z.string(),
    name: z.string(),
    email: z.string().email(),
    avatarUrl: z.string().nullable().optional(),
    createdAt: TimestampSchema.optional(),
    updatedAt: TimestampSchema.optional(),
  }),
});
export type UserResponse = z.infer<typeof UserSchema>;
