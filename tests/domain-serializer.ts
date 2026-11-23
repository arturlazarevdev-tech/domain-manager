import assert from "node:assert/strict";
import { serializeDomain } from "../src/lib/serializers";
const secret = { credentialsEncrypted: "sensitive-ciphertext" };
const domain = {
  id: "d", domain: "example.com", tld: "com", purchasePrice: 12, currency: "USD", registeredAt: null, expiresAt: null,
  status: "purchased", nameservers: [], errorMessage: null, createdAt: new Date(), buyer: null,
  registrar: { id: "r", name: "Unverified", provider: "unknown", ...secret },
  cloudflare: { status: "not_added", nameservers: [], zoneId: null, errorMessage: null, account: { id: "c", name: "email@example.com", accountId: "", ...secret } },
  keitaro: { status: "active", groupName: null, serverIp: null, errorMessage: null, server: { id: "k", name: "Keitaro", ...secret } },
  hestia: { status: "active", ip: null, webUser: "user", errorMessage: null, server: { id: "h", name: "Hestia", ...secret } },
};
const result = serializeDomain(domain);
assert.equal(result.cloudflare?.metadataOnly, true);
assert.equal(result.purchasedAt, null);
assert(!JSON.stringify(result).includes("sensitive-ciphertext"));
assert.equal(result.purchasePrice, 12);
console.log("PASS: display-only labels, unknown purchase dates, supplied prices, and no integration credentials in domain responses.");
