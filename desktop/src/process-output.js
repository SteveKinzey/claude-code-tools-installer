'use strict';

const { StringDecoder } = require('node:string_decoder');
const MAXIMUM_PROCESS_OUTPUT_BYTES = 256 * 1024;

// Shared stdout/stderr budget. Preserve complete UTF-8 code points across chunks
// and stop retaining data after a cap or final snapshot; still drain child pipes.
function captureProcessOutput(child, maximumBytes = MAXIMUM_PROCESS_OUTPUT_BYTES) {
  const output = { stdout: '', stderr: '' };
  const decoders = { stdout: new StringDecoder('utf8'), stderr: new StringDecoder('utf8') };
  const ended = new Set();
  let capturedBytes = 0;
  let outputTruncated = false;
  let finished = false;

  function append(stream, text) {
    if (!text || finished || outputTruncated) return;
    const bytes = Buffer.from(text, 'utf8');
    const remaining = maximumBytes - capturedBytes;
    const visible = new StringDecoder('utf8').write(bytes.subarray(0, Math.max(0, remaining)));
    output[stream] += visible;
    capturedBytes += Buffer.byteLength(visible, 'utf8');
    if (bytes.length > remaining) outputTruncated = true;
  }

  function end(stream) {
    if (ended.has(stream)) return;
    ended.add(stream);
    append(stream, decoders[stream].end());
  }

  for (const stream of ['stdout', 'stderr']) {
    child[stream].on('data', (chunk) => {
      if (finished || outputTruncated || ended.has(stream)) return;
      append(stream, decoders[stream].write(Buffer.isBuffer(chunk) ? chunk : Buffer.from(String(chunk))));
    });
    child[stream].on('end', () => end(stream));
  }

  return {
    snapshot() {
      for (const stream of ['stdout', 'stderr']) end(stream);
      finished = true;
      return { ...output, outputTruncated, capturedBytes };
    },
  };
}

module.exports = { captureProcessOutput, MAXIMUM_PROCESS_OUTPUT_BYTES };
