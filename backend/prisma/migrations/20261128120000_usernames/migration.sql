-- AlterTable
ALTER TABLE "User" ADD COLUMN "username" TEXT;

-- Existing users get one from their display name: accents folded to plain letters (before lower(), which leaves
-- them alone in the C locale), anything else a dash, at most 30
-- characters, "user" when nothing is left. The first to have a name keeps it; later ones get "-2", "-3" and so on.
WITH base AS (
  SELECT
    id,
    "createdAt",
    COALESCE(
      NULLIF(
        trim(both '-._' from left(
          regexp_replace(lower(translate("displayName", 'ąĄčČęĘėĖįĮšŠųŲūŪžŽàÀáÁâÂãÃäÄåÅāĀçÇćĆèÈéÉêÊëËēĒìÌíÍîÎïÏīĪñÑńŃòÒóÓôÔõÕöÖōŌśŚùÙúÚûÛüÜūŪýÝÿŸźŹżŻğĞşŞőŐűŰřŘťŤďĎňŇľĽĺĹŕŔłŁøØđĐßæÆœŒıIİ', 'aAcCeEeEiIsSuUuUzZaAaAaAaAaAaAaAcCcCeEeEeEeEeEiIiIiIiIiInNnNoOoOoOoOoOoOsSuUuUuUuUuUyYyYzZzZgGsSoOuUrRtTdDnNlLlLrRlLoOdDsaAoOiII')), '[^a-z0-9._-]+', '-', 'g'),
          30
        )),
        ''
      ),
      'user'
    ) AS candidate
  FROM "User"
),
numbered AS (
  SELECT id, candidate, row_number() OVER (PARTITION BY candidate ORDER BY "createdAt", id) AS n FROM base
)
UPDATE "User" u
SET "username" = CASE WHEN numbered.n = 1 THEN numbered.candidate ELSE left(numbered.candidate, 24) || '-' || numbered.n END
FROM numbered
WHERE u.id = numbered.id;

-- A suffixed name can still meet one someone already had (two "alex" and an "alex-2"), and in principle so can a
-- replacement: renamed with a random ending until no two are the same, so the index below can't fail.
DO $$
BEGIN
  LOOP
    UPDATE "User" u
    SET "username" = left(u."username", 20) || '-' || substr(md5(random()::text || u.id), 1, 8)
    WHERE u.id IN (
      SELECT id FROM (
        SELECT id, row_number() OVER (PARTITION BY "username" ORDER BY "createdAt", id) AS n
        FROM "User"
        WHERE "username" IS NOT NULL
      ) duplicates
      WHERE duplicates.n > 1
    );
    EXIT WHEN NOT FOUND;
  END LOOP;
END $$;

-- CreateIndex
CREATE UNIQUE INDEX "User_username_key" ON "User"("username");
