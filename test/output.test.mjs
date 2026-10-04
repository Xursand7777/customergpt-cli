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

test('messages reply, conversations tag and bulk-update map to their actions', () => {
  const reply = parseCommand(['messages', 'reply', 'c1', 'We will call you today', '--chatbot', 'bot', '--yes']);
  assert.equal(reply[1], 'messages_reply');
  assert.deepEqual(JSON.parse(reply[3]), {conversationId: 'c1', text: 'We will call you today', chatbotId: 'bot'});
  assert.deepEqual(reply.slice(4), ['--yes']);
  assert.throws(() => parseCommand(['messages', 'reply', 'c1', '--chatbot', 'bot']), /Usage/);
  const tag = parseCommand(['conversations', 'tag', 'c1', '--chatbot', 'bot', '--add', 'vip', '--add', 'follow-up,vip', '--remove', 'cold']);
  assert.equal(tag[1], 'conversations_tag');
  assert.deepEqual(JSON.parse(tag[3]), {conversationId: 'c1', chatbotId: 'bot', addTags: ['vip', 'follow-up'], removeTags: ['cold']});
  assert.throws(() => parseCommand(['conversations', 'tag', 'c1', '--add']), /--add requires a value/);
  const bulk = parseCommand(['conversations', 'bulk-update', 'c1', 'c2', '--chatbot', 'bot', '--status', 'closed', '--add', 'done', '--dry-run']);
  assert.equal(bulk[1], 'conversations_bulk_update');
  assert.deepEqual(JSON.parse(bulk[3]), {conversationIds: ['c1', 'c2'], chatbotId: 'bot', status: 'closed', addTags: ['done']});
  assert.deepEqual(bulk.slice(4), ['--dry-run']);
  assert.throws(() => parseCommand(['conversations', 'bulk-update', '--chatbot', 'bot']), /Usage/);
  assert.ok(completions(['conversations', 'bulk-update']).includes('--remove'));
  assert.ok(completions(['conversations']).includes('bulk-update'));
});

test('replies, tags and bulk updates render for people', () => {
  assert.equal(render('messages_reply', {data: {id: 'm1', sender: 'agent', text: 'Hello\nthere', time: '10:00'}}, plain), '✔ Reply sent · 10:00\n  Hello\n  there');
  assert.equal(render('conversations_tag', {data: {conversationId: 'c1', tags: ['vip', 'done']}}, plain), '✔ Tags: vip, done');
  assert.equal(render('conversations_tag', {data: {conversationId: 'c1', tags: null}}, plain), '✔ Tags: none');
  const preview = render('conversations_bulk_update', {data: {dryRun: true, action: 'conversations_bulk_update', matched: 1, conversationIds: ['c1'], notFound: ['c9']}}, plain);
  assert.match(preview, /^Dry run: no changes made\.\n1 conversation\(s\) would be updated:\n {2}c1\n1 not found for this bot[^\n]*\n {2}c9$/);
  const done = render('conversations_bulk_update', {data: {updated: 2, conversations: [{id: 'c1', status: 'closed', mode: 'ai', tags: ['done']}, {id: 'c2', status: 'closed', mode: 'ai', tags: null}]}}, plain);
  assert.match(done, /^✔ Updated 2 conversation\(s\)\n\nid\s+status\s+mode\s+tags\nc1\s+closed\s+ai\s+done\nc2\s+closed\s+ai$/);
});

test('bulk-update --dry-run sends a dry run without confirmation', async () => {
  let body;
  const server = createServer((req, res) => {
    let raw = '';
    req.on('data', chunk => raw += chunk);
    req.on('end', () => {
      body = {path: req.url, input: JSON.parse(raw)};
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ok: true, data: {dryRun: true, action: 'conversations_bulk_update', matched: 2, conversationIds: ['c1', 'c2'], notFound: []}}));
    });
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const env = {...process.env, CUSTOMERGPT_API_URL: 'http://127.0.0.1:' + server.address().port, CUSTOMERGPT_API_KEY: 'k', CUSTOMERGPT_OUTPUT: 'json'};
    const stdout = await new Promise((resolve, reject) => execFile(process.execPath, [bin, 'conversations', 'bulk-update', 'c1', 'c2', '--chatbot', 'bot', '--mode', 'ai', '--yes', '--dry-run'], {env}, (error, out) => error ? reject(error) : resolve(out)));
    assert.equal(JSON.parse(stdout).data.matched, 2);
    assert.match(body.path, /\/conversations_bulk_update$/);
    assert.equal(body.input.dryRun, true);
    assert.equal(body.input.confirm, false);
    assert.deepEqual(body.input.conversationIds, ['c1', 'c2']);
  } finally { await new Promise(resolve => server.close(resolve)); }
});

test('completion offers subcommands, then the command flags', () => {
  assert.deepEqual(new Set(completions(['knowledge'])), new Set(['website', 'links', 'sitemap', 'files', 'text', 'documents', 'responses', 'status', 'wait']));
  for (const flag of ['--chatbot', '--timeout', '--quiet']) assert.ok(completions(['knowledge', 'wait']).includes(flag), flag);
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
