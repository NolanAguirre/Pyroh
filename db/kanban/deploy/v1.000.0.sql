-- Deploy kanban:v1.000.0 to pg

BEGIN;

CREATE SCHEMA IF NOT EXISTS kanban;

CREATE TABLE IF NOT EXISTS kanban.board (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS kanban.board_column (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  board_id uuid NOT NULL REFERENCES kanban.board(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  position numeric NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS board_column_board_id_position_id_idx ON kanban.board_column(board_id, position, id);

CREATE TABLE IF NOT EXISTS kanban.card (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  column_id uuid NOT NULL REFERENCES kanban.board_column(id) ON DELETE CASCADE,
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 200),
  description text NOT NULL DEFAULT '' CHECK (length(description) <= 20000),
  position numeric NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS card_column_id_position_id_idx ON kanban.card(column_id, position, id);

CREATE OR REPLACE FUNCTION kanban.append_position() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(628193, 1);
  IF TG_TABLE_NAME = 'card' THEN
    SELECT coalesce(max(position), 0) + 1024 INTO NEW.position FROM kanban.card WHERE column_id = NEW.column_id;
  ELSE
    SELECT coalesce(max(position), 0) + 1024 INTO NEW.position FROM kanban.board_column WHERE board_id = NEW.board_id;
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER append_card BEFORE INSERT ON kanban.card FOR EACH ROW EXECUTE FUNCTION kanban.append_position();
CREATE OR REPLACE TRIGGER append_column BEFORE INSERT ON kanban.board_column FOR EACH ROW EXECUTE FUNCTION kanban.append_position();

CREATE OR REPLACE FUNCTION kanban.default_columns() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO kanban.board_column(board_id, title) VALUES (NEW.id, 'To do'), (NEW.id, 'In progress'), (NEW.id, 'Done');
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER default_columns AFTER INSERT ON kanban.board FOR EACH ROW EXECUTE FUNCTION kanban.default_columns();

-- One transaction performs each move. NULL before-id means append to the end.
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
  SELECT * INTO STRICT destination FROM kanban.board_column WHERE id = target_column_id FOR UPDATE;
  IF destination.board_id <> (SELECT board_id FROM kanban.board_column WHERE id = moving.column_id) THEN
    RAISE EXCEPTION 'Cards must stay on the same board';
  END IF;
  IF before_card_id = card_id THEN RETURN moving; END IF;
  IF before_card_id IS NOT NULL THEN
    SELECT position INTO STRICT upper_position FROM kanban.card WHERE id = before_card_id AND column_id = target_column_id;
    SELECT coalesce(max(position), upper_position - 2048) INTO lower_position
      FROM kanban.card WHERE column_id = target_column_id AND id <> card_id AND position < upper_position;
  ELSE
    SELECT coalesce(max(position), 0) INTO lower_position FROM kanban.card WHERE column_id = target_column_id AND id <> card_id;
    upper_position := lower_position + 2048;
  END IF;
  UPDATE kanban.card SET column_id = target_column_id, position = (lower_position + upper_position) / 2
    WHERE id = card_id RETURNING * INTO moving;
  RETURN moving;
END;
$$;

CREATE OR REPLACE FUNCTION kanban.move_column(column_id uuid, before_column_id uuid DEFAULT NULL)
RETURNS kanban.board_column LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  moving kanban.board_column;
  upper_position numeric;
  lower_position numeric;
BEGIN
  PERFORM pg_advisory_xact_lock(628193, 1);
  SELECT * INTO STRICT moving FROM kanban.board_column WHERE id = column_id FOR UPDATE;
  IF before_column_id = column_id THEN RETURN moving; END IF;
  IF before_column_id IS NOT NULL THEN
    SELECT position INTO STRICT upper_position FROM kanban.board_column WHERE id = before_column_id AND board_id = moving.board_id;
    SELECT coalesce(max(position), upper_position - 2048) INTO lower_position FROM kanban.board_column
      WHERE board_id = moving.board_id AND id <> column_id AND position < upper_position;
  ELSE
    SELECT coalesce(max(position), 0) INTO lower_position FROM kanban.board_column WHERE board_id = moving.board_id AND id <> column_id;
    upper_position := lower_position + 2048;
  END IF;
  UPDATE kanban.board_column SET position = (lower_position + upper_position) / 2 WHERE id = column_id RETURNING * INTO moving;
  RETURN moving;
END;
$$;

-- Save text and an optional column change together, or roll back both.
CREATE OR REPLACE FUNCTION kanban.save_card_details(card_id uuid, card_title text, card_description text, target_column_id uuid)
RETURNS kanban.card LANGUAGE plpgsql VOLATILE STRICT AS $$
DECLARE
  saved kanban.card;
BEGIN
  PERFORM pg_advisory_xact_lock(628193, 1);
  SELECT * INTO STRICT saved FROM kanban.card WHERE id = card_id FOR UPDATE;
  IF saved.column_id <> target_column_id THEN
    PERFORM kanban.move_card(card_id, target_column_id);
  END IF;
  UPDATE kanban.card SET title = card_title, description = card_description
    WHERE id = card_id RETURNING * INTO saved;
  RETURN saved;
END;
$$;

COMMIT;
