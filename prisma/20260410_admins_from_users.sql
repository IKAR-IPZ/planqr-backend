BEGIN;

CREATE TABLE IF NOT EXISTS public.admins (
  "id" TEXT NOT NULL,
  "username" TEXT NOT NULL,
  "adminSource" TEXT NOT NULL DEFAULT 'database',
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT admins_pkey PRIMARY KEY ("id"),
  CONSTRAINT admins_username_key UNIQUE ("username")
);

DO $$
DECLARE
  source_table REGCLASS;
  expected_admin_count INTEGER := 0;
  migrated_admin_count INTEGER := 0;
  source_admin_source_expr TEXT := '''database''';
  source_created_at_expr TEXT := 'CURRENT_TIMESTAMP';
  source_updated_at_expr TEXT := 'CURRENT_TIMESTAMP';
BEGIN
  source_table := COALESCE(
    to_regclass('public."User"'),
    to_regclass('public.users')
  );

  IF source_table IS NULL THEN
    RETURN;
  END IF;

  EXECUTE format(
    'SELECT COUNT(*) FROM %s WHERE LOWER(COALESCE("role", '''')) LIKE ''%%admin%%''',
    source_table
  )
  INTO expected_admin_count;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = source_table::TEXT
      AND column_name = 'adminSource'
  ) THEN
    source_admin_source_expr := 'COALESCE("adminSource", ''database'')';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = source_table::TEXT
      AND column_name = 'createdAt'
  ) THEN
    source_created_at_expr := 'COALESCE("createdAt", CURRENT_TIMESTAMP)';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = source_table::TEXT
      AND column_name = 'updatedAt'
  ) THEN
    source_updated_at_expr := 'COALESCE("updatedAt", "createdAt", CURRENT_TIMESTAMP)';
  ELSIF source_created_at_expr <> 'CURRENT_TIMESTAMP' THEN
    source_updated_at_expr := 'COALESCE("createdAt", CURRENT_TIMESTAMP)';
  END IF;

  EXECUTE format(
    'INSERT INTO public.admins ("id", "username", "adminSource", "createdAt", "updatedAt") ' ||
    'SELECT "id", "username", %s, %s, %s ' ||
    'FROM %s WHERE LOWER(COALESCE("role", '''')) LIKE ''%%admin%%'' ' ||
    'ON CONFLICT ("username") DO UPDATE SET ' ||
    '"adminSource" = EXCLUDED."adminSource", ' ||
    '"createdAt" = EXCLUDED."createdAt", ' ||
    '"updatedAt" = EXCLUDED."updatedAt"',
    source_admin_source_expr,
    source_created_at_expr,
    source_updated_at_expr,
    source_table
  );

  SELECT COUNT(*) INTO migrated_admin_count FROM public.admins;

  IF migrated_admin_count < expected_admin_count THEN
    RAISE EXCEPTION
      'Admin migration verification failed: expected at least %, migrated %.',
      expected_admin_count,
      migrated_admin_count;
  END IF;

  IF to_regclass('public."User"') IS NOT NULL THEN
    DROP TABLE public."User";
  END IF;

  IF to_regclass('public.users') IS NOT NULL THEN
    DROP TABLE public.users;
  END IF;
END $$;

COMMIT;
