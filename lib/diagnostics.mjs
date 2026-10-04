import {performance} from 'node:perf_hooks';
import {connection, readConfig, selectedProfile, normalizeBase, DEFAULT_BASE} from './config.mjs';
import {clientHeaders} from './version.mjs';

export async function tracedFetch(url, options = {}, debug = false) {
  const started = performance.now();
  const safe = new URL(url);
  // Log only the method, origin, pathname and status. Never headers, bodies or queries.
  try {
    const response = await fetch(url,options);
    if (debug) console.error(JSON.stringify({event:'http',method:options.method || 'GET',url:safe.origin+safe.pathname,status:response.status,durationMs:Math.round(performance.now()-started)}));
    return response;
  } catch (error) {
    if (debug) console.error(JSON.stringify({event:'http',method:options.method || 'GET',url:safe.origin+safe.pathname,status:'network_error',durationMs:Math.round(performance.now()-started)}));
    throw error;
  }
}

export async function doctor(version, options = {}) {
  const checks = [];
  const check = async (name, run) => {
    try { await run(); checks.push({name,status:'pass'}); }
    catch (error) { checks.push({name,status:'fail',message:error.message}); }
  };
  let base;
  await check('configuration',async () => { const saved=await readConfig(); base=normalizeBase(process.env.CUSTOMERGPT_API_URL || saved.base || DEFAULT_BASE); });
  await check('node',async () => { if(Number(process.versions.node.split('.')[0]) < 20) throw new Error('Node.js 20 or later is required'); });
  async function json(path, key, body) {
    const response=await tracedFetch(base+path,{method:body?'POST':'GET',redirect:'error',signal:AbortSignal.timeout(options.requestTimeoutMs ?? 15000),headers:{'Content-Type':'application/json',...clientHeaders(),...(key?{'X-Api-Key':key}:{})},...(body?{body:JSON.stringify(body)}:{})},options.debug);
    if(!response.ok) throw new Error('HTTP '+response.status+'; check server deployment, account access and credentials');
    return response.json();
  }
  if(base) {
    await check('agent_api',async()=> { const result=await json('/api/v1/agents/actions'); if(!Array.isArray(result.actions) || !result.actions.some(a=>a.name==='chatbots_create')) throw new Error('Agent action catalog is missing'); });
    await check('oauth',async()=> { const result=await json('/.well-known/oauth-authorization-server'); if(new URL(result.issuer).origin !== base || !result.code_challenge_methods_supported?.includes('S256')) throw new Error('OAuth issuer or PKCE configuration is invalid'); });
    await check('authentication',async()=> { const {key}=await connection(); if(!key) throw new Error('No credentials for this server. Run customergpt login.'); await json('/api/v1/agents/actions/account_usage',key,{}); });
  }
  return {ok:checks.every(c=>c.status==='pass'),data:{version,node:process.versions.node,base,profile:await selectedProfile().catch(()=>undefined),checks}};
}
