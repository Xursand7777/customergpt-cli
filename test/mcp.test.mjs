import {test} from 'node:test';
import assert from 'node:assert/strict';
import {PassThrough} from 'node:stream';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {serveStdio, PROTOCOL_VERSIONS} from '../lib/mcp.mjs';

const bin = fileURLToPath(new URL('../bin/customergpt.mjs', import.meta.url));

async function exchange(messages, handlers = {}) {
  const input = new PassThrough(), output = new PassThrough();
  let text = '';
  output.on('data', chunk => { text += chunk; });
  const done = serveStdio({name: 'test', version: '1.0.0', instructions: 'Be careful.', listTools: async () => [{name: 'jobs_get', inputSchema: {type: 'object'}}], callTool: async (name, args) => ({content: [{type: 'text', text: name + JSON.stringify(args)}]}), ...handlers}, input, output);
  for (const message of messages) input.write((typeof message === 'string' ? message : JSON.stringify(message)) + '\n');
  input.end();
  await done;
  return text.trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
}

test('initialize negotiates the protocol version and advertises tools', async () => {
  const [known, unknown] = await exchange([
    {jsonrpc: '2.0', id: 1, method: 'initialize', params: {protocolVersion: '2025-06-18', capabilities: {}, clientInfo: {name: 'c', version: '1'}}},
    {jsonrpc: '2.0', id: 2, method: 'initialize', params: {protocolVersion: '1999-01-01'}},
  ]);
  assert.equal(known.result.protocolVersion, '2025-06-18');
  assert.deepEqual(known.result.capabilities, {tools: {listChanged: false}});
  assert.deepEqual(known.result.serverInfo, {name: 'test', version: '1.0.0'});
  assert.equal(known.result.instructions, 'Be careful.');
  assert.equal(unknown.result.protocolVersion, PROTOCOL_VERSIONS[0]);
});

test('lists and calls tools; ignores notifications; reports JSON-RPC errors', async () => {
  const replies = await exchange([
    {jsonrpc: '2.0', method: 'notifications/initialized'},
    {jsonrpc: '2.0', id: 'a', method: 'tools/list'},
    {jsonrpc: '2.0', id: 'b', method: 'tools/call', params: {name: 'jobs_get', arguments: {jobId: 'j'}}},
    {jsonrpc: '2.0', id: 'c', method: 'ping'},
    {jsonrpc: '2.0', id: 'd', method: 'resources/list'},
    'not json',
    {jsonrpc: '2.0', id: 'e', method: 'tools/call', params: {}},
  ]);
  const byId = Object.fromEntries(replies.map(r => [r.id, r]));
  assert.equal(replies.length, 6);
  assert.equal(byId.a.result.tools[0].name, 'jobs_get');
  assert.equal(byId.b.result.content[0].text, 'jobs_get{"jobId":"j"}');
  assert.deepEqual(byId.c.result, {});
  assert.equal(byId.d.error.code, -32601);
  assert.equal(byId.null.error.code, -32700);
  assert.equal(byId.e.error.code, -32602);
});

test('a slow tool call does not block other requests', async () => {
  let release;
  const replies = await exchange([
    {jsonrpc: '2.0', id: 1, method: 'tools/call', params: {name: 'slow'}},
    {jsonrpc: '2.0', id: 2, method: 'ping'},
  ], {callTool: () => new Promise(resolve => { release = () => resolve({content: []}); setTimeout(release, 50); })});
  assert.deepEqual(replies.map(r => r.id), [2, 1]);
});

test('CLI requests identify the client and dashboard prints its URL', async () => {
  const seen = [];
  const server = createServer((req, res) => {
    seen.push(req.headers['x-customergpt-client']);
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ok: true, data: {}}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const run = (args, env = {}) => new Promise((resolve, reject) => execFile(process.execPath, [bin, ...args], {env: {...process.env, CUSTOMERGPT_API_URL: 'http://127.0.0.1:' + server.address().port, CUSTOMERGPT_API_KEY: 'k', ...env}}, (error, stdout) => error ? reject(error) : resolve(stdout)));
  try {
    await run(['usage']);
    assert.match(seen[0], /^cli\/\d+\.\d+\.\d+/);
    assert.deepEqual(JSON.parse(await run(['dashboard'])), {ok: true, data: {url: 'https://dashboard.customergpt.ai/'}});
    assert.equal(JSON.parse(await run(['dashboard', '--print'], {CUSTOMERGPT_DASHBOARD_URL: 'https://staging.example.com'})).data.url, 'https://staging.example.com/');
    await assert.rejects(run(['dashboard'], {CUSTOMERGPT_DASHBOARD_URL: 'http://evil.example'}));
  } finally { await new Promise(resolve => server.close(resolve)); }
});
