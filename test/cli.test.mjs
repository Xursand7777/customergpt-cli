import {test} from 'node:test';
import assert from 'node:assert/strict';
import {request,waitForJob} from '../bin/customergpt.mjs';

test('refuses to send credentials over public plain HTTP', async () => {
  await assert.rejects(request('chatbots_list',{}, {base:'http://example.com',key:'secret'}),/HTTPS/);
});
test('wait preserves the secret preview handle and returns the terminal state', async () => {
  const calls = [];
  const result = await waitForJob({id:'job',token:'token',previewUrl:'preview',status:'pending'}, {intervalMs:0,request:async (action,input)=>{calls.push({action,input});return {data:{id:'job',status:'ready',pageCount:2}};}});
  assert.equal(result.token,'token'); assert.equal(result.previewUrl,'preview'); assert.equal(result.status,'ready');
  assert.deepEqual(calls,[{action:'jobs_get',input:{jobId:'job',token:'token'}}]);
});
test('wait reports a failed training job as an error', async () => {
  await assert.rejects(waitForJob({id:'job',status:'pending'}, {intervalMs:0,request:async()=>({data:{status:'failed',error:'Training failed'}})}),error=>error.code==='TRAINING_FAILED');
});
test('wait timeout includes the handle so the caller can resume', async () => {
  await assert.rejects(waitForJob({id:'job',status:'pending'}, {timeoutMs:0}),error=>error.code==='WAIT_TIMEOUT'&&error.job.id==='job');
});
test('polling errors preserve the job handle and bound the request to the wait deadline',async()=>{
  await assert.rejects(waitForJob({id:'job',status:'pending',token:'private'},{timeoutMs:200,intervalMs:0,request:async(action,input,options)=>{
    assert.ok(options.requestTimeoutMs<=200);
    throw new Error('Network unavailable');
  }}),error=>error.job.id==='job'&&error.job.token==='private');
});
test('agent-guide points to the packaged skill and its hosted copy', async () => {
  const {execFile} = await import('node:child_process');
  const {fileURLToPath} = await import('node:url');
  const {readFile} = await import('node:fs/promises');
  const bin = new URL('../bin/customergpt.mjs', import.meta.url);
  const stdout = await new Promise((resolve, reject) => execFile(process.execPath, [fileURLToPath(bin), 'agent-guide'], (error, out) => error ? reject(error) : resolve(out)));
  const guide = JSON.parse(stdout);
  assert.equal(guide.skill.url, 'https://api.customergpt.ai/agents/customergpt-cli-skill.md');
  const skill = await readFile(guide.skill.file, 'utf8');
  assert.match(skill, /^---\nname: customergpt-cli\ndescription: .+\n---\n/);
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
  assert.ok(pkg.files.includes('skills'));
});
test('the skill only names commands the CLI has', async () => {
  const {readFile} = await import('node:fs/promises');
  const {commands} = await import('../lib/commands.mjs');
  const skill = await readFile(new URL('../skills/customergpt-cli/SKILL.md', import.meta.url), 'utf8');
  const extra = ['login','logout','doctor','whoami','mcp','agent-guide','actions','call','dashboard','completion'];
  const used = [...skill.matchAll(/customergpt ([a-z][a-z-]*(?: [a-z]+){0,2})/g)].map(m => m[1]);
  for (const words of used) {
    const known = Object.keys(commands).some(name => (words+' ').startsWith(name+' ')) || extra.includes(words.split(' ')[0]);
    assert.ok(known, 'Unknown command in SKILL.md: customergpt '+words);
  }
});
