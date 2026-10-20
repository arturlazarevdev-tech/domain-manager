import { z } from "zod";

export const dynadotCredentialsSchema = z.object({
  apiKey: z.string().trim().min(1, "Dynadot API key is required"),
  apiSecret: z.string().trim().min(1, "Dynadot API secret is required"),
  sandbox: z.boolean().optional().default(false),
});
export type DynadotCredentials = z.infer<typeof dynadotCredentialsSchema>;
