import {CustomerGPT} from '@customergpt/sdk';
import {connection} from './config.mjs';
import {tracedFetch, requestIdOf} from './diagnostics.mjs';
import {clientHeaders} from './version.mjs';

function hint(error) {
  if (error.status === 401) return 'Run customergpt login or set CUSTOMERGPT_API_KEY.';
  if (error.status === 404) return 'Check CUSTOMERGPT_API_URL and deploy the CustomerGPT agents module on the server.';
  if (error.code === 'NETWORK_ERROR' || error.code === 'TIMEOUT') return 'Check your connection and CUSTOMERGPT_API_URL, or raise --timeout.';
  if (/did not return JSON/.test(error.message)) return 'Check your API origin and deployment.';
  return 'Run customergpt actions to inspect supported inputs.';
}

// HTTP goes through @customergpt/sdk; the CLI adds saved credentials, debug tracing and hints.
export async function request(action, input, options = {}) {
  const {base, key} = await connection(options);
  let requestId;
  const client = new CustomerGPT({
    baseUrl: base,
    apiKey: key ?? '',
    timeoutMs: options.requestTimeoutMs ?? 180000,
    fetch: async (url, init) => {
      const response = await tracedFetch(url, {...init, headers: {...init.headers, ...clientHeaders(options.mode)}}, options.debug);
      requestId = requestIdOf(response);
      return response;
    },
  });
  try {
    return action === undefined ? {actions: await client.actions.list()} : await client.call(action, input);
  } catch (error) {
    error.hint = hint(error);
    // Newer SDKs read it from the envelope; otherwise use the response header.
    error.requestId ??= requestId;
    throw error;
  }
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
      if ((error.name === 'TimeoutError' || error.code === 'TIMEOUT') && Date.now() >= deadline) error.code = 'WAIT_TIMEOUT';
      throw error;
    }
    current = response.data;
  }
  if (current.status === 'failed') { const error = new Error(current.error || 'Training failed'); error.code = 'TRAINING_FAILED'; error.job = {...data, ...current}; throw error; }
  return {...data, ...current};
}

const trainingKey = item => item.sourceId ?? item.jobId;

/** Poll training_status until nothing trains for the bot; fail if training seen during the wait failed. */
export async function waitForTraining(chatbotId, options = {}) {
  const started = Date.now(), deadline = started + (options.timeoutMs ?? 900000);
  const seen = new Map();
  const resume = (error, active) => {
    error.code = 'WAIT_TIMEOUT';
    error.hint = 'Resume with: customergpt knowledge wait --chatbot '+chatbotId;
    error.training = {chatbotId, active};
    return error;
  };
  let since, status;
  for (;;) {
    try {
      status = (await (options.request || request)('training_status', {chatbotId}, {...options,requestTimeoutMs:Math.min(options.requestTimeoutMs ?? 180000, Math.max(1,deadline-Date.now()))})).data;
    } catch (error) {
      if ((error.name === 'TimeoutError' || error.code === 'TIMEOUT') && Date.now() >= deadline) throw resume(error, status?.active ?? []);
      error.training = {chatbotId, active:status?.active ?? []};
      throw error;
    }
    // Failures from before the first check belong to earlier training, not this wait.
    since ??= Date.parse(status.checkedAt);
    for (const item of status.active) seen.set(trainingKey(item), item);
    options.onProgress?.(status);
    if (status.idle) break;
    await new Promise(resolve => setTimeout(resolve, Math.min(options.intervalMs ?? 3000, Math.max(0, deadline-Date.now()))));
    if (Date.now() >= deadline) throw resume(new Error(status.active.length+' training run(s) still in progress'), status.active);
  }
  const failed = status.failed.filter(item => seen.has(item.sourceId) || seen.has(item.jobId) || Date.parse(item.failedAt) >= since);
  const failedKeys = new Set(failed.map(trainingKey));
  const trained = [...seen.values()].filter(item => !failedKeys.has(trainingKey(item))).map(({jobId, sourceId, name}) => ({jobId, sourceId, name}));
  const result = {chatbotId, idle:true, active:[], trained, failed, waitedMs:Date.now()-started};
  if (failed.length) {
    const error = new Error(failed.length+' training run(s) failed: '+failed.map(item => item.name).join(', '));
    error.code = 'TRAINING_FAILED';
    error.hint = 'Fix the source, then retry with knowledge documents resync or add it again.';
    error.training = result;
    throw error;
  }
  return result;
}

export function createClient(options = {}) {
  const config = {...options};
  return Object.freeze({
    actions: () => request(undefined, undefined, config),
    call: (action, input = {}) => request(action, input, config),
    waitForJob: (job, polling = {}) => waitForJob(job, {...config, ...polling}),
    waitForTraining: (chatbotId, polling = {}) => waitForTraining(chatbotId, {...config, ...polling}),
  });
}
