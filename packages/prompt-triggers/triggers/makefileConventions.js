export const makefileConventions = {
  id: 'makefileConventions',
  label: 'Makefile conventions',
  description: 'Adds text-based Makefile help and rule maintenance conventions when make or Makefile is mentioned.',
  scope: 'message',
  patterns: [/\b(?:make|makefiles?)\b/gi],
}
