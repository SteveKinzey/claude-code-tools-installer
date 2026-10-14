'use strict';

const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { captureProcessOutput, MAXIMUM_PROCESS_OUTPUT_BYTES } = require('../desktop/src/process-output');

function childFixture() {
  const child = new EventEmitter();
  child.stdout = new EventEmitter();
  child.stderr = new EventEmitter();
  child.signals = [];
  child.kill = (signal) => { child.signals.push(signal); };
  return child;
}

module.exports = async function checkProcessOutput(root) {
  let cases = 0;
  const count = () => { cases += 1; };
  let child = childFixture();
  let capture = captureProcessOutput(child, 8);
  child.stdout.emit('data', Buffer.from('abc'));
  child.stderr.emit('data', Buffer.from('de'));
  assert.deepEqual(capture.snapshot(), { stdout: 'abc', stderr: 'de', capturedBytes: 5, outputTruncated: false });
  count();

  child = childFixture();
  capture = captureProcessOutput(child, 8);
  const euro = Buffer.from('€');
  child.stdout.emit('data', euro.subarray(0, 1));
  child.stdout.emit('data', euro.subarray(1));
  child.stderr.emit('data', Buffer.from('ñ'));
  assert.deepEqual(capture.snapshot(), { stdout: '€', stderr: 'ñ', capturedBytes: 5, outputTruncated: false });
  count();

  child = childFixture();
  capture = captureProcessOutput(child, 4);
  child.stdout.emit('data', Buffer.from('ab'));
  child.stderr.emit('data', euro);
  let result = capture.snapshot();
  assert.equal(result.stdout, 'ab');
  assert.equal(result.stderr, '');
  assert.equal(result.outputTruncated, true);
  assert.equal(result.capturedBytes, 2, 'A capped partial code point is dropped, not replaced');
  count();

  child = childFixture();
  capture = captureProcessOutput(child, 4);
  child.stdout.emit('data', Buffer.from('ab'));
  child.stderr.emit('data', Buffer.from('cd'));
  assert.equal(capture.snapshot().outputTruncated, false, 'Exact shared budget is not truncation');
  count();

  child = childFixture();
  capture = captureProcessOutput(child, 4);
  child.stdout.emit('data', Buffer.from('abcde'));
  result = capture.snapshot();
  child.stdout.emit('data', Buffer.alloc(1024 * 1024, 'x'));
  child.stderr.emit('data', 'later');
  assert.deepEqual(capture.snapshot(), result, 'Later stream events cannot grow a closed capture');
  assert.equal(result.stdout, 'abcd');
  assert.equal(result.outputTruncated, true);
  count();

  const source = fs.readFileSync(path.join(root, 'desktop/src/main.js'), 'utf8');
  const begin = source.indexOf('function runProcess(command, args, options = {})');
  const end = source.indexOf('function isNewerVersion(', begin);
  assert.ok(begin >= 0 && end > begin, 'Test actual runner source, not a substitute');
  let nextChild;
  let spawnError;
  let timer;
  let cleared = 0;
  const context = {
    captureProcessOutput, MAXIMUM_PROCESS_OUTPUT_BYTES,
    spawnSafely: () => { if (spawnError) throw spawnError; return nextChild; },
    setTimeout: (fn, ms) => { timer = { fn, ms }; return timer; },
    clearTimeout: () => { cleared += 1; },
  };
  vm.createContext(context);
  vm.runInContext(`${source.slice(begin, end)}\nglobalThis.runner = runProcess;`, context);

  nextChild = childFixture();
  let pending = context.runner('inert-fixture', []);
  nextChild.stdout.emit('data', euro.subarray(0, 1));
  nextChild.stdout.emit('data', euro.subarray(1));
  nextChild.stderr.emit('data', Buffer.from('ñ'));
  nextChild.emit('close', 0);
  result = await pending;
  assert.equal(result.stdout, '€');
  assert.equal(result.stderr, 'ñ');
  assert.equal(result.code, 0);
  assert.equal(cleared, 1);
  count();

  nextChild = childFixture();
  pending = context.runner('inert-fixture', []);
  nextChild.stdout.emit('data', Buffer.alloc(MAXIMUM_PROCESS_OUTPUT_BYTES + 1, 'x'));
  nextChild.emit('close', 0);
  result = await pending;
  assert.equal(Buffer.byteLength(result.stdout), MAXIMUM_PROCESS_OUTPUT_BYTES);
  assert.equal(result.code, -1, 'Incomplete output cannot be treated as a valid success record');
  assert.equal(result.outputTruncated, true);
  assert.match(result.stderr, /truncated at 256 KiB/);
  count();

  nextChild = childFixture();
  pending = context.runner('inert-fixture', [], { timeout: 4 });
  nextChild.stdout.emit('data', 'before timeout');
  timer.fn();
  result = await pending;
  assert.equal(result.stdout, 'before timeout');
  assert.equal(result.code, -1);
  assert.equal(result.timedOut, true);
  assert.match(result.stderr, /timed out after 4ms/);
  assert.deepEqual(nextChild.signals, ['SIGKILL']);
  nextChild.emit('close', 0); // Late close cannot resettle the timeout result.
  count();

  nextChild = childFixture();
  pending = context.runner('inert-fixture', []);
  const refusal = assert.rejects(pending, /fixture child error/);
  nextChild.emit('error', new Error('fixture child error'));
  await refusal;
  nextChild.emit('close', 0);
  count();

  spawnError = new Error('fixture spawn refusal');
  await assert.rejects(context.runner('inert-fixture', []), /fixture spawn refusal/);
  count();
  console.log(`PASS ${cases} process-output groups: shared UTF-8 budget, cap boundaries, split Unicode, late data, real runner success/timeout/error/spawn refusal; no process executed.`);
};
