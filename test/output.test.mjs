import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {render, renderError, palette} from '../lib/output.mjs';
import {parseCommand, completions, completionScript} from '../lib/commands.mjs';
import {suggestCommand} from '../lib/suggest.mjs';
import {humanOutput} from '../bin/customergpt.mjs';

const plain = palette(false);
const bin = fileURLToPath(new URL('../bin/customergpt.mjs', import.meta.url));

test('lists render as a table with a paging footer', () => {
  const output = render('chatbots_list', {ok: true, data: {items: [{id: 'b1', name: 'Support', websiteUrl: 'https://example.com', settings: {a: 1}}], total: 30, page: 1, limit: 25}}, plain);
  const [header, row, , footer] = output.split('\n');
  assert.match(header, /^id\s+name\s+websiteUrl$/);
  assert.match(row, /^b1\s+Support\s+https:\/\/example\.com$/);
  assert.equal(footer, 'Showing 1 of 30 · page 1 of 2 (use --page)');
});

test('answers, snippets, dry runs and conversations render for people', () => {
  assert.equal(render('messages_send', {data: {response: 'We open at 9.'}}, plain), 'We open at 9.');
  assert.match(render('installation_snippet', {data: {snippet: '<script></script>'}}, plain), /<script><\/script>$/);
  assert.match(render('chatbots_create', {data: {dryRun: true, name: 'Bot'}}, plain), /^Dry run: no changes made\./);
  const conversation = render('conversations_get', {data: {conversation: {id: 'c1', status: 'open'}, messages: [{sender: 'user', text: 'Hi'}], total: 1, page: 1, limit: 25}}, plain);
  assert.match(conversation, /status\s+open/);
  assert.match(conversation, /user\n {2}Hi/);
  assert.equal(render('logout', {data: {message: 'Saved session removed.'}}, plain), '✔ Saved session removed.');
});

test('errors show the hint and how to resume a job', () => {
  const error = Object.assign(new Error('Training still running'), {code: 'WAIT_TIMEOUT', hint: 'Increase --timeout', job: {id: 'j1', token: 'secret'}});
  const output = renderError(error, plain);
  assert.match(output, /✖ Training still running \(WAIT_TIMEOUT\)/);
  assert.match(output, /→ Increase --timeout/);
  assert.match(output, /customergpt jobs get j1 --token <token>/);
  assert.equal(output.includes('secret'), false);
});

test('JSON stays the default for pipes, --json and machine commands', () => {
  const tty = {isTTY: true}, pipe = {isTTY: false};
  assert.equal(humanOutput(['chatbots', 'list'], false, tty, {}), true);
  assert.equal(humanOutput(['chatbots', 'list'], false, pipe, {}), false);
  assert.equal(humanOutput(['chatbots', 'list'], true, tty, {}), false);
  assert.equal(humanOutput(['chatbots', 'list'], false, tty, {CUSTOMERGPT_OUTPUT: 'json'}), false);
  assert.equal(humanOutput(['call', 'chatbots_list'], false, tty, {}), false);
  assert.equal(humanOutput(['chatbots', 'list'], false, pipe, {CUSTOMERGPT_OUTPUT: 'human'}), true);
});

test('typos suggest the closest command and option', () => {
  assert.equal(suggestCommand(['chatbts', 'list'], ['chatbots list', 'chatbots get']), 'chatbots list');
  assert.equal(suggestCommand(['knowlege'], ['knowledge website add', 'jobs get']), 'knowledge');
  assert.equal(suggestCommand(['zzzzzz'], ['chatbots list']), undefined);
  assert.throws(() => parseCommand(['chatbts', 'list']), {code: 'UNKNOWN_COMMAND', message: /Did you mean "customergpt chatbots list"/});
  assert.throws(() => parseCommand(['chatbots', 'list', '--limt', '5']), {code: 'UNKNOWN_OPTION', message: /Did you mean --limit/});
});

test('chatbots delete maps to the destructive action and needs explicit flags', () => {
  const args = parseCommand(['chatbots', 'delete', 'bot', '--dry-run']);
  assert.equal(args[1], 'chatbots_delete');
  assert.deepEqual(JSON.parse(args[3]), {chatbotId: 'bot'});
  assert.deepEqual(args.slice(4), ['--dry-run']);
  assert.throws(() => parseCommand(['chatbots', 'delete']), /Usage/);
  assert.match(render('chatbots_delete', {data: {dryRun: true, action: 'chatbots_delete', name: 'Bot', sources: 2, conversations: 5}}, plain), /^Dry run: no changes made\.[\s\S]*sources\s+2[\s\S]*conversations\s+5/);
});

test('knowledge links and sitemap map to sources_add inputs', () => {
  const links = parseCommand(['knowledge', 'links', 'add', 'https://docs.example.com/a', 'https://docs.example.com/b', '--chatbot', 'bot', '--yes', '--wait']);
  assert.equal(links[1], 'sources_add');
  assert.deepEqual(JSON.parse(links[3]), {urls: ['https://docs.example.com/a', 'https://docs.example.com/b'], chatbotId: 'bot', name: 'docs.example.com links'});
  assert.deepEqual(links.slice(4), ['--yes', '--wait']);
  const sitemap = parseCommand(['knowledge', 'sitemap', 'add', 'https://example.com/sitemap.xml', '--chatbot', 'bot', '--max-pages', '20', '--yes']);
  assert.deepEqual(JSON.parse(sitemap[3]), {sitemapUrl: 'https://example.com/sitemap.xml', chatbotId: 'bot', maxPages: 20, name: 'example.com sitemap'});
  assert.throws(() => parseCommand(['knowledge', 'links', 'add', '--chatbot', 'bot']), /Usage/);
});

test('leads list and --leads-only filter conversations to captured leads', () => {
  assert.deepEqual(JSON.parse(parseCommand(['leads', 'list', '--chatbot', 'bot'])[3]), {leadsOnly: true, chatbotId: 'bot'});
  assert.deepEqual(JSON.parse(parseCommand(['conversations', 'list', '--chatbot', 'bot', '--leads-only'])[3]), {chatbotId: 'bot', leadsOnly: true});
});

test('completion offers subcommands, then the command flags', () => {
  assert.deepEqual(new Set(completions(['knowledge'])), new Set(['website', 'links', 'sitemap', 'files', 'text', 'documents']));
  assert.ok(completions([]).includes('leads'));
  const flags = completions(['knowledge', 'website', 'add', 'https://example.com']);
  for (const flag of ['--chatbot', '--max-pages', '--yes', '--dry-run', '--wait', '--json']) assert.ok(flags.includes(flag), flag);
  assert.match(completionScript('bash'), /complete -o default -F _customergpt customergpt/);
  assert.match(completionScript('zsh'), /compdef _customergpt customergpt/);
  assert.throws(() => completionScript('fish'), /Usage/);
});

test('forced human output prints a table end to end', async () => {
  const server = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ok: true, data: {items: [{id: 'b1', name: 'Support'}], total: 1, page: 1, limit: 25}}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const env = {...process.env, CUSTOMERGPT_API_URL: 'http://127.0.0.1:' + server.address().port, CUSTOMERGPT_API_KEY: 'k', CUSTOMERGPT_OUTPUT: 'human', NO_COLOR: '1'};
    const run = args => new Promise((resolve, reject) => execFile(process.execPath, [bin, ...args], {env}, (error, stdout) => error ? reject(error) : resolve(stdout)));
    assert.match(await run(['chatbots', 'list']), /^id\s+name\nb1\s+Support\n/);
    assert.deepEqual(JSON.parse(await run(['chatbots', 'list', '--json'])).data.items[0].id, 'b1');
  } finally { await new Promise(resolve => server.close(resolve)); }
});
