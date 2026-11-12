// Shared always-apply rules, delivered once per new provider conversation.
// Keep each rule editable through the normal prompt registry.
const FIRST_MESSAGE_TEMPLATES = [
  {
    id: 'workingDirectory',
    name: 'Existing working directory',
    template: 'Always work in the existing local project directory. Do not create Git worktrees unless the user explicitly requests one.',
  },
  {
    id: 'backendWatching',
    name: 'Backend watching',
    template: 'Start backend services without watching or automatic reload in both direct commands and root make start; omit Node --watch from default dev/start scripts.',
  },
  {
    id: 'sqitchMigrations',
    name: 'Sqitch migrations',
    template: 'Use Sqitch within db/<project>. Do not implement revert or verify scripts; leave them empty.',
  },
  {
    id: 'javascriptConventions',
    name: 'JavaScript conventions',
    template: 'Use arrow functions with const; no function keyword or semicolons. In .js files, use factory arrow functions instead of class for reusable objects: keep private state and methods inside the factory and return an object exposing the public API. Assign environment variables to ALL_CAPS constants after imports, for example const FOO = process.env.FOO.',
  },
  {
    id: 'codeOnly',
    name: 'Write code only',
    template: 'Make the requested changes and stop. The user builds, runs, and verifies.\nNo builds, servers, tests, linters, migrations, curl checks, or verification scripts unless the user asks in that message. Do not re-read the code in place of a lint pass.',
  },
  {
    id: 'documentationOnRequest',
    name: 'Documentation on request',
    template: 'Do not write documentation files unless explicitly requested; Makefile/CLI help and inline comments are fine.',
  },
  {
    id: 'repositoryLayout',
    name: 'Repository layout',
    template: 'Use a mono-repo layout of /<purpose>/<system-name>, for example /db/foo and /docs/foo for the same system. Use /services, /db, /ui, /scripts, and /infrastructure; scripts may exist at any level. Prefer /infrastructure/<name> for /services/<name>. Each <system-name> directory has a Makefile.',
  },
  {
    id: 'noEmojis',
    name: 'No emojis',
    template: 'Do not use emojis.',
  },
  {
    id: 'nodeRoutes',
    name: 'Node routes',
    template: 'For Node services, put one route per file under /routes.',
  },
  {
    id: 'reactConventions',
    name: 'React conventions',
    template: 'React components use a return statement. Single-tag components return on one line. Use common components and style with CSS. Use /src/pages/, /src/components/ for API data, and /src/common/.',
  },
  {
    id: 'cssConventions',
    name: 'CSS conventions',
    template: 'Use BEM naming for CSS. Reuse shared class patterns such as row, column, and card-section. Use REM for sizing.',
  },
  {
    id: 'postgresConventions',
    name: 'PostgreSQL conventions',
    template: 'For PostgreSQL: multi-column tables need a UUID id. Do not use enums; use single-column lookup tables referenced by foreign keys. Write SQL in uppercase and user-provided names in lowercase_underscore. Use PostgreSQL 14 and fully qualify schema.name. Do not add ON CASCADE DELETE unless asked. Order columns as primary key, foreign keys, other columns, then created_at, updated_at, deleted, test. Prefer citext over text unless asked otherwise.',
  },
  {
    id: 'shellConventions',
    name: 'Shell conventions',
    template: 'Write portable shell scripts without bashisms. Do not use file extensions on scripts.',
  },
].map(entry => ({
  ...entry,
  firstMessage: true,
  activation: { kind: 'First message', condition: 'First prompt of a new provider conversation; skipped on follow-ups and steers.' },
  group: 'rewrites',
  description: 'Always-apply rule prepended by the first-message rewrite.',
  usedBy: ['prompt/rewrite.js'],
  vars: [],
}))

module.exports = { FIRST_MESSAGE_TEMPLATES }
