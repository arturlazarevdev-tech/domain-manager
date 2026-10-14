import { z } from "zod";

export const openproviderCredentialsSchema = z.object({
  username: z.string().trim().min(1, "Openprovider username is required"),
  password: z.string().min(1, "Openprovider password is required"),
  sandbox: z.boolean().optional().default(false),
});
export type OpenproviderCredentials = z.infer<typeof openproviderCredentialsSchema>;
