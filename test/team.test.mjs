import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseCommand, completions} from '../lib/commands.mjs';
import {render, palette} from '../lib/output.mjs';

const bin = fileURLToPath(new URL('../bin/customergpt.mjs', import.meta.url));
const plain = palette(false);

test('limits, tokens and members commands map to their actions', () => {
  const action = args => parseCommand(args)[1];
  assert.equal(action(['limits']), 'account_limits');
  assert.equal(action(['tokens', 'list']), 'tokens_list');
  assert.deepEqual(JSON.parse(parseCommand(['tokens', 'create', '--name', 'CI', '--yes'])[3]), {name: 'CI'});
  assert.deepEqual(JSON.parse(parseCommand(['tokens', 'revoke', 't1', '--dry-run'])[3]), {tokenId: 't1'});
  assert.equal(action(['members', 'list']), 'members_list');
  assert.deepEqual(JSON.parse(parseCommand(['members', 'remove', 'm1', '--yes'])[3]), {memberId: 'm1'});
  assert.throws(() => parseCommand(['tokens', 'revoke']), /Usage/);
  assert.throws(() => parseCommand(['members', 'remove']), /Usage/);
  assert.deepEqual(completions(['tokens']).sort(), ['create', 'list', 'revoke']);
  assert.ok(completions([]).includes('members'));
});

test('a new key is printed once with a warning; limits and seats render as tables', () => {
  const created = render('tokens_create', {data: {id: 't1', name: 'CI', keyPrefix: 'cgpt_abc1234', key: 'cgpt_secret', warning: 'only once'}}, plain);
  assert.match(created, /^✔ API key created: CI\nCopy it now; it will not be shown again\. Treat it like a password\.\n\n {2}cgpt_secret$/);
  const limits = render('account_limits', {data: {plan: {tier: 'growth', name: 'Growth'}, limits: {chatbots: 5, characters: 250000, messagesPerMonth: 2000, teamMembers: 3, apiAccess: true, webhooks: false}, usage: {chatbots: 2, characters: 1200, messagesThisMonth: 40, teamMembers: 1}}}, plain);
  assert.match(limits, /^Plan: Growth\n\nresource\s+used\s+limit\n/);
  assert.match(limits, /messagesThisMonth\s+40\s+2000/);
  assert.match(limits, /apiAccess yes {2}webhooks no$/);
  const members = render('members_list', {data: {items: [{id: 'm1', email: 'a@acme.com', role: 'member'}], seats: {used: 2, limit: 3}}}, plain);
  assert.match(members, /a@acme\.com[\s\S]*\n\nSeats: 2 of 3$/);
});

test('tokens create sends confirmation and prints the secret only on stdout', async () => {
  const seen = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    seen.push({url: req.url, body: JSON.parse(body)});
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ok: true, data: {id: 't1', name: 'CI', keyPrefix: 'cgpt_abc', key: 'cgpt_secret_value'}}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const env = {...process.env, CUSTOMERGPT_API_URL: 'http://127.0.0.1:' + server.address().port, CUSTOMERGPT_API_KEY: 'k'};
    const {stdout, stderr} = await new Promise((resolve, reject) => execFile(process.execPath, [bin, 'tokens', 'create', '--name', 'CI', '--yes', '--debug'], {env}, (error, out, err) => error ? reject(error) : resolve({stdout: out, stderr: err})));
    assert.equal(seen[0].url, '/api/v1/agents/actions/tokens_create');
    assert.deepEqual(seen[0].body, {name: 'CI', confirm: true});
    assert.equal(JSON.parse(stdout).data.key, 'cgpt_secret_value');
    assert.equal(stderr.includes('cgpt_secret_value'), false, '--debug never logs the secret');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
