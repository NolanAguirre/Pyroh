export const makefileConventions = {
  id: 'makefileConventions',
  label: 'Makefile conventions',
  description: 'Adds text-based Makefile help and rule maintenance conventions when make rule, make rules, or Makefile is mentioned.',
  scope: 'message',
  patterns: [/\b(?:make\s+rules?|makefiles?)\b/gi],
}
