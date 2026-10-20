import { AppError } from "@/lib/errors";

export const CLOUDFLARE_LIMIT_MESSAGE = "Cloudflare zone limit reached. Wait at least 10 minutes before retrying. If zones are Pending Nameserver Update, activate them by setting their assigned nameservers at the registrar. Already purchased domains must only retry Cloudflare setup; do not purchase them again.";

export function isCloudflareZoneLimit(error: unknown) {
  if (!(error instanceof AppError) || error.provider !== "cloudflare") return false;
  return error.status === 429 || /limit for adding zones|please activate some zones|cloudflare zone limit reached/i.test(`${error.message} ${error.details ?? ""}`);
}

export function cloudflareZoneLimit(details?: string) {
  return new AppError({ message: CLOUDFLARE_LIMIT_MESSAGE, details, provider: "cloudflare", status: 429, retryable: true });
}
