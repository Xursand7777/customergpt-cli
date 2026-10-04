import {readFile, mkdir, writeFile, rename, rm} from 'node:fs/promises';
import {homedir} from 'node:os';
import {join, dirname} from 'node:path';
import {randomUUID} from 'node:crypto';
import {clientHeaders} from './version.mjs';

export const DEFAULT_BASE = 'https://api.customergpt.ai';
export const configPath = () => process.env.CUSTOMERGPT_CONFIG_FILE || join(homedir(), '.config', 'customergpt', 'config.json');
export function normalizeBase(value) {
  const url = new URL(value);
  if (url.username || url.password || url.search || url.hash || !['','/'].includes(url.pathname)) throw new Error('API base must be an origin without /api, credentials or query parameters');
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(url.hostname))) throw new Error('Use HTTPS except for a local development server');
  return url.origin;
}
async function readStore() {
  try { return JSON.parse(await readFile(configPath(), 'utf8')); }
  catch (error) { if (error.code === 'ENOENT') return {}; throw new Error('Cannot read CustomerGPT config. Check file permissions and JSON format'); }
}
async function saveStore(value) {
  const path = configPath();
  await mkdir(dirname(path), {recursive:true, mode:0o700});
  const temp = path + '.' + randomUUID() + '.tmp';
  try { await writeFile(temp, JSON.stringify(value, null, 2) + '\n', {mode:0o600, flag:'wx'}); await rename(temp, path); }
  finally { await rm(temp, {force:true}); }
}

function profileName(value) {
  if (!/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,63}$/.test(value)) throw new Error('Profile names must contain 1-64 letters, digits, underscores or hyphens');
  return value;
}
async function store() {
  const old = await readStore();
  return old.profiles ? old : {active:'default',profiles:{default:old}};
}
export async function selectedProfile() {
  const data = await store();
  return profileName(process.env.CUSTOMERGPT_PROFILE || data.active || 'default');
}
export async function readConfig() {
  const data = await store();
  const name = await selectedProfile();
  return Object.hasOwn(data.profiles,name) ? data.profiles[name] : {};
}
export async function saveConfig(value) {
  const data = await store();
  const name = await selectedProfile();
  Object.defineProperty(data.profiles,name,{value,enumerable:true,configurable:true,writable:true});
  await saveStore(data);
}
export async function profiles(operation, name) {
  const data = await store();
  if (operation === 'list') return {active:data.active,selected:await selectedProfile(),items:Object.entries(data.profiles).map(([name,value])=>({name,base:value.base || DEFAULT_BASE,authenticated:Boolean(value.key)}))};
  if (operation !== 'use' || !name) throw new Error('Usage: customergpt profiles list | profiles use <name>');
  profileName(name);
  if (!Object.hasOwn(data.profiles,name)) throw new Error('Unknown profile. Create it with customergpt login --profile '+name);
  data.active = name;
  await saveStore(data);
  return {active:name};
}

export async function connection(override = {}) {
  const saved = await readConfig();
  const base = normalizeBase(override.base || process.env.CUSTOMERGPT_API_URL || saved.base || DEFAULT_BASE);
  // Never forward saved credentials to a different server selected via an override.
  const matching = saved.base === base;
  let key = override.key ?? process.env.CUSTOMERGPT_API_KEY;
  if (key === undefined && matching) {
    key = saved.key;
    if (saved.refreshToken && saved.expiresAt <= Date.now() + 60000) {
      const tokens = await oauthPost(base, '/token', {grant_type:'refresh_token', client_id:saved.clientId, refresh_token:saved.refreshToken, resource:base + '/api/mcp'});
      saved.key = key = tokens.access_token;
      saved.refreshToken = tokens.refresh_token || saved.refreshToken;
      saved.expiresAt = Date.now() + tokens.expires_in * 1000;
      await saveConfig(saved);
    }
  }
  return {base, key};
}
export async function oauthPost(base, path, data, json = false) {
  const response = await fetch(normalizeBase(base) + path, {method:'POST', redirect:'error', signal:AbortSignal.timeout(30000), headers:{'Content-Type':json ? 'application/json' : 'application/x-www-form-urlencoded',...clientHeaders()}, body:json ? JSON.stringify(data) : new URLSearchParams(data)});
  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(result.error_description || result.message || 'Authentication failed (HTTP ' + response.status + '). Check the API address and deployed agents module.');
  return result;
}
