import { NativeRuntime, publishNativeSnapshot } from '../../src/native-ui/runtime';

// 使用真实运行时和原生注入的发布函数，不能先 stringify：它会把 NaN 隐藏为 null。
const runtime = new NativeRuntime(publishNativeSnapshot);
runtime.setNavigation({ selectedBackendId: 'b', backends: [], groups: [] }, {
  'thread.summarize': params => {
    if (params.threadId === 'old-gateway') throw new Error('请升级网关服务器');
    return '候选名称';
  },
});
async function run() {
  for (const [id, threadId, extra] of [
    ['summary', 't', {}],
    ['old-gateway', 'old-gateway', {}],
    ['invalid-revision', 't', { fieldRevision: NaN }],
    ['valid-revision', 't', { fieldRevision: 7 }],
  ] as const) {
    await runtime.dispatch({ id, name: 'thread.summarize', params: { backendId: 'b', threadId, fieldKey: 'rename-1', ...extra } });
    publishNativeSnapshot(runtime.snapshot());
  }
  runtime.dispose();
}
void run();
