-- Runs only when the pgdata volume is created for the first time.
-- After editing, recreate the volume: docker compose down -v && npm run db:up
CREATE DATABASE batisso_test OWNER batisso;
