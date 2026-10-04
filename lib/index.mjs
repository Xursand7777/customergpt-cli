import {connection} from './config.mjs';
import {tracedFetch} from './diagnostics.mjs';
export async function request(action, input, options = {}) {
  const {base, key} = await connection(options);
  const response = await tracedFetch(base + '/api/v1/agents/actions' + (action ? '/' + encodeURIComponent(action) : ''), {
    method: action ? 'POST' : 'GET', redirect: 'error', signal: AbortSignal.timeout(options.requestTimeoutMs ?? 180000),
    headers: { 'Content-Type': 'application/json', ...(key ? {'X-Api-Key': key} : {}) },
    ...(action ? {body:JSON.stringify(input)} : {}),
  }, options.debug);
  const result = await response.json().catch(() => ({message:'The server did not return JSON. Check your API origin and deployment.'}));
  if (!response.ok || result.ok === false) {
    const error = new Error(result.error?.message || result.message || 'Request failed');
    error.code = result.error?.code || 'HTTP_' + response.status;
    error.hint = response.status === 401 ? 'Run customergpt login or set CUSTOMERGPT_API_KEY.' : response.status === 404 ? 'Check CUSTOMERGPT_API_URL and deploy the CustomerGPT agents module on the server.' : 'Run customergpt actions to inspect supported inputs.';
    throw error;
  }
  return result;
}

export async function waitForJob(data, options = {}) {
  const deadline = Date.now() + (options.timeoutMs ?? 900000);
  let current = data;
  while (['pending','running'].includes(current.status)) {
    if (Date.now() >= deadline) { const error = new Error('Training still running; resume with jobs_get and the job ID'); error.code = 'WAIT_TIMEOUT'; error.job = data; throw error; }
    await new Promise(resolve => setTimeout(resolve, Math.min(options.intervalMs ?? 3000, Math.max(0, deadline-Date.now()))));
    if (Date.now() >= deadline) { const error=new Error('Training still running; resume with jobs_get and the job ID'); error.code='WAIT_TIMEOUT'; error.job=data; throw error; }
    let response;
    try {
      response = await (options.request || request)('jobs_get', {jobId:data.id, ...(data.token ? {token:data.token} : {})}, {...options,requestTimeoutMs:Math.min(options.requestTimeoutMs ?? 180000, Math.max(1,deadline-Date.now()))});
    } catch (error) {
      error.job = {...data,...current};
      if (error.name === 'TimeoutError' && Date.now() >= deadline) error.code = 'WAIT_TIMEOUT';
      throw error;
    }
    current = response.data;
  }
  if (current.status === 'failed') { const error = new Error(current.error || 'Training failed'); error.code = 'TRAINING_FAILED'; error.job = {...data, ...current}; throw error; }
  return {...data, ...current};
}

export function createClient(options = {}) {
  const config = {...options};
  return Object.freeze({
    actions: () => request(undefined, undefined, config),
    call: (action, input = {}) => request(action, input, config),
    waitForJob: (job, polling = {}) => waitForJob(job, {...config, ...polling}),
  });
}
