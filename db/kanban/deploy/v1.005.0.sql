BEGIN;

ALTER TABLE kanban.card
  ADD COLUMN parent_id UUID REFERENCES kanban.card(id) ON DELETE SET NULL;

CREATE INDEX card_parent_id_idx ON kanban.card(parent_id);

-- Keep the existing save API and save parent changes in the same transaction.
CREATE FUNCTION kanban.save_card_with_parent(
  card_id UUID,
  card_title public.citext,
  card_description public.citext,
  target_column_id UUID,
  parent_card_id UUID DEFAULT NULL
)
RETURNS kanban.card LANGUAGE plpgsql VOLATILE AS $$
DECLARE
  saved kanban.card;
BEGIN
  saved := kanban.save_card_details(card_id, card_title::TEXT, card_description::TEXT, target_column_id);
  UPDATE kanban.card SET parent_id = parent_card_id
    WHERE id = saved.id RETURNING * INTO saved;
  RETURN saved;
END;
$$;

COMMIT;
