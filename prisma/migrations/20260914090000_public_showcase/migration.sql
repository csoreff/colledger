-- Opt-in public collection page.
--
-- `publicShowcase` defaults to false and every existing row inherits that
-- default, so this migration cannot make anyone's collection public by running.
-- Turning it on is always an explicit action taken in Settings.
--
-- `publicSlug` is nullable rather than backfilled: a null slug and a false flag
-- both mean "no public page", and generating slugs for accounts that never
-- asked for one would be handing out URLs nobody requested.

-- AlterTable
ALTER TABLE "User"
  ADD COLUMN "publicShowcase" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "publicSlug" TEXT;

-- CreateIndex
-- Postgres treats NULLs as distinct in a unique index, so every account without
-- a slug coexists happily here.
CREATE UNIQUE INDEX "User_publicSlug_key" ON "User"("publicSlug");
