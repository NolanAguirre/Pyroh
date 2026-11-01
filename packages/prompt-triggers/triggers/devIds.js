// "dev id", "dev ids", "devid", "devids", "dev-id", "dev_id", "devId".
const DEV_ID = String.raw`\bdev[\s_-]?ids?\b`

const VERBS = String.raw`\b(?:add|adding|added|create|creating|make|making|generate|generating|insert|inserting|put|putting|allocate|allocating|assign|assigning|give|need|needs|want|get|use|more|new|missing|fresh)\b`

// A request verb a few words before the dev id phrase ("add more dev ids to
// the sidebar"), or a need after it ("dev ids are missing on the cards").
export const devIds = {
  id: 'devIds',
  label: 'Dev ids',
  description: 'Attaches the mcpdevid MCP server and explains dev ids.',
  // The MCP list is fixed per turn, so steers cannot fire it.
  steer: false,
  patterns: [
    new RegExp(`${VERBS}[^.?!\\n]{0,60}?${DEV_ID}`, 'gi'),
    new RegExp(`${DEV_ID}[^.?!\\n]{0,30}?\\b(?:needed|missing|required|please)\\b`, 'gi'),
  ],
}
