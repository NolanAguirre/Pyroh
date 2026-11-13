-- Deploy kanban:v1.003.0 to pg
BEGIN;

-- Archived cards keep their row but leave column ordering; restoring appends them to the end.
ALTER TABLE kanban.card ADD COLUMN IF NOT EXISTS archived_at timestamptz;
CREATE INDEX IF NOT EXISTS card_active_column_id_position_id_idx ON kanban.card(column_id, position, id) WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION kanban.append_position() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(628193, 1);
  IF TG_TABLE_NAME = 'card' THEN
    SELECT coalesce(max(position), 0) + 1024 INTO NEW.position FROM kanban.card
      WHERE column_id = NEW.column_id AND archived_at IS NULL;
  ELSE
    SELECT coalesce(max(position), 0) + 1024 INTO NEW.position FROM kanban.board_column WHERE board_id = NEW.board_id;
  END IF;
  RETURN NEW;
END;
$$;

-- Only active cards take part in ordering. NULL before-id means append to the end.
CREATE OR REPLACE FUNCTION kanban.move_card(card_id uuid, target_column_id uuid, before_card_id uuid DEFAULT NULL)
RETURNS kanban.card LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  moving kanban.card;
  destination kanban.board_column;
  upper_position numeric;
  lower_position numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(628193, 1);
  SELECT * INTO STRICT moving FROM kanban.card WHERE id = card_id FOR UPDATE;
  IF moving.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Restore this card before moving it';
  END IF;
  SELECT * INTO STRICT destination FROM kanban.board_column WHERE id = target_column_id FOR UPDATE;
  IF destination.board_id <> (SELECT board_id FROM kanban.board_column WHERE id = moving.column_id) THEN
    RAISE EXCEPTION 'Cards must stay on the same board';
  END IF;
  IF before_card_id = card_id THEN RETURN moving; END IF;
  IF before_card_id IS NOT NULL THEN
    SELECT position INTO upper_position FROM kanban.card
      WHERE id = before_card_id AND column_id = target_column_id AND archived_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'The target card is no longer in this column'; END IF;
    SELECT coalesce(max(position), upper_position - 2048) INTO lower_position FROM kanban.card
      WHERE column_id = target_column_id AND id <> card_id AND archived_at IS NULL AND position < upper_position;
  ELSE
    SELECT coalesce(max(position), 0) INTO lower_position FROM kanban.card
      WHERE column_id = target_column_id AND id <> card_id AND archived_at IS NULL;
    upper_position := lower_position + 2048;
  END IF;
  UPDATE kanban.card SET column_id = target_column_id, position = (lower_position + upper_position) / 2
    WHERE id = card_id RETURNING * INTO moving;
  RETURN moving;
END;
$$;

-- Archived cards can change column without a position; restoring places them.
CREATE OR REPLACE FUNCTION kanban.save_card_details(card_id uuid, card_title text, card_description text, target_column_id uuid)
RETURNS kanban.card LANGUAGE plpgsql VOLATILE STRICT AS $$
DECLARE
  saved kanban.card;
BEGIN
  PERFORM pg_advisory_xact_lock(628193, 1);
  SELECT * INTO STRICT saved FROM kanban.card WHERE id = card_id FOR UPDATE;
  IF saved.column_id <> target_column_id THEN
    IF saved.archived_at IS NULL THEN
      PERFORM kanban.move_card(card_id, target_column_id);
    ELSIF (SELECT board_id FROM kanban.board_column WHERE id = target_column_id)
      IS DISTINCT FROM (SELECT board_id FROM kanban.board_column WHERE id = saved.column_id) THEN
      RAISE EXCEPTION 'Cards must stay on the same board';
    ELSE
      UPDATE kanban.card SET column_id = target_column_id WHERE id = card_id;
    END IF;
  END IF;
  UPDATE kanban.card SET title = card_title, description = card_description
    WHERE id = card_id RETURNING * INTO saved;
  RETURN saved;
END;
$$;

CREATE OR REPLACE FUNCTION kanban.archive_card(card_id uuid)
RETURNS kanban.card LANGUAGE plpgsql VOLATILE STRICT AS $$
DECLARE
  archived kanban.card;
BEGIN
  PERFORM pg_advisory_xact_lock(628193, 1);
  UPDATE kanban.card SET archived_at = coalesce(archived_at, now())
    WHERE id = card_id RETURNING * INTO STRICT archived;
  RETURN archived;
END;
$$;

CREATE OR REPLACE FUNCTION kanban.restore_card(card_id uuid)
RETURNS kanban.card LANGUAGE plpgsql VOLATILE STRICT AS $$
DECLARE
  restored kanban.card;
BEGIN
  PERFORM pg_advisory_xact_lock(628193, 1);
  SELECT * INTO STRICT restored FROM kanban.card WHERE id = card_id FOR UPDATE;
  IF restored.archived_at IS NULL THEN RETURN restored; END IF;
  UPDATE kanban.card SET archived_at = NULL, position = (
      SELECT coalesce(max(position), 0) + 1024 FROM kanban.card
        WHERE column_id = restored.column_id AND archived_at IS NULL)
    WHERE id = card_id RETURNING * INTO restored;
  RETURN restored;
END;
$$;


COMMIT;
