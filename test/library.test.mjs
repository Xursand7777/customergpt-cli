import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createClient} from '@customergpt/cli';

test('public library export keeps client credentials isolated and forwards actions', async () => {
  const original = globalThis.fetch;
  const seen = [];
  globalThis.fetch = async (url, options) => {
    seen.push({url, options});
    return {ok:true, json:async () => options.method === 'GET' ? {actions:[]} : {ok:true,data:[]}};
  };
  try {
    const config = {base:'https://backend.example',key:'first-key'};
    const first = createClient(config);
    config.key = 'changed';
    const second = createClient({base:'https://second.example',key:'second-key'});
    assert.deepEqual(await first.actions(), {actions:[]});
    assert.deepEqual(await second.call('chatbots_list',{limit:5}), {ok:true,data:[]});
    assert.equal(seen[0].options.headers['X-Api-Key'],'first-key');
    assert.equal(seen[1].options.headers['X-Api-Key'],'second-key');
    assert.equal(seen[1].url,'https://second.example/api/v1/agents/actions/chatbots_list');
    assert.deepEqual(JSON.parse(seen[1].options.body),{limit:5});
  } finally { globalThis.fetch = original; }
});
