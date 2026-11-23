-- Archived, disabled placeholder accounts preserve imported inventory when its
-- registrar is not yet known. They are never selectable for new purchases.
ALTER TYPE "RegistrarProvider" ADD VALUE IF NOT EXISTS 'unknown';
