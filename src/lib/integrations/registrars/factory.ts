import { AppError } from "@/lib/errors";
import { decryptJson } from "@/lib/crypto";
import { prisma } from "@/lib/db";
import type { DomainRegistrar } from "@/lib/integrations/types";
import { OpenProviderAdapter } from "./openprovider/adapter";
import { RegwayAdapter } from "./regway/adapter";
import { openproviderCredentialsSchema } from "./openprovider/credentials";
import { regwayCredentialsSchema } from "./regway/credentials";
import { dynadotCredentialsSchema } from "./dynadot/credentials";
import { DynadotAdapter } from "./dynadot/adapter";

export async function getRegistrar(registrarId: string): Promise<DomainRegistrar> {
  const account = await prisma.registrarAccount.findUnique({ where: { id: registrarId } });
  if (!account) {
    throw new AppError({ message: "Registrar account not found", status: 404 });
  }
  if (!account.enabled) {
    throw new AppError({ message: `${account.name} is disabled` });
  }
  return createRegistrarAdapter(account);
}

export function createRegistrarAdapter(account: {
  provider: string;
  credentialsEncrypted: string;
  defaultNameservers: string[];
  currency?: string;
}): DomainRegistrar {
  const credentials = decryptJson<Record<string, unknown>>(account.credentialsEncrypted);

  switch (account.provider) {
    case "regway":
      return new RegwayAdapter(regwayCredentialsSchema.parse(credentials), {
        defaultNameservers: account.defaultNameservers,
      });
    case "openprovider":
      return new OpenProviderAdapter(openproviderCredentialsSchema.parse(credentials), { defaultNameservers: account.defaultNameservers });
    case "dynadot":
      return new DynadotAdapter(dynadotCredentialsSchema.parse(credentials), { defaultNameservers: account.defaultNameservers, currency: account.currency });
    default:
      throw new AppError({ message: `Unknown registrar provider: ${account.provider}` });
  }
}
