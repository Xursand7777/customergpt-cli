import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {renderError, palette} from '../lib/output.mjs';
import {requestIdOf} from '../lib/diagnostics.mjs';

const bin = fileURLToPath(new URL('../bin/customergpt.mjs', import.meta.url));

async function withServer(requestId, run) {
  const server = createServer((req, res) => {
    req.resume();
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('X-Request-Id', requestId);
    res.statusCode = 400;
    res.end(JSON.stringify({ok: false, error: {code: 'INVALID_ARGUMENTS', status: 400, message: 'limit: too big'}}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await run('http://127.0.0.1:' + server.address().port); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

const cli = (base, args, extraEnv = {}) => new Promise(resolve => execFile(process.execPath, [bin, ...args], {env: {...process.env, CUSTOMERGPT_API_URL: base, CUSTOMERGPT_API_KEY: 'k', ...extraEnv}}, (error, stdout, stderr) => resolve({code: error?.code ?? 0, stdout, stderr})));

test('JSON errors carry meta.requestId from the response header', async () => {
  await withServer('req_abc12345', async base => {
    const {code, stderr} = await cli(base, ['chatbots', 'list']);
    assert.equal(code, 1);
    const body = JSON.parse(stderr);
    assert.equal(body.error.code, 'INVALID_ARGUMENTS');
    assert.deepEqual(body.meta, {requestId: 'req_abc12345'});
  });
});

test('human errors and --debug traces show the request ID', async () => {
  await withServer('req_abc12345', async base => {
    const human = await cli(base, ['chatbots', 'list'], {CUSTOMERGPT_OUTPUT: 'human', NO_COLOR: '1'});
    assert.match(human.stderr, /request req_abc12345 · quote it to support@customergpt\.ai/);
    const debug = await cli(base, ['chatbots', 'list', '--debug']);
    const trace = debug.stderr.split('\n').filter(line => line.includes('"event":"http"')).map(line => JSON.parse(line));
    assert.equal(trace[0].requestId, 'req_abc12345');
  });
});

test('malformed request IDs are ignored', async () => {
  assert.equal(requestIdOf({headers: new Headers({'x-request-id': 'short'})}), undefined);
  assert.equal(requestIdOf({headers: new Headers({'x-request-id': 'has spaces in it'})}), undefined);
  assert.equal(requestIdOf({headers: new Headers({'x-request-id': 'req_abc12345'})}), 'req_abc12345');
  await withServer('<script>alert(1)</script>', async base => {
    const {stderr} = await cli(base, ['chatbots', 'list']);
    assert.equal(JSON.parse(stderr).meta, undefined);
  });
  assert.equal(renderError(new Error('x'), palette(false)), '✖ x');
});
