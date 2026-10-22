\set ON_ERROR_STOP on
BEGIN;
CREATE EXTENSION IF NOT EXISTS postgres_fdw;
CREATE SERVER snapshot_import FOREIGN DATA WRAPPER postgres_fdw OPTIONS (host '/var/run/postgresql', dbname 'allnews_community_import_20261022_test');
CREATE USER MAPPING FOR CURRENT_USER SERVER snapshot_import OPTIONS (user 'postgres');
CREATE SCHEMA snapshot_import;
IMPORT FOREIGN SCHEMA public LIMIT TO (sources,articles,analyses,editorial_overrides,pool_search,stories,story_aliases,story_links,story_digests,facts,fact_articles,story_signals,story_heat_hourly,hot_rankings,publications,section_source_permissions,section_daily_revisions,settings,competition_catalogue,competition_sources,competition_materials,competition_runs,competition_revisions,competition_editions,competition_edition_revisions,competition_displays,learning_resources,learning_resource_links) FROM SERVER snapshot_import INTO snapshot_import;
DO $$
BEGIN
 IF (SELECT count(*) FROM schema_migrations) <> 195 THEN RAISE EXCEPTION 'Production migration set changed'; END IF;
 IF (SELECT count(*) FROM admission_notices) <> 102 THEN RAISE EXCEPTION 'Existing admission data changed'; END IF;
 IF (SELECT count(*) FROM admission_agent_tasks) <> 9 THEN RAISE EXCEPTION 'Existing admission tasks changed'; END IF;
 IF EXISTS (SELECT 1 FROM publications WHERE section_id='world') OR EXISTS (SELECT 1 FROM sources WHERE section_id='world') OR EXISTS (SELECT 1 FROM articles WHERE section_id='world') THEN RAISE EXCEPTION 'World records already exist; import stopped to protect newer data'; END IF;
 IF EXISTS (SELECT 1 FROM competition_displays) OR EXISTS (SELECT 1 FROM competition_catalogue) THEN RAISE EXCEPTION 'Competition records already exist; import stopped to protect newer data'; END IF;
 IF (SELECT count(*) FROM snapshot_import.publications WHERE section_id='world') <> 156 THEN RAISE EXCEPTION 'World snapshot count mismatch'; END IF;
 IF (SELECT count(*) FROM snapshot_import.competition_displays) <> 31 THEN RAISE EXCEPTION 'Competition snapshot count mismatch'; END IF;
 IF EXISTS (SELECT 1 FROM snapshot_import.sources WHERE section_id='world' AND (enabled OR site_fulltext OR syndicate_fulltext)) THEN RAISE EXCEPTION 'Snapshot has active/private world source config'; END IF;
END $$;
INSERT INTO sources SELECT * FROM snapshot_import.sources WHERE section_id='world';
INSERT INTO stories SELECT * FROM snapshot_import.stories WHERE section_id='world';
INSERT INTO articles SELECT * FROM snapshot_import.articles WHERE section_id='world';
INSERT INTO analyses SELECT * FROM snapshot_import.analyses WHERE section_id='world';
INSERT INTO facts SELECT * FROM snapshot_import.facts WHERE section_id='world';
INSERT INTO story_aliases SELECT a.* FROM snapshot_import.story_aliases a JOIN snapshot_import.stories s ON s.id=a.story_id WHERE s.section_id='world';
INSERT INTO story_links SELECT * FROM snapshot_import.story_links WHERE section_id='world';
INSERT INTO fact_articles SELECT * FROM snapshot_import.fact_articles WHERE section_id='world';
INSERT INTO story_digests SELECT d.* FROM snapshot_import.story_digests d JOIN snapshot_import.stories s ON s.id=d.story_id WHERE s.section_id='world';
INSERT INTO story_heat_hourly SELECT h.* FROM snapshot_import.story_heat_hourly h JOIN snapshot_import.stories s ON s.id=h.story_id WHERE s.section_id='world';
INSERT INTO story_signals SELECT * FROM snapshot_import.story_signals WHERE section_id='world';
INSERT INTO hot_rankings SELECT * FROM snapshot_import.hot_rankings WHERE section_id='world';
INSERT INTO publications SELECT * FROM snapshot_import.publications WHERE section_id='world';
INSERT INTO editorial_overrides SELECT o.* FROM snapshot_import.editorial_overrides o JOIN snapshot_import.articles a ON a.id=o.article_id WHERE a.section_id='world';
INSERT INTO pool_search SELECT p.* FROM snapshot_import.pool_search p JOIN snapshot_import.articles a ON a.id=p.article_id WHERE a.section_id='world';
INSERT INTO section_source_permissions SELECT * FROM snapshot_import.section_source_permissions WHERE section_id='world';
INSERT INTO section_daily_revisions SELECT * FROM snapshot_import.section_daily_revisions WHERE section_id='world';
INSERT INTO settings SELECT * FROM snapshot_import.settings WHERE key LIKE 'sections.world.%';
INSERT INTO competition_catalogue SELECT * FROM snapshot_import.competition_catalogue;
INSERT INTO competition_sources SELECT * FROM snapshot_import.competition_sources;
INSERT INTO competition_materials SELECT * FROM snapshot_import.competition_materials;
INSERT INTO competition_runs SELECT * FROM snapshot_import.competition_runs;
INSERT INTO competition_revisions SELECT * FROM snapshot_import.competition_revisions;
INSERT INTO competition_editions SELECT * FROM snapshot_import.competition_editions;
INSERT INTO competition_edition_revisions SELECT * FROM snapshot_import.competition_edition_revisions;
INSERT INTO competition_displays SELECT * FROM snapshot_import.competition_displays;
INSERT INTO learning_resources SELECT DISTINCT r.* FROM snapshot_import.learning_resources r JOIN snapshot_import.learning_resource_links l ON l.resource_id=r.id WHERE l.competition_id IS NOT NULL;
INSERT INTO learning_resource_links SELECT * FROM snapshot_import.learning_resource_links WHERE competition_id IS NOT NULL;
DO $$
DECLARE r record; seq text; max_value bigint;
BEGIN
 FOR r IN SELECT t.relname AS tablename,a.attname AS colname FROM pg_class t JOIN pg_namespace n ON n.oid=t.relnamespace JOIN pg_attribute a ON a.attrelid=t.oid AND a.attnum>0 AND NOT a.attisdropped WHERE n.nspname='public' AND t.relkind='r' AND t.relname IN ('stories','facts','story_aliases','story_digests','story_heat_hourly','hot_rankings','competition_materials','competition_runs','competition_editions','learning_resources','learning_resource_links') LOOP
  seq:=pg_get_serial_sequence(format('%I.%I','public',r.tablename),r.colname);
  IF seq IS NOT NULL THEN
   EXECUTE format('SELECT max(%I) FROM public.%I',r.colname,r.tablename) INTO max_value;
   IF max_value IS NOT NULL THEN PERFORM setval(seq,max_value,true); END IF;
  END IF;
 END LOOP;
END $$;
DO $$ BEGIN
 IF (SELECT count(*) FROM publications WHERE section_id='world') <> 156 THEN RAISE EXCEPTION 'Imported world publication count mismatch'; END IF;
 IF (SELECT count(*) FROM competition_displays) <> 31 THEN RAISE EXCEPTION 'Imported competition display count mismatch'; END IF;
 IF (SELECT count(*) FROM admission_notices) <> 102 OR (SELECT count(*) FROM admission_agent_tasks) <> 9 THEN RAISE EXCEPTION 'Existing admissions content changed'; END IF;
END $$;
DROP SCHEMA snapshot_import CASCADE;
DROP USER MAPPING FOR CURRENT_USER SERVER snapshot_import;
DROP SERVER snapshot_import;
DROP EXTENSION postgres_fdw;
COMMIT;
