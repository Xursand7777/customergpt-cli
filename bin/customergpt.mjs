#!/usr/bin/env node
import { fileURLToPath, pathToFileURL } from 'node:url';
import { readFile } from 'node:fs/promises';

import {connection, readConfig, saveConfig, DEFAULT_BASE, normalizeBase, profiles} from '../lib/config.mjs';
import {doctor} from '../lib/diagnostics.mjs';
import {browserLogin, logout, openBrowser} from '../lib/login.mjs';
import {serveStdio} from '../lib/mcp.mjs';
import {version} from '../lib/version.mjs';
import {parseCommand, help, commands, completions, completionScript} from '../lib/commands.mjs';
import {render, renderError, palette, useColor} from '../lib/output.mjs';
import {request, waitForJob, waitForTraining} from '../lib/index.mjs';
import {attachFile, readSettingFiles} from '../lib/files.mjs';
export {request, waitForJob, waitForTraining} from '../lib/index.mjs';
const DASHBOARD = 'https://dashboard.customergpt.ai';
// The same SKILL.md ships in this package and is served by the API for agents without it.
const SKILL_URL = 'https://api.customergpt.ai/agents/customergpt-cli-skill.md';
const SKILL_FILE = fileURLToPath(new URL('../skills/customergpt-cli/SKILL.md', import.meta.url));

function mcp(options) {
  const mcpOptions = {...options, mode:'mcp'};
  return serveStdio({
    name:'customergpt-cli', version,
    listTools: async () => {
      const credentials = await connection();
      const catalog = await request(undefined,undefined,mcpOptions);
      // Without credentials only anonymous onboarding tools are advertised.
      return catalog.actions.filter(a => credentials.key || a.authentication === 'optional').map(({authentication,...tool}) => tool);
    },
    callTool: async (name, args) => {
      try { return {content:[{type:'text',text:JSON.stringify(await request(name,args,mcpOptions))}]}; }
      catch(error) { return {isError:true,content:[{type:'text',text:JSON.stringify({ok:false,error:{code:error.code || 'REQUEST_FAILED',message:error.message},...(error.requestId ? {meta:{requestId:error.requestId}} : {})})}]}; }
    },
  });
}

export async function main(args) {
  const options = {};
  let quiet = false;
  for (let i=0;i<args.length;i++) {
    const flag=args[i];
    if (['--debug','--quiet','-q'].includes(flag)) {
      if(flag==='--debug') options.debug=true; else quiet=true;
      args=[...args.slice(0,i),...args.slice(i+1)]; i--; continue;
    }
    if(['--timeout','--profile','-p'].includes(flag)) {
      const value=args[i+1];
      if(!value || value.startsWith('-')) throw new Error(flag+' requires a value');
      if(flag==='--timeout') {
        const seconds=Number(value);
        if(!Number.isFinite(seconds) || seconds<=0 || seconds>86400) throw new Error('--timeout must be between 0 and 86400 seconds (exclusive of zero)');
        options.timeoutMs=options.requestTimeoutMs=Math.max(1,Math.round(seconds*1000));
      } else {
        if(!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) throw new Error('Invalid profile name');
        process.env.CUSTOMERGPT_PROFILE=value;
      }
      args=[...args.slice(0,i),...args.slice(i+2)]; i--;
    }
  }
  const baseIndex = args.indexOf('--api-base');
  if (baseIndex !== -1) {
    if (!args[baseIndex+1]) throw new Error('--api-base requires an origin');
    process.env.CUSTOMERGPT_API_URL = normalizeBase(args[baseIndex+1]);
    args = [...args.slice(0,baseIndex),...args.slice(baseIndex+2)];
  }
  if (args.length === 1 && ['--version', '-v'].includes(args[0])) { console.log(version); return; }
  if (args[0] === '__complete') { console.log(completions(args.slice(1)).join('\n')); return; }
  // For "call", --json carries input; everywhere else it selects JSON output.
  const jsonFlag = args[0] !== 'call' && args.includes('--json');
  if (jsonFlag) args = args.filter(a => a !== '--json');
  const human = humanOutput(args, jsonFlag);
  const c = palette(useColor());
  const print = (result, action) => console.log(human ? render(action, result, c) : JSON.stringify(result));
  if (!args.length || args.includes('--help') || args.includes('-h') || args[0] === 'help') {
    const prefix = args.filter(a => !['--help','-h','help'].includes(a)).join(' ');
    console.log(help(prefix)); return;
  }
  if (args[0] === 'dashboard') {
    if (args.slice(1).some(a => a !== '--print')) throw new Error('Use dashboard [--print]');
    const url = new URL(process.env.CUSTOMERGPT_DASHBOARD_URL || DASHBOARD);
    if (url.protocol !== 'https:' && !['localhost','127.0.0.1'].includes(url.hostname)) throw new Error('CUSTOMERGPT_DASHBOARD_URL must use HTTPS');
    const open = human && !args.includes('--print');
    if (open) openBrowser(url.href);
    print({ok:true,data:{url:url.href,...(open ? {message:'Opening '+url.href} : {})}},'dashboard');
    return;
  }
  if (args[0] === 'completion') { process.stdout.write(completionScript(args[1])); return; }
  if (args[0] === 'doctor') { const result=await doctor(version,options); print(result,'doctor'); if(!result.ok) process.exitCode=1; return; }
  if (args[0] === 'profiles') { if(args.length>3) throw new Error('Too many profile arguments'); print({ok:true,data:await profiles(args[1],args[2])},'profiles'); return; }
  if (args[0] === 'login') {
    if (args.slice(1).some(a => !['--no-browser','--token-stdin','--read-only'].includes(a))) throw new Error('Use login [--no-browser | --token-stdin] [--read-only] [--api-base <origin>]');
    const saved = await readConfig();
    const base = normalizeBase(process.env.CUSTOMERGPT_API_URL || saved.base || DEFAULT_BASE);
    if (args.includes('--token-stdin')) {
      if (process.stdin.isTTY) throw new Error('Pipe your API key to login --token-stdin; do not pass it as an argument');
      let key = ''; for await (const chunk of process.stdin) { key += chunk; if (key.length > 8192) throw new Error('API key is too long'); }
      key = key.trim(); if (!key) throw new Error('API key is empty');
      await request('account_usage', {}, {...options,base, key});
      await saveConfig({base,key});
    } else await browserLogin(base,{noBrowser:args.includes('--no-browser'),timeoutMs:options.timeoutMs,...(args.includes('--read-only') ? {scope:'agents:read'} : {})});
    print({ok:true,data:{message:'Logged in to '+base+'. Run customergpt chatbots list.',base}},'login'); return;
  }
  if (args[0] === 'logout') { await logout(); print({ok:true,data:{message:'Saved session removed. Environment API keys are not changed.'}},'logout'); return; }
  if (args[0] === 'agent-guide') {
    console.log(JSON.stringify({workflow:['customergpt login','customergpt chatbots create "Support Bot" --url https://example.com --yes','customergpt knowledge website add https://example.com --chatbot <id> --yes --wait','customergpt messages send "What do you offer?" --chatbot <id> --yes','customergpt installation snippet --chatbot <id>'],anonymous:'customergpt onboarding start https://example.com --yes --wait',skill:{url:SKILL_URL,file:SKILL_FILE},commands,notes:['Read the skill before changing anything.','Use your own CustomerGPT account.','Return the preview URL to the human to claim anonymous drafts.','Never expose tokens. Use --dry-run before changes.']})); return;
  }
  if (args[0] === 'mcp') return mcp(options);
  if (!['call','actions'].includes(args[0])) args = parseCommand(args);
  if (args[0] === 'actions' && args.length === 1) { console.log(JSON.stringify(await request(undefined,undefined,options))); return; }
  let action, input = {}, flags;
  if (args[0] === 'onboarding' && args[1] === 'start' && args[2]) {
    action = 'onboarding_start'; input = {url:args[2]}; flags = args.slice(3);
  } else if (args[0] === 'call' && args[1]) { action = args[1]; flags = args.slice(2); }
  else throw new Error('Unknown command; use --help');
  let wait = false, waitAll = false;
  for (let i=0;i<flags.length;i++) {
    const flag = flags[i];
    if (flag === '--json' || flag === '--json-file') {
      const value = flags[++i];
      if (!value) throw new Error(flag + ' requires a value');
      const data = JSON.parse(flag === '--json-file' ? await readFile(value, 'utf8') : value);
      if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('--json must be an object');
      input = {...input,...data};
    } else if (flag === '--wait') wait = true;
    else if (flag === '--wait-all') waitAll = true;
    else if (!['--yes','--dry-run'].includes(flag)) throw new Error('Unknown option: ' + flag);
  }
  if (flags.includes('--yes')) input.confirm = true;
  if (flags.includes('--dry-run')) { input.dryRun = true; input.confirm = false; }
  if (action === 'sources_add') input = await attachFile(input);
  if (action === 'chatbots_update') input = await readSettingFiles(input);
  if (waitAll) {
    if (action !== 'training_status' || !input.chatbotId) throw new Error('--wait-all works only with training_status and a chatbotId');
    let last;
    const onProgress = status => {
      // Report only changes, so a long wait does not flood the log.
      const state = JSON.stringify(status.active.map(item => [item.sourceId ?? item.jobId, item.status]));
      if (quiet || state === last) return;
      last = state;
      if (!human) console.error(JSON.stringify({event:'training_progress',data:{chatbotId:status.chatbotId,idle:status.idle,active:status.active}}));
      else console.error(c.dim(status.idle ? 'Nothing is training.' : 'Training '+status.active.length+': '+status.active.map(item => item.name+' ('+item.status+')').join(', ')+'…'));
    };
    print({ok:true,data:await waitForTraining(input.chatbotId,{...options,onProgress})},action);
    return;
  }
  const result = await request(action,input,options);
  if (wait && result.data?.id && ['pending','running'].includes(result.data.status)) {
    // Report the handle immediately on stderr so a interrupted process can be resumed.
    if(!quiet) console.error(human ? c.dim('Training started (job '+result.data.id+'). Waiting for it to finish…') : JSON.stringify({event:'job_started',data:result.data}));
    result.data = await waitForJob(result.data,options);
  }
  print(result,action);
}

/** People at a terminal get tables; pipes, CI, --json and machine-oriented commands get JSON. */
export function humanOutput(args, jsonFlag, stdout = process.stdout, env = process.env) {
  if (jsonFlag || env.CUSTOMERGPT_OUTPUT === 'json') return false;
  if (env.CUSTOMERGPT_OUTPUT === 'human') return !['call','actions','agent-guide','mcp'].includes(args[0]);
  if (['call','actions','agent-guide','mcp'].includes(args[0])) return false;
  return Boolean(stdout.isTTY);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main(process.argv.slice(2)).catch(error => {
    const argv = process.argv.slice(2);
    if (humanOutput(argv, argv[0] !== 'call' && argv.includes('--json'), process.stderr)) console.error(renderError(error, palette(useColor(process.stderr))));
    else console.error(JSON.stringify({ok:false,error:{code:error.code || 'CLI_ERROR',message:error.message,...(error.hint ? {hint:error.hint} : {})}, ...(error.job ? {job:error.job} : {}), ...(error.training ? {training:error.training} : {}), ...(error.requestId ? {meta:{requestId:error.requestId}} : {})}));
    process.exitCode = 1;
  });
}
