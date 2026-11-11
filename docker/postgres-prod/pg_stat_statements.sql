-- Production only (docker-compose.prod.yml), run once when the pgdata-prod
-- volume is created. The library is preloaded by the db service's command;
-- this creates the view in the application database. Not a Prisma migration:
-- dev and test do not preload it.
CREATE EXTENSION IF NOT EXISTS pg_stat_statements;
