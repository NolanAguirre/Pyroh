BEGIN;

ALTER TABLE kanban.board
  ADD COLUMN IF NOT EXISTS external_id public.citext UNIQUE;

CREATE OR REPLACE FUNCTION kanban.get_or_create_board(
  external_key public.citext,
  board_title public.citext
)
RETURNS kanban.board LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  saved kanban.board;
BEGIN
  IF external_key IS NULL OR BTRIM(external_key) = '' THEN
    RAISE EXCEPTION 'An external id is required';
  END IF;

  -- The unique key and upsert return the same board for concurrent callers.
  -- Existing titles and associations are preserved.
  INSERT INTO kanban.board AS existing (external_id, title)
    VALUES (external_key, LEFT(COALESCE(NULLIF(BTRIM(board_title), ''), 'Workspace board'), 200))
    ON CONFLICT (external_id) DO UPDATE SET external_id = existing.external_id
    RETURNING * INTO saved;

  RETURN saved;
END;
$$;

COMMIT;
