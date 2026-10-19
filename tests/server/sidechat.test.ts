import { createServer } from 'node:http';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, expect, it } from 'vitest';
import WebSocket, { WebSocketServer } from 'ws';
import { createGateway } from '../../server/gateway.js';
const cleanup: (() => Promise<void>)[] = [];
afterEach(async () => { for(const fn of cleanup.splice(0).reverse()) await fn(); });
async function fixture() {
 const root=await mkdtemp(join(tmpdir(),'sidechat-server-')); cleanup.push(()=>rm(root,{recursive:true,force:true}));
 const http=createServer(); const ws=new WebSocketServer({server:http}); const connections:WebSocket[]=[];const requests:any[]=[];
 ws.on('connection',socket=>{connections.push(socket);socket.on('message',raw=>{const m=JSON.parse(String(raw));requests.push(m);if(m.id==null)return;
 const result=m.method==='thread/fork'?{thread:{id:'side',ephemeral:true,cwd:'/work',turns:[{id:'base',items:[{text:'继承旧正文'}]}]},model:'gpt'}:m.method==='turn/start'?{turn:{id:'new',status:'inProgress',items:[]}}:{};
 socket.send(JSON.stringify({id:m.id,result}));
 });});
 await new Promise<void>(resolve=>http.listen(0,'127.0.0.1',resolve));cleanup.push(async()=>{connections.forEach(s=>s.terminate());await new Promise<void>(resolve=>ws.close(()=>resolve()));await new Promise<void>(resolve=>http.close(()=>resolve()));});
 const options={host:'127.0.0.1',port:0,mode:'external' as const,upstreamUrl:`ws://127.0.0.1:${(http.address() as any).port}`,staticDir:null,codexHome:root,accessToken:'test'};
 let gateway=await createGateway(options);cleanup.push(()=>gateway.close());
 let session=randomUUID();
 const rpc=async(method:string,params:any,requestId=randomUUID())=>(await fetch(`http://127.0.0.1:${gateway.port}/api/rpc?sessionId=${session}&token=test`,{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({requestId,message:{id:requestId,method,params}})})).json() as Promise<any>;
 const side=(method:string,params:any={})=>rpc('mobile/sidechat/rpc',{method,params});
 return {root,requests,connections,rpc,side,newClient:()=>{session=randomUUID();},restart:async()=>{await gateway.close();gateway=await createGateway(options);},send:(message:any)=>connections.at(-1)!.send(JSON.stringify(message))};
}
async function allText(root:string):Promise<string> { let text='';for(const entry of await readdir(root,{withFileTypes:true})){const p=join(root,entry.name);text+=entry.isDirectory()?await allText(p):await readFile(p,'utf8');}return text; }
const fork={threadId:'main',lastTurnId:'base',ephemeral:true,excludeTurns:true,developerInstructions:'SIDECHAT_PRIVATE_INSTRUCTION'};
it('daemon内存保存新增消息，App换连接可读；重启后明确失效且不重建',async()=>{
 const f=await fixture(); const created=await f.side('thread/fork',fork);expect(created.result.thread.id).toBe('side');
 f.send({method:'turn/started',params:{threadId:'side',turn:{id:'new',status:'inProgress',items:[]}}});
 f.send({method:'item/completed',params:{threadId:'side',turnId:'new',item:{id:'answer',type:'agentMessage',text:'SIDECHAT_PRIVATE_BODY'}}});
 f.send({method:'turn/completed',params:{threadId:'side',turn:{id:'new',status:'completed'}}});
 await new Promise(r=>setTimeout(r,50));f.newClient();const read=await f.side('read',{threadId:'side'});
 expect(read.error).toBeUndefined();expect(read.result.thread.turns).toHaveLength(1);expect(read.result.thread.turns[0].items[0].text).toBe('SIDECHAT_PRIVATE_BODY');
 const disk=await allText(f.root);expect(disk).not.toContain('SIDECHAT_PRIVATE_BODY');expect(disk).not.toContain('SIDECHAT_PRIVATE_INSTRUCTION');
 await f.restart();expect((await f.side('read',{threadId:'side'})).error.message).toContain('失效');
 expect(f.requests.filter(r=>r.method==='thread/fork')).toHaveLength(1);
});
it('Sidechat发送不写操作WAL，关闭清理；普通聊天继续持久化操作',async()=>{
 const f=await fixture();await f.side('thread/fork',fork);
 await f.side('turn/start',{threadId:'side',input:[{type:'text',text:'SIDECHAT_INPUT_SECRET'}]});
 expect(await allText(f.root)).not.toContain('SIDECHAT_INPUT_SECRET');
 expect((await f.side('thread/unsubscribe',{threadId:'side'})).error).toBeUndefined();
 expect((await f.side('read',{threadId:'side'})).error.message).toContain('失效');
 await f.rpc('initialize',{clientInfo:{name:'test',version:'1'}});
 await f.rpc('turn/start',{threadId:'normal',input:[{type:'text',text:'NORMAL_DURABLE'}]});
 // 普通WAL可保留响应；请求正文原实现不保存，但目录必须存在且至少一个持久记录。
 const files=await readdir(join(f.root,'codex-mobile-http'),{recursive:true});expect(files.some(p=>String(p).endsWith('.json'))).toBe(true);
});
