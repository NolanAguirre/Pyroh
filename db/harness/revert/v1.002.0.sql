BEGIN;

UPDATE main.session SET status = 'idle' WHERE status = 'subagent';
DELETE FROM main.session_status WHERE name = 'subagent';

COMMIT;
