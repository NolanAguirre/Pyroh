BEGIN;

SELECT pg_catalog.pg_advisory_xact_lock(628193, 1);
LOCK TABLE kanban.board, kanban.board_column, kanban.card IN SHARE ROW EXCLUSIVE MODE;

CREATE TABLE kanban.epic_row (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  board_id UUID NOT NULL REFERENCES kanban.board(id),
  epic_id UUID NOT NULL REFERENCES kanban.card(id),
  position NUMERIC NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now(),
  UNIQUE (board_id, epic_id)
);

CREATE INDEX epic_row_board_id_position_id_idx ON kanban.epic_row(board_id, position, id);
CREATE INDEX epic_row_epic_id_idx ON kanban.epic_row(epic_id);
CREATE INDEX card_active_scope_position_id_idx
  ON kanban.card(column_id, parent_id, epic, position, id)
  WHERE archived_at IS NULL;

COMMENT ON TABLE kanban.epic_row IS E'@omit create,update,delete\nPersistent board ordering; inactive rows are retained. Order by position, then id.';
COMMENT ON CONSTRAINT epic_row_board_id_fkey ON kanban.epic_row
  IS '@foreignFieldName epicRowsByBoardId';

-- Preserve explicit application grants as well as the deployment role's defaults.
DO $$
DECLARE
  permission RECORD;
  role_name TEXT;
BEGIN
  FOR permission IN
    SELECT acl.grantee, acl.privilege_type, acl.is_grantable
    FROM pg_catalog.pg_class AS relation
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(relation.relacl, pg_catalog.acldefault('r', relation.relowner))
    ) AS acl
    WHERE relation.oid = 'kanban.card'::pg_catalog.regclass
      AND acl.grantee <> relation.relowner
  LOOP
    role_name := CASE WHEN permission.grantee = 0 THEN 'PUBLIC'
      ELSE pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(permission.grantee)) END;
    EXECUTE pg_catalog.format('GRANT %s ON TABLE kanban.epic_row TO %s%s',
      permission.privilege_type, role_name,
      CASE WHEN permission.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
END;
$$;

-- Keep the old relative order while separating every active task scope.
WITH ranked AS (
  SELECT card.id, pg_catalog.row_number() OVER (
    PARTITION BY card.column_id, card.parent_id, (card.epic AND card.parent_id IS NULL)
    ORDER BY card.position, card.id
  ) * 1024::NUMERIC AS position
  FROM kanban.card AS card
  WHERE card.archived_at IS NULL
)
UPDATE kanban.card AS card
SET position = ranked.position
FROM ranked
WHERE card.id = ranked.id;

-- Acquire the same lock before direct writes take row locks, too.
CREATE FUNCTION kanban.lock_ordering() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(628193, 1);
  RETURN NULL;
END;
$$;

CREATE TRIGGER lock_card_ordering BEFORE INSERT OR UPDATE OR DELETE ON kanban.card
  FOR EACH STATEMENT EXECUTE FUNCTION kanban.lock_ordering();
CREATE TRIGGER lock_column_ordering BEFORE INSERT OR UPDATE OR DELETE ON kanban.board_column
  FOR EACH STATEMENT EXECUTE FUNCTION kanban.lock_ordering();
CREATE TRIGGER lock_board_ordering BEFORE INSERT OR UPDATE OR DELETE ON kanban.board
  FOR EACH STATEMENT EXECUTE FUNCTION kanban.lock_ordering();
CREATE TRIGGER lock_epic_row_ordering BEFORE INSERT OR UPDATE OR DELETE ON kanban.epic_row
  FOR EACH STATEMENT EXECUTE FUNCTION kanban.lock_ordering();

-- Scope changes and restores append; ordinary edits preserve their position.
CREATE OR REPLACE FUNCTION kanban.append_position() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  append_card BOOLEAN;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(628193, 1);
  IF TG_TABLE_NAME = 'card' THEN
    IF NEW.parent_id IS NOT NULL THEN
      IF NEW.parent_id = NEW.id OR NOT EXISTS (
        SELECT 1 FROM kanban.card AS parent
        WHERE parent.id = NEW.parent_id AND parent.epic AND parent.parent_id IS NULL
      ) THEN
        RAISE EXCEPTION 'Choose an epic as the parent, or remove the parent';
      END IF;
      IF EXISTS (SELECT 1 FROM kanban.card AS child WHERE child.parent_id = NEW.id) THEN
        RAISE EXCEPTION 'A task with children, including archived children, cannot have a parent';
      END IF;
    END IF;
    IF NOT NEW.epic AND EXISTS (
      SELECT 1 FROM kanban.card AS child WHERE child.parent_id = NEW.id
    ) THEN
      RAISE EXCEPTION 'A task with children must stay an epic';
    END IF;

    IF TG_OP = 'INSERT' THEN
      append_card := TRUE;
    ELSE
      append_card := NEW.column_id IS DISTINCT FROM OLD.column_id
        OR NEW.parent_id IS DISTINCT FROM OLD.parent_id
        OR (NEW.epic AND NEW.parent_id IS NULL) IS DISTINCT FROM (OLD.epic AND OLD.parent_id IS NULL)
        OR (OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL);
    END IF;
    IF append_card THEN
      SELECT COALESCE(pg_catalog.max(card.position), 0) + 1024 INTO NEW.position
      FROM kanban.card AS card
      WHERE card.column_id = NEW.column_id
        AND card.parent_id IS NOT DISTINCT FROM NEW.parent_id
        AND (NEW.parent_id IS NOT NULL OR card.epic = NEW.epic)
        AND card.id <> NEW.id
        AND card.archived_at IS NULL;
    END IF;
  ELSIF TG_TABLE_NAME = 'epic_row' THEN
    SELECT COALESCE(pg_catalog.max(epic_row.position), 0) + 1024 INTO NEW.position
    FROM kanban.epic_row AS epic_row WHERE epic_row.board_id = NEW.board_id;
  ELSE
    SELECT COALESCE(pg_catalog.max(board_column.position), 0) + 1024 INTO NEW.position
    FROM kanban.board_column AS board_column WHERE board_column.board_id = NEW.board_id;
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE TRIGGER append_card BEFORE INSERT OR UPDATE ON kanban.card
  FOR EACH ROW EXECUTE FUNCTION kanban.append_position();
CREATE TRIGGER append_epic_row BEFORE INSERT ON kanban.epic_row
  FOR EACH ROW EXECUTE FUNCTION kanban.append_position();

CREATE FUNCTION kanban.ensure_epic_row(target_board_id UUID, epic_card_id UUID)
RETURNS kanban.epic_row LANGUAGE plpgsql VOLATILE STRICT AS $$
DECLARE
  saved kanban.epic_row;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(628193, 1);
  SELECT epic_row.* INTO saved FROM kanban.epic_row AS epic_row
    WHERE epic_row.board_id = target_board_id AND epic_row.epic_id = epic_card_id;
  IF NOT FOUND THEN
    INSERT INTO kanban.epic_row(board_id, epic_id)
      VALUES (target_board_id, epic_card_id) RETURNING * INTO saved;
  END IF;
  RETURN saved;
END;
$$;
COMMENT ON FUNCTION kanban.ensure_epic_row(UUID, UUID) IS '@omit';

CREATE FUNCTION kanban.maintain_epic_rows() RETURNS TRIGGER LANGUAGE plpgsql AS $$
DECLARE
  local_board_id UUID;
  referenced_epic_id UUID;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(628193, 1);
  IF TG_OP = 'DELETE' THEN
    -- Explicit cleanup preserves the existing board/card deletion behavior.
    IF TG_TABLE_NAME = 'board' THEN
      DELETE FROM kanban.epic_row WHERE board_id = OLD.id;
    ELSE
      DELETE FROM kanban.epic_row WHERE epic_id = OLD.id;
    END IF;
    RETURN OLD;
  END IF;

  IF TG_TABLE_NAME = 'board_column' THEN
    IF NEW.board_id IS DISTINCT FROM OLD.board_id THEN
      FOR referenced_epic_id IN
        SELECT card.id FROM kanban.card AS card
          WHERE card.column_id = NEW.id AND card.archived_at IS NULL AND card.epic
        UNION
        SELECT card.parent_id FROM kanban.card AS card
          WHERE card.column_id = NEW.id AND card.archived_at IS NULL AND card.parent_id IS NOT NULL
      LOOP
        PERFORM kanban.ensure_epic_row(NEW.board_id, referenced_epic_id);
      END LOOP;
    END IF;
  ELSIF NEW.archived_at IS NULL THEN
    SELECT board_column.board_id INTO STRICT local_board_id
      FROM kanban.board_column AS board_column WHERE board_column.id = NEW.column_id;
    IF NEW.epic THEN
      PERFORM kanban.ensure_epic_row(local_board_id, NEW.id);
    END IF;
    IF NEW.parent_id IS NOT NULL THEN
      PERFORM kanban.ensure_epic_row(local_board_id, NEW.parent_id);
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER maintain_card_epic_rows AFTER INSERT OR UPDATE OF column_id, parent_id, epic, archived_at ON kanban.card
  FOR EACH ROW EXECUTE FUNCTION kanban.maintain_epic_rows();
CREATE TRIGGER maintain_column_epic_rows AFTER UPDATE OF board_id ON kanban.board_column
  FOR EACH ROW EXECUTE FUNCTION kanban.maintain_epic_rows();
CREATE TRIGGER delete_card_epic_rows BEFORE DELETE ON kanban.card
  FOR EACH ROW EXECUTE FUNCTION kanban.maintain_epic_rows();
CREATE TRIGGER delete_board_epic_rows BEFORE DELETE ON kanban.board
  FOR EACH ROW EXECUTE FUNCTION kanban.maintain_epic_rows();

-- Parent rows belong to each child's board, regardless of the parent's board or archive state.
WITH needed AS (
  SELECT board_column.board_id, card.id AS epic_id
  FROM kanban.card AS card
  JOIN kanban.board_column AS board_column ON board_column.id = card.column_id
  WHERE card.archived_at IS NULL AND card.epic
  UNION
  SELECT board_column.board_id, card.parent_id AS epic_id
  FROM kanban.card AS card
  JOIN kanban.board_column AS board_column ON board_column.id = card.column_id
  WHERE card.archived_at IS NULL AND card.parent_id IS NOT NULL
)
INSERT INTO kanban.epic_row(board_id, epic_id)
SELECT needed.board_id, needed.epic_id
FROM needed
JOIN kanban.card AS epic ON epic.id = needed.epic_id
ORDER BY needed.board_id, epic.created_at, epic.id;

CREATE OR REPLACE FUNCTION kanban.move_card(card_id UUID, target_column_id UUID, before_card_id UUID DEFAULT NULL)
RETURNS kanban.card LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  moving kanban.card;
  upper_position NUMERIC;
  lower_position NUMERIC;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(628193, 1);
  SELECT card.* INTO STRICT moving FROM kanban.card AS card WHERE card.id = card_id FOR UPDATE;
  IF moving.archived_at IS NOT NULL THEN
    RAISE EXCEPTION 'Restore this card before moving it';
  END IF;
  PERFORM 1 FROM kanban.board_column WHERE id = target_column_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The target column no longer exists'; END IF;

  IF before_card_id IS NOT NULL THEN
    SELECT card.position INTO upper_position FROM kanban.card AS card
      WHERE card.id = before_card_id AND card.column_id = target_column_id
        AND card.parent_id IS NOT DISTINCT FROM moving.parent_id
        AND (moving.parent_id IS NOT NULL OR card.epic = moving.epic) AND card.archived_at IS NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'The target card is outside this column, parent, or epic scope'; END IF;
    IF before_card_id = card_id THEN RETURN moving; END IF;
    SELECT COALESCE(pg_catalog.max(card.position), upper_position - 2048) INTO lower_position
      FROM kanban.card AS card
      WHERE card.column_id = target_column_id AND card.id <> card_id
        AND card.parent_id IS NOT DISTINCT FROM moving.parent_id
        AND (moving.parent_id IS NOT NULL OR card.epic = moving.epic) AND card.archived_at IS NULL
        AND card.position < upper_position;
  ELSE
    SELECT COALESCE(pg_catalog.max(card.position), 0) INTO lower_position
      FROM kanban.card AS card
      WHERE card.column_id = target_column_id AND card.id <> card_id
        AND card.parent_id IS NOT DISTINCT FROM moving.parent_id
        AND (moving.parent_id IS NOT NULL OR card.epic = moving.epic) AND card.archived_at IS NULL;
    upper_position := lower_position + 2048;
  END IF;

  -- Let the scope trigger append first, then place at the requested position.
  IF moving.column_id <> target_column_id THEN
    UPDATE kanban.card SET column_id = target_column_id WHERE id = card_id;
  END IF;
  UPDATE kanban.card SET position = (lower_position + upper_position) / 2
    WHERE id = card_id RETURNING * INTO moving;
  RETURN moving;
END;
$$;

CREATE FUNCTION kanban.move_task(
  card_id UUID,
  target_column_id UUID,
  parent_card_id UUID,
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

CREATE OR REPLACE FUNCTION kanban.save_card_with_parent(
  card_id UUID,
  card_title public.citext,
  card_description public.citext,
  target_column_id UUID,
  parent_card_id UUID DEFAULT NULL,
  card_epic BOOLEAN DEFAULT FALSE
)
RETURNS kanban.card LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  saved kanban.card;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(628193, 1);
  UPDATE kanban.card
  SET title = card_title, description = card_description, column_id = target_column_id,
      parent_id = parent_card_id, epic = card_epic
  WHERE id = card_id RETURNING * INTO STRICT saved;
  RETURN saved;
END;
$$;

CREATE OR REPLACE FUNCTION kanban.restore_card(card_id UUID)
RETURNS kanban.card LANGUAGE plpgsql VOLATILE STRICT AS $$
DECLARE
  restored kanban.card;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(628193, 1);
  SELECT card.* INTO STRICT restored FROM kanban.card AS card WHERE card.id = card_id FOR UPDATE;
  IF restored.archived_at IS NULL THEN RETURN restored; END IF;
  UPDATE kanban.card SET archived_at = NULL WHERE id = card_id RETURNING * INTO restored;
  RETURN restored;
END;
$$;

CREATE FUNCTION kanban.move_epic_row(
  target_board_id UUID,
  epic_card_id UUID,
  before_epic_id UUID DEFAULT NULL
)
RETURNS kanban.epic_row LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  moving kanban.epic_row;
  upper_position NUMERIC;
  lower_position NUMERIC;
BEGIN
  PERFORM pg_catalog.pg_advisory_xact_lock(628193, 1);
  SELECT epic_row.* INTO moving FROM kanban.epic_row AS epic_row
    WHERE epic_row.board_id = target_board_id AND epic_row.epic_id = epic_card_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'The epic has no row on this board'; END IF;
  IF before_epic_id IS NOT NULL THEN
    SELECT epic_row.position INTO upper_position FROM kanban.epic_row AS epic_row
      WHERE epic_row.board_id = target_board_id AND epic_row.epic_id = before_epic_id;
    IF NOT FOUND THEN RAISE EXCEPTION 'The target epic has no row on this board'; END IF;
    IF before_epic_id = epic_card_id THEN RETURN moving; END IF;
    SELECT COALESCE(pg_catalog.max(epic_row.position), upper_position - 2048) INTO lower_position
      FROM kanban.epic_row AS epic_row
      WHERE epic_row.board_id = target_board_id AND epic_row.id <> moving.id
        AND epic_row.position < upper_position;
  ELSE
    SELECT COALESCE(pg_catalog.max(epic_row.position), 0) INTO lower_position
      FROM kanban.epic_row AS epic_row
      WHERE epic_row.board_id = target_board_id AND epic_row.id <> moving.id;
    upper_position := lower_position + 2048;
  END IF;
  UPDATE kanban.epic_row SET position = (lower_position + upper_position) / 2
    WHERE id = moving.id RETURNING * INTO moving;
  RETURN moving;
END;
$$;

-- New entry points inherit move_card's execution grants, including restricted deployments.
DO $$
DECLARE
  routine TEXT;
  permission RECORD;
  role_name TEXT;
BEGIN
  FOREACH routine IN ARRAY ARRAY[
    'kanban.move_task(UUID, UUID, UUID, UUID)',
    'kanban.move_epic_row(UUID, UUID, UUID)',
    'kanban.ensure_epic_row(UUID, UUID)'
  ] LOOP
    FOR permission IN
      SELECT acl.grantee
      FROM pg_catalog.pg_proc AS procedure
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
      ) AS acl
      WHERE procedure.oid = routine::pg_catalog.regprocedure AND acl.grantee <> procedure.proowner
    LOOP
      role_name := CASE WHEN permission.grantee = 0 THEN 'PUBLIC'
        ELSE pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(permission.grantee)) END;
      EXECUTE pg_catalog.format('REVOKE ALL ON FUNCTION %s FROM %s', routine, role_name);
    END LOOP;
    FOR permission IN
      SELECT acl.grantee, acl.is_grantable
      FROM pg_catalog.pg_proc AS procedure
      CROSS JOIN LATERAL pg_catalog.aclexplode(
        COALESCE(procedure.proacl, pg_catalog.acldefault('f', procedure.proowner))
      ) AS acl
      WHERE procedure.oid = 'kanban.move_card(UUID, UUID, UUID)'::pg_catalog.regprocedure
        AND acl.privilege_type = 'EXECUTE'
    LOOP
      role_name := CASE WHEN permission.grantee = 0 THEN 'PUBLIC'
        ELSE pg_catalog.quote_ident(pg_catalog.pg_get_userbyid(permission.grantee)) END;
      EXECUTE pg_catalog.format('GRANT EXECUTE ON FUNCTION %s TO %s%s', routine, role_name,
        CASE WHEN permission.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
    END LOOP;
  END LOOP;
END;
$$;

COMMIT;
