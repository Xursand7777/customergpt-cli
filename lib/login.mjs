import {createServer} from 'node:http';
import {randomBytes, createHash} from 'node:crypto';
import {spawn} from 'node:child_process';
import {normalizeBase, oauthPost, saveConfig, readConfig} from './config.mjs';

export function openBrowser(url) {
  // Fixed executable and argument array; never interpolate URLs into a shell.
  const command = process.platform === 'win32' ? 'rundll32.exe' : process.platform === 'darwin' ? 'open' : 'xdg-open';
  const args = process.platform === 'win32' ? ['url.dll,FileProtocolHandler',url] : [url];
  const child = spawn(command,args,{stdio:'ignore',detached:true,windowsHide:true});
  child.on('error',() => {});
  child.unref();
}

export async function browserLogin(base, options = {}) {
  base = normalizeBase(base);
  const state = randomBytes(32).toString('base64url');
  const verifier = randomBytes(32).toString('base64url');
  let resolveCode, rejectCode;
  const codePromise = new Promise((resolve,reject) => { resolveCode = resolve; rejectCode = reject; });
  // Attach immediately so an expiry during registration cannot cause an unhandled rejection.
  codePromise.catch(() => {});
  const server = createServer((req,res) => {
    const url = new URL(req.url,'http://127.0.0.1');
    res.setHeader('Content-Type','text/plain; charset=utf-8');
    res.setHeader('Cache-Control','no-store');
    if (req.method !== 'GET' || url.pathname !== '/callback') { res.writeHead(404); res.end('Not found'); return; }
    if (url.searchParams.get('state') !== state) { res.writeHead(400); res.end('Invalid login state'); return; }
    const code = url.searchParams.get('code');
    if (!code) { res.writeHead(400); res.end('Login was not approved. Return to the terminal.'); rejectCode(new Error('Login was not approved')); return; }
    res.end('Authorization received. Return to the terminal to finish login.');
    resolveCode(code);
  });
  await new Promise((resolve,reject) => { server.once('error',reject); server.listen(0,'127.0.0.1',resolve); });
  const timer = setTimeout(() => rejectCode(new Error('Login timed out. Run customergpt login again.')), options.timeoutMs ?? 300000);
  try {
    const redirect = 'http://127.0.0.1:' + server.address().port + '/callback';
    const client = await oauthPost(base,'/register',{client_name:'CustomerGPT CLI',redirect_uris:[redirect],token_endpoint_auth_method:'none',grant_types:['authorization_code','refresh_token'],response_types:['code']},true);
    const authorize = new URL('/authorize',base);
    authorize.search = new URLSearchParams({client_id:client.client_id,redirect_uri:redirect,response_type:'code',scope:'agents:read agents:write',resource:base+'/api/mcp',state,code_challenge:createHash('sha256').update(verifier).digest('base64url'),code_challenge_method:'S256'}).toString();
    console.error('Open this URL to approve CustomerGPT CLI:\n' + authorize.href);
    if (options.onAuthorize) await options.onAuthorize(authorize.href);
    else if (!options.noBrowser) openBrowser(authorize.href);
    const code = await codePromise;
    const tokens = await oauthPost(base,'/token',{grant_type:'authorization_code',client_id:client.client_id,redirect_uri:redirect,code,code_verifier:verifier,resource:base+'/api/mcp'});
    await saveConfig({base,key:tokens.access_token,refreshToken:tokens.refresh_token,clientId:client.client_id,expiresAt:Date.now()+tokens.expires_in*1000});
  } finally { clearTimeout(timer); server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); }
}

export async function logout() {
  const saved = await readConfig();
  if (saved.refreshToken && saved.clientId) {
    // If revocation fails, retain the credential so the user can retry.
    const response = await fetch(normalizeBase(saved.base)+'/revoke',{method:'POST',redirect:'error',signal:AbortSignal.timeout(30000),headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({client_id:saved.clientId,token:saved.refreshToken,token_type_hint:'refresh_token'})});
    if (!response.ok) throw new Error('Could not revoke the session. Retry logout when the server is reachable.');
  }
  await saveConfig({base:saved.base});
}
