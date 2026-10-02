'use strict';
// The renderer ships with a Content-Security-Policy (script-src 'self') that blocks inline
// <script>. Renderer UI fixtures therefore load their test bridge from a file next to the fixture
// instead of inlining it, so they run under the same policy as the real app.
const fs = require('node:fs');
const { pathToFileURL } = require('node:url');

function externalBridgeTag(bridgeHtml, fixturePath) {
  const source = String(bridgeHtml).trim().replace(/^<script\b[^>]*>/i, '').replace(/<\/script\s*>$/i, '');
  const bridgePath = fixturePath.replace(/\.html$/, '-bridge.js');
  fs.writeFileSync(bridgePath, source, 'utf8');
  process.once('exit', () => {
    try { fs.rmSync(bridgePath, { force: true }); } catch {}
  });
  return `    <script src="${pathToFileURL(bridgePath).href}"></script>`;
}

module.exports = { externalBridgeTag };
