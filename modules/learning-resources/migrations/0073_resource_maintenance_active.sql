CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS resource_maintenance_active ON resource_maintenance_runs ((true)) WHERE status IN ('queued','running');
