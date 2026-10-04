import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {fileURLToPath} from 'node:url';
import {Client} from '@modelcontextprotocol/sdk/client/index.js';
import {StdioClientTransport} from '@modelcontextprotocol/sdk/client/stdio.js';

test('local MCP server negotiates stdio, discovers tools and forwards requests to REST',async()=>{
  const seen=[];
  const server=createServer(async(req,res)=>{
    res.setHeader('Content-Type','application/json');
    if(req.method==='GET')return res.end(JSON.stringify({actions:[{name:'jobs_get',description:'Read a job',authentication:'optional',inputSchema:{type:'object',properties:{jobId:{type:'string'}},required:['jobId']}}]}));
    let body='';for await(const chunk of req)body+=chunk;seen.push({url:req.url,body:JSON.parse(body)});
    res.end(JSON.stringify({ok:true,data:{id:'job',status:'ready'}}));
  });
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const address=server.address();
  const transport=new StdioClientTransport({command:process.execPath,args:[fileURLToPath(new URL('../bin/customergpt.mjs',import.meta.url)),'mcp'],env:{CUSTOMERGPT_API_URL:'http://127.0.0.1:'+address.port},stderr:'pipe'});
  const client=new Client({name:'cli-test',version:'1'});
  try {
    await client.connect(transport);
    const tools=await client.listTools();assert.equal(tools.tools[0].name,'jobs_get');
    const result=await client.callTool({name:'jobs_get',arguments:{jobId:'job'}});
    assert.equal(JSON.parse(result.content[0].text).data.status,'ready');
    assert.deepEqual(seen,[{url:'/api/v1/agents/actions/jobs_get',body:{jobId:'job'}}]);
  }finally{await client.close();await new Promise(resolve=>server.close(resolve));}
});
