#!/usr/bin/env node
'use strict';

const assert = require('node:assert/strict');
const cp = require('node:child_process');
const fs = require('node:fs');
const http = require('node:http');
const https = require('node:https');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const desktop = path.resolve(__dirname, '../desktop');
const mode = process.argv[2];
const { resolveOpenSsl } = require('./resolve-test-openssl.cjs');

// A separate process per bootstrap isolates global-agent's network patches.
// Only disposable loopback servers and a generated local certificate are used.
if (!mode) {
  require('./test-openssl-discovery.cjs');
  const openssl = resolveOpenSsl();
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ccti-proxy-'));
  try {
    cp.execFileSync(openssl, [
      'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
      '-keyout', path.join(directory, 'key.pem'), '-out', path.join(directory, 'cert.pem'),
      '-days', '1', '-subj', '/CN=localhost', '-addext', 'subjectAltName=DNS:localhost,IP:127.0.0.1',
    ], { stdio: 'ignore' });
    const cases = [];
    for (const test of ['http-proxy', 'no-proxy', 'https-connect', 'runtime-switch', 'explicit-agent', 'proxy-auth']) {
      const env = { ...process.env, NODE_EXTRA_CA_CERTS: path.join(directory, 'cert.pem'), CCTI_TEST_CERT_DIR: directory };
      for (const key of Object.keys(env)) {
        if (/^(GLOBAL_AGENT_|ELECTRON_GET_USE_PROXY|HTTP_PROXY|HTTPS_PROXY|ALL_PROXY|NO_PROXY)/i.test(key)) delete env[key];
      }
      const result = cp.spawnSync(process.execPath, [__filename, test], { encoding: 'utf8', env, timeout: 20000 });
      process.stdout.write(result.stdout || '');
      assert.equal(result.status, 0, `${test}: ${result.error?.message || result.stderr}`);
      cases.push({ test, passed: true });
    }
    console.log(JSON.stringify({
      passed: true, cases,
      scope: 'Actual builder @electron/get initializeProxy: loopback HTTP/TLS CONNECT, bypass, runtime switching, explicit agent and proxy auth; TLS verification enabled.',
    }, null, 2));
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
} else {
  async function run() {
    const servers = [];
    const counts = { proxy: 0, connect: 0, second: 0 };
    let authorization;
    const listen = (server) => new Promise((resolve) => {
      servers.push(server);
      server.listen(0, '127.0.0.1', () => resolve(server.address().port));
    });
    try {
      const origin = await listen(http.createServer((_request, response) => response.end('ORIGIN')));
      function makeProxy(label) {
        const proxy = http.createServer((request, response) => {
          counts[label] += 1;
          authorization = request.headers['proxy-authorization'];
          response.end(label.toUpperCase());
        });
        proxy.on('connect', (request, socket, head) => {
          counts.connect += 1;
          const [host, port] = request.url.split(':');
          const upstream = net.connect(Number(port), host, () => {
            socket.write('HTTP/1.1 200 Connection Established\r\n\r\n');
            if (head.length) upstream.write(head);
            socket.pipe(upstream);
            upstream.pipe(socket);
          });
          upstream.on('error', () => socket.destroy());
        });
        return proxy;
      }
      const proxy = await listen(makeProxy('proxy'));
      process.env.GLOBAL_AGENT_HTTP_PROXY = `http://${mode === 'proxy-auth' ? 'fixture:fixture@' : ''}127.0.0.1:${proxy}`;
      if (mode === 'no-proxy') process.env.GLOBAL_AGENT_NO_PROXY = '127.0.0.1';
      if (mode === 'explicit-agent') process.env.GLOBAL_AGENT_FORCE_GLOBAL_AGENT = 'false';
      const loader = require(path.join(desktop, 'node_modules/app-builder-lib/node_modules/@electron/get/dist/cjs/proxy.js'));
      loader.initializeProxy();
      assert.ok(global.GLOBAL_AGENT, 'Actual downloader must initialize proxy, not swallow a module-load error');
      const get = (url, client = http, options = {}) => new Promise((resolve, reject) => {
        client.get(url, options, (response) => {
          let text = '';
          response.on('data', (chunk) => { text += chunk; });
          response.on('end', () => resolve(text));
        }).on('error', reject);
      });
      if (mode === 'https-connect') {
        const directory = process.env.CCTI_TEST_CERT_DIR;
        const tlsPort = await listen(https.createServer({
          key: fs.readFileSync(path.join(directory, 'key.pem')),
          cert: fs.readFileSync(path.join(directory, 'cert.pem')),
        }, (_request, response) => response.end('TLS-ORIGIN')));
        assert.equal(await get(`https://127.0.0.1:${tlsPort}`, https), 'TLS-ORIGIN');
        assert.equal(counts.connect, 1);
      } else if (mode === 'runtime-switch') {
        assert.equal(await get(`http://127.0.0.1:${origin}`), 'PROXY');
        const second = await listen(makeProxy('second'));
        global.GLOBAL_AGENT.HTTP_PROXY = `http://127.0.0.1:${second}`;
        assert.equal(await get(`http://127.0.0.1:${origin}`), 'SECOND');
        assert.equal(counts.second, 1);
      } else if (mode === 'no-proxy' || mode === 'explicit-agent') {
        assert.equal(await get(`http://127.0.0.1:${origin}`, http, mode === 'explicit-agent' ? { agent: new http.Agent() } : {}), 'ORIGIN');
        assert.equal(counts.proxy, 0);
      } else {
        assert.equal(await get(`http://127.0.0.1:${origin}`), 'PROXY');
        assert.equal(counts.proxy, 1);
        if (mode === 'proxy-auth') assert.equal(authorization, `Basic ${Buffer.from('fixture:fixture').toString('base64')}`);
      }
      console.log(`PASS ${mode}`);
    } finally {
      for (const server of servers) {
        server.closeAllConnections?.();
        server.close();
      }
    }
  }
  run().then(() => process.exit(0), (error) => { console.error(error); process.exit(1); });
}
