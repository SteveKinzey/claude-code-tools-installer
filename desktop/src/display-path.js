'use strict';

// Diagnostic reports replace the user's home folder with `~` so a shared report does not
// reveal their account name. Windows paths are case-insensitive, and the same folder can
// appear as C:\Users\Jane in one place and c:\users\jane in another (PATH entries, APPDATA,
// tool output), so on win32 every casing must be scrubbed, not just the exact one.
function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function displayPathFor(value, home, platform = process.platform) {
  const text = String(value || '');
  if (!home) return text;
  return text.replace(new RegExp(escapeRegExp(String(home)), platform === 'win32' ? 'gi' : 'g'), '~');
}

module.exports = { displayPathFor };
