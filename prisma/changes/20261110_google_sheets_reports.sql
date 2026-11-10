CREATE TABLE IF NOT EXISTS "GoogleSheetsReportSettings" (
  "id" TEXT PRIMARY KEY DEFAULT 'default',
  "spreadsheetId" TEXT NOT NULL,
  "credentialsEncrypted" TEXT,
  "serviceAccountEmail" TEXT,
  "enabled" BOOLEAN NOT NULL DEFAULT false,
  "lastAttemptAt" TIMESTAMP(3),
  "lastSuccessAt" TIMESTAMP(3),
  "lastReportWeek" TEXT,
  "lastSheetId" INTEGER,
  "lastDomainCount" INTEGER,
  "lastError" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);
