-- 228-widen-book-item-id.sql
-- Widen migration_story_spec_generations.book_item_id (2026-08-30).
--
-- LIVE FAILURE this fixes. Spec generation aborted a whole persist batch with:
--   ERROR: value too long for type character varying(128)  (SQLSTATE 22001)
-- on this book_item_id, which was 129 characters -- ONE over the limit.
--
-- The id is a composite of stream + epic path + the fully-qualified symbol
-- with dots flattened to dashes. A NESTED class (Outer.Inner) in a deep
-- package can spend well over half the budget on the symbol alone, so 128
-- has no headroom for it. This is structural, not a one-off: any nested
-- class in a long package reproduces it.
--
-- Why this mattered more than a single skipped row: the batch insert is one
-- transaction, so Spring marked it rollback-only and the ENTIRE batch of 25
-- rolled back -- while the service logged "persistedCount=24
-- resultsCouldNotPersist=1". Twenty-four good rows were lost and reported as
-- persisted. Widening the column removes the trigger; the misleading
-- partial-success report is tracked separately.
--
-- 512 is chosen over TEXT to keep a bound on an id column (house style is
-- VARCHAR(n) throughout) while leaving ~4x headroom over the observed 129.
-- Widening a varchar in Postgres is a catalog-only change: no table rewrite,
-- no lock beyond a brief ACCESS EXCLUSIVE, and no data is altered.

ALTER TABLE migration_story_spec_generations
  ALTER COLUMN book_item_id TYPE VARCHAR(512);

COMMENT ON COLUMN migration_story_spec_generations.book_item_id IS
  'Book-of-work hierarchy item id from the book_of_work_json blob. Widened 128 -> 512 on 2026-08-30: the id embeds the flattened fully-qualified symbol, and a nested class in a deep package exceeded 128.';
