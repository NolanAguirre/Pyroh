BEGIN;

ALTER TABLE kanban.card
  ADD COLUMN epic BOOLEAN NOT NULL DEFAULT FALSE;

UPDATE kanban.card AS card
SET epic = TRUE
WHERE EXISTS (
  SELECT 1
  FROM kanban.card AS child
  WHERE child.parent_id = card.id
);

DROP FUNCTION kanban.save_card_with_parent(UUID, public.citext, public.citext, UUID, UUID);

CREATE FUNCTION kanban.save_card_with_parent(
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
  IF parent_card_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM kanban.card WHERE kanban.card.parent_id = card_id
  ) THEN
    RAISE EXCEPTION 'A task with children, including archived children, cannot have a parent';
  END IF;

  IF parent_card_id IS NOT NULL AND (
    parent_card_id = card_id
    OR NOT EXISTS (
      SELECT 1
      FROM kanban.card
      WHERE kanban.card.id = parent_card_id
        AND kanban.card.epic
        AND kanban.card.parent_id IS NULL
    )
  ) THEN
    RAISE EXCEPTION 'Choose an epic as the parent, or remove the parent';
  END IF;

  IF NOT card_epic AND EXISTS (
    SELECT 1 FROM kanban.card WHERE kanban.card.parent_id = card_id
  ) THEN
    RAISE EXCEPTION 'A task with children must stay an epic';
  END IF;

  saved := kanban.save_card_details(card_id, card_title::TEXT, card_description::TEXT, target_column_id);
  UPDATE kanban.card
  SET parent_id = parent_card_id,
      epic = card_epic
  WHERE kanban.card.id = saved.id
  RETURNING * INTO saved;
  RETURN saved;
END;
$$;

COMMIT;
