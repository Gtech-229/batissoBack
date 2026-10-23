-- Catalogue names are listed in alphabetical order for people: case and
-- accents do not come first ("Bois", "ciment", "Ciment blanc", "Électricité").
-- The database's default collation cannot be trusted for this: the Alpine
-- image (musl) compares bytes, putting "Électricité" after "Quincaillerie".
-- ICU's root collation sorts the same way on every server.
ALTER TABLE "article_categories" ALTER COLUMN "name" TYPE VARCHAR(60) COLLATE "und-x-icu";
ALTER TABLE "articles" ALTER COLUMN "name" TYPE VARCHAR(100) COLLATE "und-x-icu";
