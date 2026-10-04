import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {readConfig,saveConfig,profiles,connection} from '../lib/config.mjs';
import {doctor,tracedFetch} from '../lib/diagnostics.mjs';
import {help} from '../lib/commands.mjs';

test('legacy credentials migrate without leaking across profiles or origins; doctor and debug redact secrets', async()=>{
  const dir=await mkdtemp(join(tmpdir(),'cgpt-profiles-'));
  const env={...process.env}; const oldFetch=globalThis.fetch; const oldError=console.error;
  const logs=[];
  try {
    for(const key of ['CUSTOMERGPT_PROFILE','CUSTOMERGPT_API_URL','CUSTOMERGPT_API_KEY']) delete process.env[key];
    process.env.CUSTOMERGPT_CONFIG_FILE=join(dir,'config.json');
    await writeFile(process.env.CUSTOMERGPT_CONFIG_FILE,JSON.stringify({base:'https://original.example',key:'secret-original'}));
    assert.equal((await readConfig()).key,'secret-original');
    process.env.CUSTOMERGPT_PROFILE='work';
    assert.equal((await readConfig()).key,undefined);
    await saveConfig({base:'https://work.example',key:'secret-work'});
    assert.equal((await connection()).key,'secret-work');
    assert.equal((await connection({base:'https://other.example'})).key,undefined);
    delete process.env.CUSTOMERGPT_PROFILE;
    assert.equal((await readConfig()).key,'secret-original');
    await profiles('use','work');
    assert.equal((await readConfig()).key,'secret-work');
    assert.equal(JSON.stringify(await profiles('list')).includes('secret-'),false);
    await assert.rejects(profiles('use','missing'),/Unknown profile/);
    console.error=value=>logs.push(value);
    globalThis.fetch=async(url,options)=>({ok:true,status:200,json:async()=>url.includes('well-known')?{issuer:'https://work.example',code_challenge_methods_supported:['S256']}:url.endsWith('/account_usage')?{ok:true,data:{}}:{actions:[{name:'chatbots_create'}]}});
    const result=await doctor('0.3.0',{debug:true});
    assert.equal(result.ok,true);
    await tracedFetch('https://work.example/test?token=secret-query',{headers:{Authorization:'secret-header'},body:'secret-body'},true);
    assert.equal(logs.join('').includes('secret-'),false);
    assert.equal(logs.join('').includes('?'),false);
    globalThis.fetch=async()=>({ok:false,status:404});
    const failed=await doctor('0.3.0');
    assert.equal(failed.ok,false);
    assert.ok(failed.data.checks.some(c=>c.name==='agent_api'&&c.status==='fail'));
  } finally {
    globalThis.fetch=oldFetch; console.error=oldError;
    for(const key of ['CUSTOMERGPT_PROFILE','CUSTOMERGPT_API_URL','CUSTOMERGPT_API_KEY','CUSTOMERGPT_CONFIG_FILE']) {if(env[key]===undefined) delete process.env[key]; else process.env[key]=env[key];}
    await rm(dir,{recursive:true,force:true});
  }
});
test('command help documents required arguments and global diagnostics flags',()=>{
  assert.match(help('knowledge website add'),/--chatbot <UUID> Required/);
  assert.match(help('doctor'),/Does not create bots/);
  assert.match(help('profiles'),/profiles use/);
  assert.match(help('chatbots list'),/--limit/);
  assert.throws(()=>help('missing'),/Unknown command/);
});
