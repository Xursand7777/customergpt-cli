import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseCommand, completions} from '../lib/commands.mjs';
import {render, palette} from '../lib/output.mjs';

const bin = fileURLToPath(new URL('../bin/customergpt.mjs', import.meta.url));
const input = args => JSON.parse(parseCommand(args)[3]);

test('knowledge responses commands map to the custom response actions', () => {
  assert.deepEqual(parseCommand(['knowledge', 'responses', 'list', '--chatbot', 'b']).slice(0, 2), ['call', 'responses_list']);
  assert.deepEqual(input(['knowledge', 'responses', 'add', '--chatbot', 'b', '--question', 'Refunds?', '--answer', 'Within 30 days.', '--yes']), {chatbotId: 'b', question: 'Refunds?', answer: 'Within 30 days.'});
  assert.deepEqual(input(['knowledge', 'responses', 'update', 'r1', '--chatbot', 'b', '--answer', 'Within 14 days.', '--yes']), {responseId: 'r1', chatbotId: 'b', answer: 'Within 14 days.'});
  const remove = parseCommand(['knowledge', 'responses', 'delete', 'r1', '--chatbot', 'b', '--dry-run']);
  assert.equal(remove[1], 'responses_delete');
  assert.deepEqual(remove.slice(4), ['--dry-run']);
});

test('knowledge responses add requires the bot, question and answer', () => {
  for (const args of [
    ['knowledge', 'responses', 'add', '--question', 'Q', '--answer', 'A'],
    ['knowledge', 'responses', 'add', '--chatbot', 'b', '--answer', 'A'],
    ['knowledge', 'responses', 'add', '--chatbot', 'b', '--question', 'Q'],
    ['knowledge', 'responses', 'delete', '--chatbot', 'b'],
  ]) assert.throws(() => parseCommand(args), /Usage/);
});

test('completion and tables cover custom responses', () => {
  assert.deepEqual(completions(['knowledge', 'responses']).sort(), ['add', 'delete', 'list', 'update']);
  assert.ok(completions(['knowledge', 'responses', 'add']).includes('--question'));
  const table = render('responses_list', {data: {items: [{id: 'r1', question: 'Refunds?', answer: 'Within 30 days.'}], total: 1, page: 1, limit: 25}}, palette(false));
  assert.match(table, /^id\s+question\s+answer\nr1\s+Refunds\?\s+Within 30 days\./);
});

test('the CLI creates a custom response end to end', async () => {
  const seen = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    seen.push({url: req.url, body: JSON.parse(body)});
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ok: true, data: {id: 'r1', question: 'Refunds?', answer: 'Within 30 days.'}}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const env = {...process.env, CUSTOMERGPT_API_URL: 'http://127.0.0.1:' + server.address().port, CUSTOMERGPT_API_KEY: 'k'};
    const stdout = await new Promise((resolve, reject) => execFile(process.execPath, [bin, 'knowledge', 'responses', 'add', '--chatbot', 'b', '--question', 'Refunds?', '--answer', 'Within 30 days.', '--yes'], {env}, (error, out) => error ? reject(error) : resolve(out)));
    assert.equal(seen[0].url, '/api/v1/agents/actions/responses_create');
    assert.deepEqual(seen[0].body, {chatbotId: 'b', question: 'Refunds?', answer: 'Within 30 days.', confirm: true});
    assert.equal(JSON.parse(stdout).data.id, 'r1');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
