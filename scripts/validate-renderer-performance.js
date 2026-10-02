#!/usr/bin/env node
// Guards the renderer's performance-sensitive paths against regressions to the earlier
// quadratic or duplicated work. These are source checks; behaviour is covered by the
// Electron UI tests.
const fs = require('node:fs');
const path = require('node:path');

const renderer = fs.readFileSync(path.join(__dirname, '..', 'desktop', 'src', 'renderer', 'app.js'), 'utf8');
const failures = [];
const expect = (condition, message) => { if (!condition) failures.push(message); };

expect(!/outputElement\.textContent\s*\+=/.test(renderer), 'The activity log must append text nodes, not rebuild textContent for every chunk.');
expect(renderer.includes('outputElement.append(document.createTextNode(String(text)))'), 'appendOutput must append each chunk as a text node.');
expect(renderer.includes('requestAnimationFrame(') && renderer.includes('function cancelScheduledOutputScroll()'), 'Activity log scrolling must be batched once per frame.');
expect(renderer.includes('const sequence = ++setupScanSequence;') && renderer.includes('if (sequence !== setupScanSequence) return;'), 'scanSetup must ignore results from an older overlapping scan.');
expect(renderer.includes('setupScanInFlight.projectPath === projectPath'), 'Repeated checkup clicks for the same folder must join the scan already running.');
expect(renderer.includes('await Promise.all([loadTerminalPreference(), refreshClaudeStatus()]);'), 'Startup must load the terminal preference and Claude Code status together.');
expect(renderer.includes('const componentSearchText = new WeakMap();') && renderer.includes('componentSearchTimer = setTimeout(renderComponents, 100);'), 'Component search must reuse lowercase search text and debounce typing.');
function handlerBodies(source, opener) {
  const bodies = [];
  let index = source.indexOf(opener);
  while (index !== -1) {
    let depth = 0;
    let end = index + opener.length - 1;
    for (; end < source.length; end += 1) {
      if (source[end] === '{') depth += 1;
      else if (source[end] === '}' && --depth === 0) break;
    }
    bodies.push(source.slice(index, end + 1));
    index = source.indexOf(opener, end);
  }
  return bodies;
}
const toggleHandlers = handlerBodies(renderer, "toggle.addEventListener('click', () => {");
expect(toggleHandlers.length > 0 && toggleHandlers.every((body) => !body.includes('renderCatalog(')), 'A catalog switch must update in place instead of re-rendering every card.');

if (failures.length) {
  console.error(failures.join('\n'));
  process.exit(1);
}
console.log(JSON.stringify({ ok: true, checks: 8 }));
