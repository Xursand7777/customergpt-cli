import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {waitForTraining} from '../lib/index.mjs';
import {parseCommand} from '../lib/commands.mjs';
import {render, renderError, palette} from '../lib/output.mjs';

const bin = fileURLToPath(new URL('../bin/customergpt.mjs', import.meta.url));
const plain = palette(false);
const at = (seconds) => new Date(Date.UTC(2026, 9, 4, 10, 0, seconds)).toISOString();
const running = {jobId: 'j1', sourceId: 's1', name: 'Help center', status: 'running', startedAt: at(0)};
const status = (fields) => ({chatbotId: 'bot', idle: true, active: [], failed: [], checkedAt: at(10), ...fields});
const replies = (...list) => {
  const calls = [];
  return {calls, request: async (action, input) => { calls.push({action, input}); return {ok: true, data: list[Math.min(calls.length - 1, list.length - 1)]}; }};
};

test('waits until idle and lists what trained, ignoring failures from before the wait', async () => {
  const old = {jobId: 'j0', sourceId: 's0', name: 'Old', error: 'Boom', failedAt: at(1)};
  const stub = replies(status({idle: false, active: [running], failed: [old]}), status({checkedAt: at(20), failed: [old]}));
  const progress = [];
  const result = await waitForTraining('bot', {intervalMs: 0, request: stub.request, onProgress: s => progress.push(s.idle)});
  assert.deepEqual(stub.calls, [{action: 'training_status', input: {chatbotId: 'bot'}}, {action: 'training_status', input: {chatbotId: 'bot'}}]);
  assert.deepEqual(progress, [false, true]);
  assert.deepEqual(result.trained, [{jobId: 'j1', sourceId: 's1', name: 'Help center'}]);
  assert.deepEqual(result.failed, []);
  assert.equal(result.idle, true);
});

test('fails when training seen during the wait failed, or a new one failed', async () => {
  const failed = {jobId: 'j1', sourceId: 's1', name: 'Help center', error: 'Could not read the starting URL', failedAt: at(15)};
  const quick = {jobId: 'j2', sourceId: 's2', name: 'Quick', error: 'Boom', failedAt: at(12)};
  const stub = replies(status({idle: false, active: [running]}), status({checkedAt: at(20), failed: [failed, quick]}));
  await assert.rejects(waitForTraining('bot', {intervalMs: 0, request: stub.request}), error => {
    assert.equal(error.code, 'TRAINING_FAILED');
    assert.match(error.message, /2 training run\(s\) failed: Help center, Quick/);
    assert.deepEqual(error.training.failed, [failed, quick]);
    assert.deepEqual(error.training.trained, []);
    assert.match(renderError(error, plain), /✖ Help center — Could not read the starting URL/);
    return true;
  });
});

test('timeout returns WAIT_TIMEOUT with what is still training and how to resume', async () => {
  const stub = replies(status({idle: false, active: [running]}));
  await assert.rejects(waitForTraining('bot', {timeoutMs: 0, request: stub.request}), error => {
    assert.equal(error.code, 'WAIT_TIMEOUT');
    assert.deepEqual(error.training, {chatbotId: 'bot', active: [running]});
    assert.equal(error.hint, 'Resume with: customergpt knowledge wait --chatbot bot');
    assert.match(renderError(error, plain), /… Help center \(running\)/);
    return true;
  });
});

test('knowledge wait and status parse into training_status and need a bot', () => {
  assert.deepEqual(parseCommand(['knowledge', 'wait', '--chatbot', 'bot']), ['call', 'training_status', '--json', '{"chatbotId":"bot"}', '--wait-all']);
  assert.deepEqual(parseCommand(['knowledge', 'status', '--chatbot', 'bot']), ['call', 'training_status', '--json', '{"chatbotId":"bot"}']);
  assert.throws(() => parseCommand(['knowledge', 'wait']), /Usage: customergpt knowledge wait --chatbot/);
});

test('status renders active and recently failed training for a person', () => {
  const output = render('training_status', {ok: true, data: status({idle: false, active: [running], failed: [{jobId: null, sourceId: 's2', name: 'notes', error: 'Training failed', failedAt: at(1)}]})}, plain);
  assert.match(output, /^1 training\nname\s+status/);
  assert.match(output, /Help center\s+running/);
  assert.match(output, /Failed in the last 24 hours:\nname/);
  assert.equal(render('training_status', {ok: true, data: {...status({}), trained: [{name: 'Help center'}], waitedMs: 5}}, plain), '✔ All training finished: Help center');
});

async function withServer(responses, work) {
  const seen = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    seen.push({url: req.url, body: JSON.parse(body)});
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ok: true, data: responses[Math.min(seen.length - 1, responses.length - 1)]}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try { return await work({seen, env: {...process.env, CUSTOMERGPT_API_URL: 'http://127.0.0.1:' + server.address().port, CUSTOMERGPT_API_KEY: 'k', CUSTOMERGPT_OUTPUT: 'json'}}); }
  finally { await new Promise(resolve => server.close(resolve)); }
}
const run = (args, env) => new Promise(resolve => execFile(process.execPath, [bin, ...args], {env}, (error, stdout, stderr) => resolve({code: error?.code ?? 0, stdout, stderr})));

test('the CLI exits nonzero listing failures, with progress on stderr', async () => {
  const failed = {jobId: 'j1', sourceId: 's1', name: 'Help center', error: 'Boom', failedAt: at(15)};
  await withServer([status({idle: false, active: [running]}), status({checkedAt: at(20), failed: [failed]})], async ({seen, env}) => {
    const {code, stdout, stderr} = await run(['knowledge', 'wait', '--chatbot', 'bot'], env);
    assert.equal(code, 1);
    assert.equal(stdout, '');
    assert.deepEqual(seen.map(s => s.url), ['/api/v1/agents/actions/training_status', '/api/v1/agents/actions/training_status']);
    assert.deepEqual(seen[0].body, {chatbotId: 'bot'});
    const lines = stderr.trim().split('\n').map(line => JSON.parse(line));
    assert.deepEqual(lines[0], {event: 'training_progress', data: {chatbotId: 'bot', idle: false, active: [running]}});
    const error = lines.at(-1);
    assert.equal(error.error.code, 'TRAINING_FAILED');
    assert.deepEqual(error.training.failed, [failed]);
  });
});

test('the CLI prints the settled state on stdout and --quiet hides progress', async () => {
  await withServer([status({})], async ({env}) => {
    const {code, stdout, stderr} = await run(['knowledge', 'wait', '--chatbot', 'bot', '--quiet'], env);
    assert.equal(code, 0);
    assert.equal(stderr, '');
    const result = JSON.parse(stdout);
    assert.equal(result.ok, true);
    assert.deepEqual({idle: result.data.idle, trained: result.data.trained, failed: result.data.failed}, {idle: true, trained: [], failed: []});
  });
});

test('the CLI times out with WAIT_TIMEOUT and resumable details', async () => {
  await withServer([status({idle: false, active: [running]})], async ({env}) => {
    const {code, stderr} = await run(['knowledge', 'wait', '--chatbot', 'bot', '--timeout', '0.2', '-q'], env);
    assert.equal(code, 1);
    const error = JSON.parse(stderr.trim());
    assert.equal(error.error.code, 'WAIT_TIMEOUT');
    assert.equal(error.error.hint, 'Resume with: customergpt knowledge wait --chatbot bot');
    assert.deepEqual(error.training, {chatbotId: 'bot', active: [running]});
  });
});
