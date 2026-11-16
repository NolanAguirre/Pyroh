BEGIN;

-- PostGraphile requires defaults to expose nullable inputs with pgStrictFunctions.
CREATE OR REPLACE FUNCTION kanban.move_task(
  card_id UUID,
  target_column_id UUID,
  parent_card_id UUID DEFAULT NULL,
  before_card_id UUID DEFAULT NULL
)
RETURNS kanban.card LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  moving kanban.card;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(628193, 1);
  SELECT card.* INTO STRICT moving FROM kanban.card AS card WHERE card.id = card_id FOR UPDATE;
  IF moving.epic AND moving.parent_id IS NULL THEN RAISE EXCEPTION 'Use move_card to change an epic status'; END IF;
  IF moving.archived_at IS NOT NULL THEN RAISE EXCEPTION 'Restore this card before moving it'; END IF;
  IF before_card_id IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM kanban.card AS card
    WHERE card.id = before_card_id AND card.column_id = target_column_id
      AND card.parent_id IS NOT DISTINCT FROM parent_card_id
      AND (parent_card_id IS NOT NULL OR card.epic = moving.epic) AND card.archived_at IS NULL
  ) THEN
    RAISE EXCEPTION 'The target card is outside this column, parent, or epic scope';
  END IF;
  UPDATE kanban.card SET column_id = target_column_id, parent_id = parent_card_id
    WHERE id = card_id;
  RETURN kanban.move_card(card_id, target_column_id, before_card_id);
END;
$$;

COMMIT;
