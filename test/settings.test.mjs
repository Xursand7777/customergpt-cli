import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {parseCommand} from '../lib/commands.mjs';
import {readSettingFiles} from '../lib/files.mjs';

const bin = fileURLToPath(new URL('../bin/customergpt.mjs', import.meta.url));
const input = args => JSON.parse(parseCommand(['chatbots', 'update', 'b', ...args])[3]);

test('chatbots update maps behaviour flags to fields and a salesConfig patch', () => {
  assert.deepEqual(input(['--welcome', 'Hi!', '--color', '#112233', '--starter', 'Pricing?', '--starter', 'Hours, please', '--calendar-link', 'https://cal.com/acme']), {
    chatbotId: 'b', welcomeMessage: 'Hi!', primaryColor: '#112233', quickPrompts: ['Pricing?', 'Hours, please'], calendarLink: 'https://cal.com/acme',
  });
  assert.deepEqual(input(['--sales', '--instructions', 'Qualify budget first.', '--handoff-keyword', 'manager', '--handoff-keyword', 'refund', '--no-booking', '--checkout-url', 'https://acme.com/buy']), {
    chatbotId: 'b', salesConfig: {enabled: true, instructions: 'Qualify budget first.', handoffKeywords: ['manager', 'refund'], bookingEnabled: false, checkoutUrl: 'https://acme.com/buy'},
  });
  assert.deepEqual(input(['--clear-starters', '--clear-calendar-link']), {chatbotId: 'b', quickPrompts: [], calendarLink: null});
  assert.deepEqual(input(['--reset-behaviour']), {chatbotId: 'b', salesConfig: null});
  assert.deepEqual(input(['--url', 'https://acme.com']), {chatbotId: 'b', websiteUrl: 'https://acme.com'});
});

test('contradictory behaviour flags are refused', () => {
  for (const [a, b] of [['--starter', '--clear-starters'], ['--sales', '--no-sales'], ['--instructions', '--reset-behaviour'], ['--calendar-link', '--clear-calendar-link']]) {
    const args = [a, ...(['--starter', '--instructions', '--calendar-link'].includes(a) ? ['x'] : []), b];
    assert.throws(() => input(args), {code: 'CONFLICTING_OPTIONS'});
  }
  assert.throws(() => parseCommand(['chatbots', 'list', '--sales']), {code: 'UNKNOWN_OPTION'}, 'settings flags belong to chatbots update only');
  assert.throws(() => input(['--salse']), {message: /Did you mean --sales/});
});

test('setting files: JSON patch under explicit flags, instructions from text', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cgpt-settings-'));
  try {
    const config = join(dir, 'sales.json');
    await writeFile(config, JSON.stringify({enabled: false, qualificationFields: [{key: 'budget', label: 'Budget', required: true}]}));
    const text = join(dir, 'instructions.md');
    await writeFile(text, '  Ask for the budget.\n');
    assert.deepEqual(await readSettingFiles(input(['--sales-config-file', config, '--sales', '--instructions-file', text])), {
      chatbotId: 'b', salesConfig: {enabled: true, qualificationFields: [{key: 'budget', label: 'Budget', required: true}], instructions: 'Ask for the budget.'},
    });
    await writeFile(config, '[1]');
    await assert.rejects(readSettingFiles({salesConfigFile: config}), /JSON object/);
    await writeFile(config, '{oops');
    await assert.rejects(readSettingFiles({salesConfigFile: config}), /not valid JSON/);
    await assert.rejects(readSettingFiles({instructionsFile: join(dir, 'missing.txt')}), {code: 'INVALID_FILE'});
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('chatbots update sends the settings end to end', async () => {
  const seen = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    seen.push({url: req.url, body: JSON.parse(body)});
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ok: true, data: {dryRun: true}}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const env = {...process.env, CUSTOMERGPT_API_URL: 'http://127.0.0.1:' + server.address().port, CUSTOMERGPT_API_KEY: 'k'};
    await new Promise((resolve, reject) => execFile(process.execPath, [bin, 'chatbots', 'update', 'b', '--sales', '--starter', 'Pricing?', '--dry-run'], {env}, error => error ? reject(error) : resolve()));
    assert.equal(seen[0].url, '/api/v1/agents/actions/chatbots_update');
    assert.deepEqual(seen[0].body, {chatbotId: 'b', salesConfig: {enabled: true}, quickPrompts: ['Pricing?'], dryRun: true, confirm: false});
  } finally { await new Promise(resolve => server.close(resolve)); }
});
