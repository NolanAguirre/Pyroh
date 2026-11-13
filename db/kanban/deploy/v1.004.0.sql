-- Keep historical deploy scripts intact so existing Sqitch deployments can continue.
BEGIN;

CREATE EXTENSION IF NOT EXISTS citext WITH SCHEMA public;

ALTER TABLE kanban.board
  ALTER COLUMN title TYPE public.citext USING title::public.citext;
ALTER TABLE kanban.board_column
  ALTER COLUMN title TYPE public.citext USING title::public.citext;
ALTER TABLE kanban.card
  ALTER COLUMN title TYPE public.citext USING title::public.citext,
  ALTER COLUMN description TYPE public.citext USING description::public.citext;
ALTER TABLE kanban.card_comment
  ALTER COLUMN body TYPE public.citext USING body::public.citext;
ALTER TABLE kanban.comment_reply
  ALTER COLUMN body TYPE public.citext USING body::public.citext;
ALTER TABLE kanban.users
  ALTER COLUMN name TYPE public.citext USING name::public.citext;

-- Keep existing function signatures, IDs, relationships, and stored text unchanged.
COMMIT;
