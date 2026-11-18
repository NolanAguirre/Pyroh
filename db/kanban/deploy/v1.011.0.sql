BEGIN;

CREATE TABLE kanban.card_attachment (
  id UUID PRIMARY KEY DEFAULT pg_catalog.gen_random_uuid(),
  card_id UUID NOT NULL REFERENCES kanban.card(id),
  object_key public.citext NOT NULL UNIQUE CHECK (object_key ~ '^[a-f0-9]{64}$'),
  filename public.citext NOT NULL CHECK (pg_catalog.length(filename) BETWEEN 1 AND 255),
  size BIGINT NOT NULL CHECK (size BETWEEN 0 AND 1073741824),
  content_type public.citext NOT NULL DEFAULT 'application/octet-stream',
  token_hash public.citext UNIQUE,
  expires_at TIMESTAMPTZ NOT NULL,
  uploaded_at TIMESTAMPTZ,
  completed_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT pg_catalog.now()
);

CREATE INDEX card_attachment_card_id_created_at_id_idx
  ON kanban.card_attachment(card_id, created_at, id);

-- A durable queue also cleans disk files when cards are deleted through GraphQL.
CREATE TABLE kanban.attachment_garbage (
  object_key public.citext PRIMARY KEY CHECK (object_key ~ '^[a-f0-9]{64}$')
);

COMMENT ON TABLE kanban.card_attachment IS '@omit';
COMMENT ON TABLE kanban.attachment_garbage IS '@omit';

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
    EXECUTE pg_catalog.format('GRANT %s ON TABLE kanban.card_attachment, kanban.attachment_garbage TO %s%s',
      permission.privilege_type, role_name,
      CASE WHEN permission.is_grantable THEN ' WITH GRANT OPTION' ELSE '' END);
  END LOOP;
END;
$$;

CREATE FUNCTION kanban.delete_card_attachments() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM kanban.card_attachment WHERE card_id = OLD.id;
  RETURN OLD;
END;
$$;

CREATE FUNCTION kanban.queue_attachment_garbage() RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  INSERT INTO kanban.attachment_garbage(object_key) VALUES (OLD.object_key)
    ON CONFLICT (object_key) DO NOTHING;
  RETURN OLD;
END;
$$;

CREATE TRIGGER delete_card_attachments BEFORE DELETE ON kanban.card
  FOR EACH ROW EXECUTE FUNCTION kanban.delete_card_attachments();
CREATE TRIGGER queue_attachment_garbage AFTER DELETE ON kanban.card_attachment
  FOR EACH ROW EXECUTE FUNCTION kanban.queue_attachment_garbage();

COMMIT;
