import { z } from "zod";

export const regwayCredentialsSchema = z.object({
  authUserId: z.string().min(1).transform((value) => value.trim()),
  apiKey: z.string().min(1).transform((value) => value.trim()),
  sandbox: z.boolean().optional().default(false),
  customerId: z.string().optional(),
  baseUrl: z.string().url().optional(),
});

export type RegwayCredentials = z.infer<typeof regwayCredentialsSchema>;
