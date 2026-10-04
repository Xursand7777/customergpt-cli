import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createServer} from 'node:http';
import {createHash} from 'node:crypto';
import {browserLogin, logout} from '../lib/login.mjs';
import {readConfig, saveConfig, connection} from '../lib/config.mjs';
import {parseCommand} from '../lib/commands.mjs';

test('named commands map website training and bot creation to validated API actions', () => {
  const args = parseCommand(['knowledge','website','add','https://example.com','--chatbot','bot','--yes','--wait','--json']);
  assert.equal(args[1],'sources_add');
  assert.deepEqual(JSON.parse(args[3]),{url:'https://example.com',chatbotId:'bot',name:'example.com'});
  assert.deepEqual(args.slice(4),['--yes','--wait']);
  assert.deepEqual(JSON.parse(parseCommand(['chatbots','create','Support','--url','https://example.com','--yes'])[3]),{name:'Support',websiteUrl:'https://example.com'});
  assert.throws(()=>parseCommand(['chatbots','list','--limit','NaN']),/positive integer/);
  assert.throws(()=>parseCommand(['chatbots','get']),/Usage/);
  assert.equal(parseCommand(['messages','send','Hello','--chatbot','bot','--yes'])[1],'messages_send');
  assert.deepEqual(JSON.parse(parseCommand(['installation','snippet','--chatbot','bot'])[3]),{chatbotId:'bot'});
});

test('browser login validates state, uses PKCE, refreshes and revokes the saved session',async () => {
  const directory = await mkdtemp(join(tmpdir(),'customergpt-login-'));
  const previous = process.env.CUSTOMERGPT_CONFIG_FILE;
  process.env.CUSTOMERGPT_CONFIG_FILE = join(directory,'config.json');
  const oldKey = process.env.CUSTOMERGPT_API_KEY;
  delete process.env.CUSTOMERGPT_API_KEY;
  let redirect, challenge, refreshes = 0, revoked = false;
  const server = createServer(async (req,res) => {
    let body=''; for await (const chunk of req) body+=chunk;
    res.setHeader('Content-Type','application/json');
    if (req.url === '/register') {
      const registration=JSON.parse(body); redirect=registration.redirect_uris[0];
      assert.equal(registration.token_endpoint_auth_method,'none');
      res.end(JSON.stringify({client_id:'client'})); return;
    }
    const data = new URLSearchParams(body);
    if (req.url === '/revoke') { revoked=true; assert.equal(data.get('token'),'refresh-two'); res.end('{}'); return; }
    if (data.get('grant_type') === 'authorization_code') {
      assert.equal(data.get('redirect_uri'),redirect);
      assert.equal(createHash('sha256').update(data.get('code_verifier')).digest('base64url'),challenge);
      assert.equal(data.get('code'),'approved-code');
      res.end(JSON.stringify({access_token:'access-one',refresh_token:'refresh-one',expires_in:3600}));
    } else { refreshes++; assert.equal(data.get('refresh_token'),'refresh-one'); res.end(JSON.stringify({access_token:'access-two',refresh_token:'refresh-two',expires_in:3600})); }
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const base = 'http://127.0.0.1:'+server.address().port;
  try {
    await browserLogin(base,{onAuthorize:async raw => {
      const url=new URL(raw); challenge=url.searchParams.get('code_challenge');
      const callback=new URL(redirect); callback.search=new URLSearchParams({state:'wrong',code:'bad'}).toString();
      assert.equal((await fetch(callback)).status,400);
      callback.search=new URLSearchParams({state:url.searchParams.get('state'),code:'approved-code'}).toString();
      assert.equal((await fetch(callback)).status,200);
    }});
    assert.equal((await connection({base})).key,'access-one');
    assert.equal((await connection({base:'https://other.example'})).key,undefined);
    await saveConfig({...await readConfig(),expiresAt:0});
    assert.equal((await connection({base})).key,'access-two');
    assert.equal(refreshes,1);
    await logout(); assert.equal(revoked,true); assert.equal((await readConfig()).key,undefined);
  } finally {
    if(previous === undefined) delete process.env.CUSTOMERGPT_CONFIG_FILE; else process.env.CUSTOMERGPT_CONFIG_FILE=previous;
    if(oldKey === undefined) delete process.env.CUSTOMERGPT_API_KEY; else process.env.CUSTOMERGPT_API_KEY=oldKey;
    server.closeAllConnections(); await new Promise(resolve=>server.close(resolve));
    await rm(directory,{recursive:true,force:true});
  }
});
