export const javascriptConventions = {
  id: 'javascriptConventions',
  label: 'JavaScript conventions',
  description: 'Skip JavaScript conventions when the incoming prompt contains “ blender ” with literal spaces on both sides, ignoring case. Paths such as /blender/ do not match.',
  scope: 'first',
  patterns: [/ blender /gi],
}
