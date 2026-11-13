-- Deploy kanban:v1.001.0 to pg

BEGIN;

CREATE TABLE IF NOT EXISTS kanban.card_comment (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  card_id uuid NOT NULL REFERENCES kanban.card(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(btrim(body, E' \t\n\r')) BETWEEN 1 AND 20000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS card_comment_card_id_created_at_id_idx ON kanban.card_comment(card_id, created_at, id);

CREATE TABLE IF NOT EXISTS kanban.comment_reply (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  comment_id uuid NOT NULL REFERENCES kanban.card_comment(id) ON DELETE CASCADE,
  body text NOT NULL CHECK (length(btrim(body, E' \t\n\r')) BETWEEN 1 AND 20000),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS comment_reply_comment_id_created_at_id_idx ON kanban.comment_reply(comment_id, created_at, id);

COMMIT;
