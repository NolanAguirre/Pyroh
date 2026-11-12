export const bootstrapServices = {
  id: 'bootstrapServices',
  label: 'Bootstrap services',
  description: 'Adds bootstrap scaffolding instructions when the prompt indicates service creation.',
  scope: 'message',
  patterns: [
    /\bnew\s+(?:[\w-]+\s+)?services?\b/gi,
    /\b(?:add|adding|create|creating|build|building|scaffold|scaffolding|generate|generating|implement|implementing|set\s+up|setting\s+up)\s+(?:(?:a|an|the|new)\s+)*(?:[\w-]+\s+)?services?\b/gi,
    /\bbootstrap\s+service\s+add\b/gi,
  ],
}
