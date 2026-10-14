-- Additive schema change: preserve existing columns and data.
CREATE TABLE IF NOT EXISTS "BuyerGroup" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "BuyerGroup_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BuyerGroup_name_key" ON "BuyerGroup"("name");
ALTER TABLE "Buyer" ADD COLUMN IF NOT EXISTS "groupId" TEXT;
ALTER TABLE "Domain" ADD COLUMN IF NOT EXISTS "groupId" TEXT;
ALTER TABLE "DomainPurchase" ADD COLUMN IF NOT EXISTS "groupId" TEXT;
CREATE INDEX IF NOT EXISTS "Domain_groupId_idx" ON "Domain"("groupId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Buyer_groupId_fkey') THEN
    ALTER TABLE "Buyer" ADD CONSTRAINT "Buyer_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "BuyerGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Domain_groupId_fkey') THEN
    ALTER TABLE "Domain" ADD CONSTRAINT "Domain_groupId_fkey" FOREIGN KEY ("groupId") REFERENCES "BuyerGroup"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
  END IF;
END $$;
