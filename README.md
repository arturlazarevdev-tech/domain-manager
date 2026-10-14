# Domain Manager

Search, generate, buy, and provision domains through a registrar-agnostic backend.

## Architecture

```text
src/
  app/                         Next.js App Router UI + API
  components/                  Dashboard UI
  lib/
    integrations/
      registrars/
        factory.ts             registrarFactory.get(id)
        regway/                RegwayAdapter
        openprovider/          Openprovider REST adapter
      cloudflare/
      keitaro/
      hestia/
    domain-generator/          random / pronounceable / words / AI
    jobs/                      BullMQ + DB fallback
    services/                  purchase, provisioning, activity
```

Business logic never branches on `"regway"`. It always goes through `DomainRegistrar`.

## Stack

Next.js, React, TypeScript, Tailwind, Prisma, PostgreSQL, Zod, TanStack Query, BullMQ/Redis.

Credentials are encrypted at rest (`ENCRYPTION_KEY`) and never sent to the frontend.

## Setup

```bash
docker compose up -d
cp .env.example .env
# fill ENCRYPTION_KEY (openssl rand -hex 32) and AUTH_SECRET
npm install
npm run db:setup
npm run dev
```

In another terminal:

```bash
npm run worker
```

Default login: `ADMIN_EMAIL` / `ADMIN_PASSWORD` from `.env`.

## Purchase flow

1. Recheck availability and price
2. Check registrar balance
3. Register domain
4. Save to DB
5. Create Cloudflare zone (optional)
6. Set nameservers at registrar
7. Add to Keitaro or Hestia (optional)

A later Cloudflare/Keitaro/Hestia failure never rolls back a purchased domain. Each step is retryable.

## Buyer groups

Create or rename groups in **Buyers**, then select a group when adding or editing a buyer.
Existing purchases follow the buyer's current group membership. Moving a buyer moves
that buyer's inventory and spend into the new group's totals.

In **Buy Domains**, choose **Purchase for → Group needs** to charge a purchase directly
to a group without a buyer. **Purchased domains** supports group filters and reassignment
to either a buyer or group needs. The buyer group is independent of the Keitaro domain group.

Dashboard group totals include buyer purchases and direct group purchases once each.
Buyer totals include only their own purchases. Totals and this-month spend are shown
separately for each currency; unsuccessful registrations are excluded.

For an existing database, apply the additive schema update (preserves other columns):

```bash
npx prisma db execute --file prisma/changes/20261013_buyer_groups.sql --schema prisma/schema.prisma
npm run db:generate
```

Restart the app and any running worker after updating Prisma. Regression checks:

```bash
npx tsx tests/buyer-groups.ts
node tests/verify-groups-ui.cjs
```

The first check rolls back its fixtures. The browser check requires local Chrome and
an app running on port 3000; it removes its temporary buyer and group on completion.

## Openprovider

In **Registrars → Add**, choose **Openprovider** and enter your Openprovider username
and password. Enable API access for this contact person in Openprovider's control
panel (**Account overview → Contact persons → API**). Use **Test connection** after saving.
Credentials are encrypted in the database; bearer tokens are reused only on the server.

**Sandbox** uses a separate sandbox account. Production uses
`https://api.openprovider.eu/v1`; sandbox uses
`https://api.sandbox.openprovider.nl/v1beta`. Both environments use the same adapter.

Create a **Registrant Profile** assigned to this registrar. Use first and last name,
include the house number in Address, and fill Phone country code, Phone area code,
and Phone (subscriber number). Then select this registrar and profile in **Buy Domains**.
Buyer/group attribution and Cloudflare provisioning use the existing purchase flow.
Default nameservers are optional for Openprovider; its own DNS is used until Cloudflare
nameservers are assigned. Registrations use one year by default with auto-renew off.
Premium domains and TLDs with extra registry requirements can be rejected by Openprovider;
provider errors are shown in the purchase log. No premium-fee acceptance is sent automatically.

Existing installations need the additive contact update and regenerated Prisma client:

```bash
npx prisma db execute --file prisma/changes/20261013_openprovider_contact.sql --schema prisma/schema.prisma
npm run db:generate
```

Restart the app and worker afterward. Adapter regression checks use mocked HTTP requests:

```bash
node --import tsx tests/openprovider.ts
```

API contracts: [official specification](https://developer.openprovider.com/data/swagger.json),
[authentication and API access](https://developer.openprovider.com/get-started.html),
[sandbox](https://support.openprovider.eu/hc/en-us/articles/8095671860114-Sandbox-Testing-Environment).

## Manual domains, updates and TXT records

**Purchased domains → Add domain** records an existing domain with its original purchase
date/cost, registrar, buyer/group, Cloudflare account and server. Choose **Save existing
settings** for metadata and read-only synchronization, or **Configure Cloudflare and server**
to apply nameservers/DNS and configure the destination server. This flow never registers
or purchases a domain. A configuration error keeps the imported domain and shows the
error in its activity log so it can be corrected using **Update**.

**Update** is available in the table and domain details. It can change the buyer/group,
registrar metadata, purchase date/cost, Cloudflare account, server, domain IP and Keitaro
group. Existing Keitaro domains are updated with PUT; Hestia uses an IP change when the
web domain already exists. Changing the destination updates routing and server setup;
site files and old remote server entries require separate management.

**Add TXT** asks only for the value and creates a DNS-only record at the domain root
(`@`) in the linked Cloudflare zone. It preserves other TXT records, including records
with the same name. Subsequent IP updates preserve TXT/MX records.

Regression checks:

```bash
node --env-file=.env --import tsx tests/domain-management.ts
node tests/verify-domain-management-ui.cjs
```

The service check mocks all external APIs; the browser check never writes external DNS
or server settings. Both clean up their temporary database records.
