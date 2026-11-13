// @vitest-environment node
import { expect, it, vi } from 'vitest';
import { mkdtemp, realpath, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import WebSocket, { WebSocketServer } from 'ws';
import { createServer } from 'node:net';
import { RemoteRpcSession } from '../../server/remote/rpc-session.js';
import { ManagedAuthLoader } from '../../server/remote/managed-auth.js';
import { RemoteCanonicalLogin } from '../../server/remote/login.js';
import { RemoteController } from '../../server/remote/controller.js';
import { PrivateStore } from '../../server/remote/private-store.js';
import { RemoteRuntime } from '../../server/remote/runtime.js';
import { closeRemoteResource } from '../../server/remote/runtime-lifecycle.js';

async function until(check: () => boolean) {
  const deadline = performance.now() + 2000;
  while (!check()) {
    if (performance.now() >= deadline) throw new Error('隔离canonical等待超时');
    await new Promise(resolve => setTimeout(resolve, 2));
  }
}
async function fixture() {
  const root = await mkdtemp(join(await realpath(tmpdir()), 'canonical-settle-'));
  const wss = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise<void>(resolve => wss.once('listening', resolve));
  let initialize = 0;
  wss.on('connection', peer => {
    peer.on('message', bytes => {
      const value = JSON.parse(bytes.toString());
      if (value.method === 'initialize') {
        initialize++;
        peer.send(JSON.stringify({ id: value.id, result: { codexHome: root } }));
      }
      // login/start不响应，关闭必须同步撤销等待；不打开浏览器或操作真实账号。
    });
  });
  const session = await RemoteRpcSession.connectCanonical(`ws://127.0.0.1:${(wss.address() as any).port}`);
  const socket = (session as any).transport;
  const native = socket._socket;
  const destroy = native.destroy.bind(native);
  const spy = vi.spyOn(native, 'destroy').mockImplementation(() => native);
  let actualClose = false;
  socket.once('close', () => actualClose = true);
  return {
    root, session, socket, initialize: () => initialize, actualClose: () => actualClose,
    release() { spy.mockRestore(); destroy(); },
    async cleanup() {
      spy.mockRestore(); destroy(); session.close();
      for (const peer of wss.clients) peer.terminate();
      await new Promise<void>(resolve => wss.close(() => resolve()));
      await rm(root, { recursive: true, force: true });
    },
  };
}
function syntheticAuth() {
  const token = `${Buffer.from('{}').toString('base64url')}.${Buffer.from(JSON.stringify({ exp: Math.floor(Date.now() / 1000) + 3600, 'https://api.openai.com/auth': { chatgpt_account_id: 'workspace', chatgpt_account_user_id: 'account-user', user_id: 'user' } })).toString('base64url')}.synthetic`;
  return { auth_mode: 'chatgpt', tokens: { access_token: token, account_id: 'workspace' } };
}

it('RPC可信settled等待自有canonical WS实际close，原close仍同步返回', async () => {
  const f = await fixture();
  let finished = false;
  try {
    expect(f.session.close()).toBeUndefined();
    const barrier = Promise.resolve((f.session as any).settled?.()).then(() => finished = true);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(finished).toBe(false);
    expect(f.socket.readyState).toBe(2);
    f.release(); await barrier;
    expect(f.actualClose()).toBe(true);
  } finally { await f.cleanup(); }
});

it.each(['controller', 'managed-auth', 'login'] as const)('实际%s持有canonical时settled等待真实close，摘除后仍保留屏障', async kind => {
  const f = await fixture();
  let owner: any;
  let operation: Promise<unknown>;
  const options = { canonicalFactory: async () => f.session, operationTimeoutMs: 80 };
  if (kind === 'controller') {
    owner = new RemoteController({ ...options, store: new PrivateStore(join(f.root, 'remote')), managedAuth: {} as any, authProvider: {} as any });
    operation = owner.connection(0);
  } else if (kind === 'managed-auth') {
    owner = new ManagedAuthLoader({ ...options, readAuthFile: async () => syntheticAuth() });
    operation = owner.verifyIdentity();
  } else {
    owner = new RemoteCanonicalLogin({ ...options, timeoutMs: 1000, openBrowser: async () => { throw new Error('不应打开浏览器'); } });
    operation = owner.login();
  }
  void operation.catch(() => undefined);
  let finished = false;
  try {
    await until(() => f.initialize() > 0);
    if (kind !== 'login') await operation;
    await owner.close();
    const barrier = Promise.resolve(owner.settled?.()).then(() => finished = true);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(finished).toBe(false);
    f.release(); await barrier;
    expect(f.actualClose()).toBe(true);
  } finally { f.release(); await owner.close(); await owner.settled?.(); await operation.catch(() => undefined); await f.cleanup(); }
});

it.each(['controller', 'managed-auth', 'login'] as const)('实际%s等待工厂期间关闭：迟到canonical必须收回，settled不能提前完成', async kind => {
  const f = await fixture();
  let release!: (value: RemoteRpcSession) => void;
  let entered = false;
  const pending = new Promise<RemoteRpcSession>(resolve => release = resolve);
  const options = { canonicalFactory: () => { entered = true; return pending; }, operationTimeoutMs: 80 };
  let owner: any;
  let operation: Promise<unknown>;
  if (kind === 'controller') {
    owner = new RemoteController({ ...options, store: new PrivateStore(join(f.root, 'remote')), managedAuth: {} as any, authProvider: {} as any });
    operation = owner.connection(0);
  } else if (kind === 'managed-auth') {
    owner = new ManagedAuthLoader({ ...options, readAuthFile: async () => syntheticAuth() });
    operation = owner.verifyIdentity();
  } else {
    owner = new RemoteCanonicalLogin({ ...options, timeoutMs: 1000, openBrowser: async () => { throw new Error('不应打开浏览器'); } });
    operation = owner.login();
  }
  void operation.catch(() => undefined);
  let finished = false;
  try {
    await until(() => entered);
    await owner.close();
    const barrier = Promise.resolve(owner.settled?.()).then(() => finished = true);
    await new Promise(resolve => setTimeout(resolve, 20));
    expect(finished).toBe(false);
    release(f.session);
    await until(() => f.socket.readyState === 2);
    expect(f.initialize()).toBe(0);
    expect(finished).toBe(false);
    f.release(); await barrier;
    expect(f.actualClose()).toBe(true);
  } finally { release(f.session); f.release(); await owner.close(); await owner.settled?.(); await operation.catch(() => undefined); await f.cleanup(); }
});

it('resource.close同步throw也必须继续等待真实canonical settled', async () => {
  const f=await fixture();let finished=false;
  try {
    const barrier=closeRemoteResource({close(){f.session.close();throw new Error('synthetic-private-error');},settled:()=>Promise.resolve((f.session as any).settled?.())}).then(()=>finished=true);
    await new Promise(resolve=>setTimeout(resolve,20));expect(finished).toBe(false);expect(f.socket.readyState).toBe(2);f.release();await barrier;expect(f.actualClose()).toBe(true);
  } finally {await f.cleanup();}
});

it.each(['connection','managed-auth','controller','login'] as const)('%s canonical连接失败有界返回，但可信屏障等待未交付WS的真实关闭', async kind => {
  const root=await mkdtemp(join(await realpath(tmpdir()),'failed-canonical-'));
  const peers=new Set<any>();const server=createServer(peer=>{peers.add(peer);peer.on('data',()=>{});peer.on('close',()=>peers.delete(peer));});await new Promise<void>(resolve=>server.listen(0,'127.0.0.1',resolve));
  const url=`ws://127.0.0.1:${(server.address() as any).port}`;const terminate=WebSocket.prototype.terminate;
  let native:any;let destroy:(()=>void)|undefined;let nativeSpy:any;let actualClose=false;
  const spy=vi.spyOn(WebSocket.prototype,'terminate').mockImplementation(function(this:WebSocket){
    if(this.url===new URL(url).href&&!native){native=(this as any)._req?.socket??(this as any)._socket;if(native){destroy=native.destroy.bind(native);nativeSpy=vi.spyOn(native,'destroy').mockImplementation(()=>native);native.once('close',()=>actualClose=true);}}
    return terminate.call(this);
  });
  let owner:any;let operation:Promise<unknown>;
  if(kind==='connection'){operation=RemoteRpcSession.connectCanonical(url,{connectTimeoutMs:40});owner=operation;}
  else if(kind==='managed-auth'){owner=new ManagedAuthLoader({canonicalUrl:url,operationTimeoutMs:40});operation=owner.verifyIdentity();}
  else if(kind==='controller'){owner=new RemoteController({canonicalUrl:url,operationTimeoutMs:40,store:new PrivateStore(join(root,'remote')),managedAuth:{} as any,authProvider:{} as any});operation=owner.connection(0);}
  else{owner=new RemoteCanonicalLogin({canonicalUrl:url,operationTimeoutMs:40,timeoutMs:200});operation=owner.login();}
  let finished=false;
  try{
    const began=performance.now();await expect(operation).rejects.toBeDefined();expect(performance.now()-began).toBeLessThan(500);
    const barrier=Promise.resolve(owner.settled?.()).then(()=>finished=true);
    await until(()=>!!native);await new Promise(resolve=>setTimeout(resolve,20));expect(finished).toBe(false);expect(actualClose).toBe(false);
    nativeSpy.mockRestore();destroy!();await barrier;expect(actualClose).toBe(true);
  }finally{spy.mockRestore();nativeSpy?.mockRestore();destroy?.();await owner.close?.();await owner.settled?.();for(const peer of peers)peer.destroy();await new Promise<void>(resolve=>server.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});

it.each(['controller','managed-auth','login'] as const)('Runtime settled贯穿实际%s canonical关闭，原Runtime close有界', async kind => {
  const f=await fixture();const store=new PrivateStore(join(f.root,'remote'));let owner:any;let operation:Promise<unknown>;
  const runtime=new RemoteRuntime({store,canonicalUrl:'ws://127.0.0.1:1',cleanupTimeoutMs:10});const options={canonicalFactory:async()=>f.session,operationTimeoutMs:40};
  if(kind==='controller'){owner=new RemoteController({...options,store,managedAuth:{} as any,authProvider:{} as any});operation=owner.connection(0);(runtime as any).bundle={controller:owner,loader:{close(){}},oauth:{close(){}}};}
  else if(kind==='managed-auth'){owner=new ManagedAuthLoader({...options,readAuthFile:async()=>syntheticAuth()});operation=owner.verifyIdentity();(runtime as any).bundle={controller:{close(){}},loader:owner,oauth:{close(){}}};}
  else{owner=new RemoteCanonicalLogin({...options,timeoutMs:1000,openBrowser:async()=>{throw new Error('不应打开浏览器');}});operation=owner.login();(runtime as any).loginFlow=owner;}
  void operation.catch(()=>undefined);let finished=false;
  try{await until(()=>f.initialize()>0);if(kind!=='login')await operation;const began=performance.now();await runtime.close();expect(performance.now()-began).toBeLessThan(500);const barrier=runtime.settled().then(()=>finished=true);await new Promise(resolve=>setTimeout(resolve,20));expect(finished).toBe(false);f.release();await barrier;expect(f.actualClose()).toBe(true);}
  finally{f.release();await runtime.settled();await operation.catch(()=>undefined);await f.cleanup();}
});

it.each(['controller','managed-auth','login'] as const)('%s同一tick取消阻止尚未调用的真实canonical工厂', async kind => {
  const root=await mkdtemp(join(await realpath(tmpdir()),'pre-cancel-canonical-'));const wss=new WebSocketServer({host:'127.0.0.1',port:0});await new Promise<void>(resolve=>wss.once('listening',resolve));
  let factories=0;const options={canonicalFactory:()=>{factories++;return RemoteRpcSession.connectCanonical(`ws://127.0.0.1:${(wss.address() as any).port}`);},operationTimeoutMs:40};
  let owner:any;let operation:Promise<unknown>;
  if(kind==='controller'){owner=new RemoteController({...options,store:new PrivateStore(join(root,'remote')),managedAuth:{} as any,authProvider:{} as any});operation=owner.connection(0);}
  else if(kind==='managed-auth'){owner=new ManagedAuthLoader(options);operation=owner.verifyIdentity();}
  else{owner=new RemoteCanonicalLogin({...options,timeoutMs:200});operation=owner.login();}
  void operation.catch(()=>undefined);
  try{await owner.close();await owner.settled?.();await operation.catch(()=>undefined);expect(factories).toBe(0);}
  finally{await owner.close();await owner.settled?.();for(const peer of wss.clients)peer.terminate();await new Promise<void>(resolve=>wss.close(()=>resolve()));await rm(root,{recursive:true,force:true});}
});

it.each(['controller','managed-auth','login'] as const)('%s工厂已兑现但取消使会话未交付：保留实际关闭屏障', async kind => {
  const f=await fixture();let owner:any;let finished=false;let operation:Promise<unknown>;
  const options={canonicalFactory:async()=>{void Promise.resolve(owner.close()).catch(()=>undefined);return f.session;},operationTimeoutMs:40};
  if(kind==='controller'){owner=new RemoteController({...options,store:new PrivateStore(join(f.root,'remote')),managedAuth:{} as any,authProvider:{} as any});operation=owner.connection(0);}
  else if(kind==='managed-auth'){owner=new ManagedAuthLoader({...options,readAuthFile:async()=>syntheticAuth()});operation=owner.verifyIdentity();}
  else{owner=new RemoteCanonicalLogin({...options,timeoutMs:200});operation=owner.login();}
  try{await expect(operation).rejects.toBeDefined();const barrier=owner.settled().then(()=>finished=true);await new Promise(resolve=>setTimeout(resolve,20));expect(f.initialize()).toBe(0);expect(finished).toBe(false);f.release();await barrier;expect(f.actualClose()).toBe(true);}
  finally{f.release();await owner.close();await owner.settled();await f.cleanup();}
});
