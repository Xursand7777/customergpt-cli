import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, writeFile, rm, truncate} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {execFile} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {attachFile} from '../lib/files.mjs';
import {parseCommand} from '../lib/commands.mjs';

const bin = fileURLToPath(new URL('../bin/customergpt.mjs', import.meta.url));

test('knowledge files add reads the file as base64 and names the source after it', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cgpt-files-'));
  try {
    const path = join(dir, 'Refund Policy.md');
    await writeFile(path, '# Refunds\nWithin 30 days.');
    const args = parseCommand(['knowledge', 'files', 'add', path, '--chatbot', 'bot', '--yes']);
    assert.equal(args[1], 'sources_add');
    const input = await attachFile(JSON.parse(args[3]));
    assert.deepEqual(input, {chatbotId: 'bot', name: 'Refund Policy.md', file: {name: 'Refund Policy.md', data: Buffer.from('# Refunds\nWithin 30 days.').toString('base64')}});
    assert.equal((await attachFile({filePath: path, name: 'Custom'})).name, 'Custom');
    assert.deepEqual(await attachFile({url: 'https://example.com'}), {url: 'https://example.com'});
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('unsupported, missing and oversized files fail before any upload', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cgpt-files-'));
  try {
    await assert.rejects(attachFile({filePath: join(dir, 'app.exe')}), {code: 'INVALID_FILE', message: /Unsupported file type/});
    await assert.rejects(attachFile({filePath: join(dir, 'missing.pdf')}), {code: 'INVALID_FILE', message: /Cannot read file/});
    const big = join(dir, 'big.txt');
    await writeFile(big, '');
    await truncate(big, 10 * 1024 * 1024 + 1);
    await assert.rejects(attachFile({filePath: big}), {message: /10 MB/});
  } finally { await rm(dir, {recursive: true, force: true}); }
});

test('the CLI uploads the file to sources_add end to end', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'cgpt-files-'));
  const seen = [];
  const server = createServer(async (req, res) => {
    let body = ''; for await (const chunk of req) body += chunk;
    seen.push({url: req.url, body: JSON.parse(body)});
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ok: true, data: {id: 'job', status: 'pending'}}));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const path = join(dir, 'faq.txt');
    await writeFile(path, 'Open 9-18');
    const env = {...process.env, CUSTOMERGPT_API_URL: 'http://127.0.0.1:' + server.address().port, CUSTOMERGPT_API_KEY: 'k'};
    await new Promise((resolve, reject) => execFile(process.execPath, [bin, 'knowledge', 'files', 'add', path, '--chatbot', 'bot', '--yes'], {env}, error => error ? reject(error) : resolve()));
    assert.equal(seen[0].url, '/api/v1/agents/actions/sources_add');
    assert.deepEqual(seen[0].body, {chatbotId: 'bot', name: 'faq.txt', file: {name: 'faq.txt', data: Buffer.from('Open 9-18').toString('base64')}, confirm: true});
  } finally { await new Promise(resolve => server.close(resolve)); await rm(dir, {recursive: true, force: true}); }
});
