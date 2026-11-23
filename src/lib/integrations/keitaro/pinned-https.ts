import { X509Certificate } from "node:crypto";
import { request } from "node:https";
import { AppError } from "@/lib/errors";

export async function pinnedKeitaroRequest(url: string, init: RequestInit, trust: { origin: string; certificate: string }) {
  const target = new URL(url);
  if (target.protocol !== "https:" || target.origin !== new URL(trust.origin).origin) {
    throw new AppError({ message: "The Keitaro certificate is bound to a different HTTPS origin. Verify its certificate before changing the server URL.", provider: "keitaro" });
  }
  const pinned = new X509Certificate(trust.certificate);
  if (init.body != null && typeof init.body !== "string") throw new AppError({ message: "Unsupported Keitaro request body", provider: "keitaro" });
  return new Promise<Response>((resolve, reject) => {
    const req = request(target, {
      method: init.method ?? "GET",
      headers: Object.fromEntries(new Headers(init.headers)),
      ca: trust.certificate,
      rejectUnauthorized: true,
      agent: false,
      signal: AbortSignal.timeout(30_000),
      // A dedicated trust anchor and exact leaf pin identify this server even
      // when its self-signed certificate predates IP subjectAltName support.
      checkServerIdentity: (_hostname, peer) => peer.fingerprint256 === pinned.fingerprint256
        ? undefined : new Error("Keitaro certificate fingerprint changed. Verify the server before updating its trusted certificate."),
    }, async response => {
      try {
        const chunks: Buffer[] = [];
        let size = 0;
        for await (const chunk of response) {
          const data = Buffer.from(chunk);
          size += data.length;
          if (size > 32 * 1024 * 1024) throw new Error("Keitaro response exceeded the size limit");
          chunks.push(data);
        }
        const status = response.statusCode ?? 502;
        // Native HTTPS does not follow redirects or forward API credentials.
        resolve(new Response([204, 205, 304].includes(status) ? null : Buffer.concat(chunks).toString("utf8"), { status }));
      } catch (error) { req.destroy(); reject(error); }
    });
    req.on("error", reject);
    req.end(init.body ?? undefined);
  });
}
