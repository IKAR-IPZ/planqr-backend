UPDATE "DeviceList"
SET "deviceURL" = SUBSTRING(
  MD5(RANDOM()::text || CLOCK_TIMESTAMP()::text || COALESCE("id"::text, '')),
  1,
  24
)
WHERE "deviceURL" IS NULL;

ALTER TABLE "DeviceList"
DROP COLUMN IF EXISTS "deviceName",
DROP COLUMN IF EXISTS "ipAddress",
DROP COLUMN IF EXISTS "deviceModel",
DROP COLUMN IF EXISTS "userAgent";
