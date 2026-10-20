import { AppError } from "@/lib/errors";
import { openproviderCredentialsSchema } from "./openprovider/credentials";
import { regwayCredentialsSchema } from "./regway/credentials";
import { dynadotCredentialsSchema } from "./dynadot/credentials";

export function parseRegistrarCredentials(provider: string, value: unknown) {
  if (provider === "openprovider") return openproviderCredentialsSchema.parse(value);
  if (provider === "regway") return regwayCredentialsSchema.parse(value);
  if (provider === "dynadot") return dynadotCredentialsSchema.parse(value);
  throw new AppError({ message: `Unknown registrar provider: ${provider}` });
}
export function credentialHint(credentials: ReturnType<typeof parseRegistrarCredentials>) {
  return "apiKey" in credentials ? credentials.apiKey.slice(-4) : credentials.username.slice(-4);
}
