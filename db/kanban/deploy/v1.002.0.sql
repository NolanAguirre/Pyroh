-- Deploy kanban:v1.002.0 to pg
BEGIN;

CREATE TABLE IF NOT EXISTS kanban.users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL CHECK (length(btrim(name, E' \t\n\r')) BETWEEN 1 AND 100),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS users_name_key ON kanban.users (lower(name));
COMMENT ON TABLE kanban.users IS E'@name user\nA self-reported name; no authentication or access control.';

CREATE OR REPLACE FUNCTION kanban.sign_in(user_name text)
RETURNS kanban.users LANGUAGE plpgsql VOLATILE STRICT AS $$
DECLARE
  signed_in kanban.users;
BEGIN
  INSERT INTO kanban.users(name) VALUES (btrim(user_name, E' \t\n\r'))
    ON CONFLICT (lower(name)) DO UPDATE SET name = kanban.users.name
    RETURNING * INTO signed_in;
  RETURN signed_in;
END;
$$;

-- Historical content has no known creator. Require attribution on new rows.
ALTER TABLE kanban.card ADD COLUMN IF NOT EXISTS author_id uuid REFERENCES kanban.users(id);
ALTER TABLE kanban.card_comment ADD COLUMN IF NOT EXISTS author_id uuid REFERENCES kanban.users(id);
ALTER TABLE kanban.comment_reply ADD COLUMN IF NOT EXISTS author_id uuid REFERENCES kanban.users(id);
CREATE INDEX IF NOT EXISTS card_author_id_idx ON kanban.card(author_id);
CREATE INDEX IF NOT EXISTS card_comment_author_id_idx ON kanban.card_comment(author_id);
CREATE INDEX IF NOT EXISTS comment_reply_author_id_idx ON kanban.comment_reply(author_id);

CREATE OR REPLACE FUNCTION kanban.preserve_author() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.author_id IS NULL THEN RAISE EXCEPTION 'Choose a name before posting'; END IF;
  ELSIF NEW.author_id IS DISTINCT FROM OLD.author_id THEN
    RAISE EXCEPTION 'The original author cannot be changed';
  END IF;
  RETURN NEW;
END;
$$;
CREATE OR REPLACE TRIGGER preserve_author BEFORE INSERT OR UPDATE ON kanban.card
  FOR EACH ROW EXECUTE FUNCTION kanban.preserve_author();
CREATE OR REPLACE TRIGGER preserve_author BEFORE INSERT OR UPDATE ON kanban.card_comment
  FOR EACH ROW EXECUTE FUNCTION kanban.preserve_author();
CREATE OR REPLACE TRIGGER preserve_author BEFORE INSERT OR UPDATE ON kanban.comment_reply
  FOR EACH ROW EXECUTE FUNCTION kanban.preserve_author();

COMMIT;
