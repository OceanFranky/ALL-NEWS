SET TIME ZONE 'UTC';
CREATE TEMP TABLE deployment_manifest (table_name text, row_count bigint, fingerprint text);
DO $$
DECLARE table_record record;
BEGIN
  FOR table_record IN SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public', 'pgboss') ORDER BY schemaname, tablename
  LOOP
    EXECUTE format('INSERT INTO deployment_manifest SELECT %L, count(*), md5(coalesce(string_agg(row_hash, chr(10) ORDER BY row_hash), %L)) FROM (SELECT md5(to_jsonb(entry)::text) row_hash FROM %I.%I entry) entries',
      table_record.schemaname || '.' || table_record.tablename, '', table_record.schemaname, table_record.tablename);
  END LOOP;
END $$;
SELECT table_name, row_count, fingerprint FROM deployment_manifest ORDER BY table_name;
