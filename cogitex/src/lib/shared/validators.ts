import { z } from "zod";

/** Shared zod validators (docs/ARCHITECTURE.md: input validation on every endpoint). */
export const signUpSchema = z.object({
  orgName: z.string().trim().min(2).max(80),
  fullName: z.string().trim().min(2).max(80),
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(8).max(200),
});

export const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1).max(200),
});

export type SignUpInput = z.infer<typeof signUpSchema>;
export type SignInInput = z.infer<typeof signInSchema>;
