ALTER TABLE "DeviceList"
ADD COLUMN IF NOT EXISTS "blackScreenMode" VARCHAR(16) NOT NULL DEFAULT 'follow';

DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_name = 'DeviceList'
      AND column_name = 'forceBlackScreen'
  ) THEN
    UPDATE "DeviceList"
    SET "blackScreenMode" = CASE
      WHEN "forceBlackScreen" IS TRUE THEN 'on'
      ELSE 'follow'
    END;
  END IF;
END $$;

ALTER TABLE "DeviceList"
DROP COLUMN IF EXISTS "forceBlackScreen";
