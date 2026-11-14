BEGIN;

CREATE OR REPLACE FUNCTION kanban.move_card(card_id UUID, target_column_id UUID, before_card_id UUID DEFAULT NULL)
RETURNS kanban.card LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  moving kanban.card;
  destination kanban.board_column;
  upper_position NUMERIC;
  lower_position NUMERIC;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(628193, 1);
  SELECT * INTO STRICT moving FROM kanban.card WHERE id = card_id FOR UPDATE;
  IF moving.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Restore this card before moving it';
  END IF;
  SELECT * INTO STRICT destination FROM kanban.board_column WHERE id = target_column_id FOR UPDATE;
  IF before_card_id = card_id THEN RETURN moving; END IF;
  IF before_card_id IS NOT NULL THEN
    SELECT position INTO upper_position FROM kanban.card
      WHERE id = before_card_id AND column_id = target_column_id AND archived_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'The target card is no longer in this column'; END IF;
    SELECT COALESCE(MAX(position), upper_position - 2048) INTO lower_position FROM kanban.card
      WHERE column_id = target_column_id AND id <> card_id AND archived_at IS NULL AND position < upper_position;
  ELSE
    SELECT COALESCE(MAX(position), 0) INTO lower_position FROM kanban.card
      WHERE column_id = target_column_id AND id <> card_id AND archived_at IS NULL;
    upper_position := lower_position + 2048;
  END IF;
  UPDATE kanban.card SET column_id = target_column_id, position = (lower_position + upper_position) / 2
    WHERE id = card_id RETURNING * INTO moving;
  RETURN moving;
END;
$$;

-- Preserve the existing signature used by save_card_with_parent.
CREATE OR REPLACE FUNCTION kanban.save_card_details(card_id UUID, card_title TEXT, card_description TEXT, target_column_id UUID)
RETURNS kanban.card LANGUAGE plpgsql VOLATILE STRICT AS $$
DECLARE
  saved kanban.card;
  destination kanban.board_column;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(628193, 1);
  SELECT * INTO STRICT saved FROM kanban.card WHERE id = card_id FOR UPDATE;
  IF saved.column_id <> target_column_id THEN
    IF saved.archived_at IS NULL THEN
      PERFORM kanban.move_card(card_id, target_column_id);
    ELSE
      SELECT * INTO STRICT destination FROM kanban.board_column WHERE id = target_column_id FOR UPDATE;
      UPDATE kanban.card SET column_id = target_column_id WHERE id = card_id;
    END IF;
  END IF;
  UPDATE kanban.card SET title = card_title, description = card_description
    WHERE id = card_id RETURNING * INTO saved;
  RETURN saved;
END;
$$;

COMMIT;
