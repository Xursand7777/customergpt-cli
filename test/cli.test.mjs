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
