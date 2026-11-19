const DEFAULT_FILE = 'notepad.txt'

// Keep note files inside WRITE_DIR and leave unrelated files alone.
const isNoteFile = (name) => typeof name === 'string' && /^[a-zA-Z0-9][a-zA-Z0-9 _.-]{0,119}\.txt$/.test(name)

module.exports = { DEFAULT_FILE, isNoteFile }
