// Match Makefile, makefile, make rule, makerule, and make target requests.
const MAKEFILE = String.raw`\bmake[\s_-]?(?:files?|rules?|targets?)\b`
const VERBS = String.raw`\b(?:set[\s_-]?up|setting[\s_-]?up|add|adding|create|creating|write|writing|make|making|generate|generating|scaffold|scaffolding|implement|implementing|update|updating|edit|editing|change|changing|fix|fixing|repair|repairing|refactor|refactoring|extend|extending|remove|removing|need|want)\b`

export const makefileRules = {
  id: 'makefileRules',
  label: 'Makefile rules',
  description: 'Adds Makefile rules for explicit forwarding, root targets, and help entries.',
  scope: 'message',
  patterns: [
    new RegExp(`${VERBS}[^.?!\\n]{0,60}?${MAKEFILE}`, 'gi'),
    new RegExp(`${MAKEFILE}[^.?!\\n]{0,30}?\\b(?:set[\\s_-]?up|added|created|updated|edited|changed|fixed|needed|required|please)\\b`, 'gi'),
  ],
}
