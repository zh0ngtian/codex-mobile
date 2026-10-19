import { describe, expect, it } from 'vitest';
import { projectConversation, projectNavigation, insertNativeMention } from '../../src/native-ui/projection';
import { aggregateThreads } from '../../src/features/threads/thread-list-model';
import { PROJECTLESS_GROUP_ID } from '../../src/app-server/thread-list-loader';

function navigation(overrides: Partial<Parameters<typeof projectNavigation>[0]> = {}) {
 return projectNavigation({ threads: [], listBackendId: 'all', selectedBackendId: 'a', projectDirectories: [], hasProjectlessThreads: false,
  collapsedProjectKeys: new Set(), projectThreadStates: {}, projectHasMore: {}, loadingProjectKeys: new Set(), ...overrides });
}

it('默认导航同时保留关注、权威设备项目顺序和最近，关注也留在原项目，不二次截断分页', () => {
 const backends = [{ id: 'b', name: '乙' }, { id: 'a', name: '甲' }];
 const threads = aggregateThreads(backends, { b: [{ id: 'pin', cwd: '/b', isPinned: true }, ...Array.from({ length: 7 }, (_, i) => ({ id: `t${i}`, cwd: '/b' }))] });
 const groups = navigation({ threads, backends, backendSnapshots: {
  b: { projects: ['/empty', '/b'], projectlessThreadIds: ['unloaded'], projectThreadStates: { '/empty': 'loading' }, projectHasMore: { '/b': true } },
  a: { projects: ['C:\\Work\\One'], projectlessThreadIds: [], projectThreadStates: {}, projectHasMore: {} },
 } });
 expect(groups.map(group => group.id)).toEqual(['favorites', `b:${PROJECTLESS_GROUP_ID}`, 'b:/empty', 'b:/b', 'a:C:\\Work\\One', 'recent']);
 expect(groups[0]).toMatchObject({ category: 'pinned', items: [{ id: 'b:pin' }] });
 expect(groups.find(group => group.id === 'b:/b')?.items).toHaveLength(8);
 expect(groups.find(group => group.id === 'b:/empty')).toMatchObject({ category: 'project', title: 'empty', subtitle: '乙', loading: 'loading', items: [], newCommand: { name: 'thread.new', params: { backendId: 'b', cwd: '/empty' } } });
 expect(groups.find(group => group.id === `b:${PROJECTLESS_GROUP_ID}`)?.newCommand?.params.cwd).toBe('');
 expect(groups.find(group => group.id === 'a:C:\\Work\\One')?.title).toBe('One');
 expect(groups.at(-1)).toMatchObject({ category: 'recent', items: expect.not.arrayContaining([expect.objectContaining({ id: 'b:pin' })]) });
});

it('有搜索词时只出现搜索结果组，搜索完成仍保持搜索类别并且没有重复关注或空项目', () => {
 const threads = aggregateThreads([{ id: 'a', name: '甲' }], { a: [{ id: 'p', cwd: '/p', isPinned: true }] });
 for (const searching of [true, false]) {
  const groups = navigation({ threads, query: '匹配', searching, backends: [{ id: 'a', name: '甲' }], filter: 'projects' });
  expect(groups).toHaveLength(1); expect(groups[0]).toMatchObject({ id: 'search', category: 'search', items: [{ id: 'a:p' }] });
  expect(groups[0].title).toBe(searching ? '搜索中…' : '搜索结果');
  expect(groups[0].loading).toBe(searching ? 'loading' : undefined);
 }
 expect(navigation({ query: '没有匹配' })[0]).toMatchObject({ category: 'search', items: [] });
 const failed = navigation({ query: '失败', error: '设备连接中断' });
 expect(failed).toHaveLength(1);
 expect(failed[0]).toMatchObject({ category: 'search', subtitle: '设备连接中断', actions: [{ command: { name: 'navigation.refresh' } }] });
});

it('单设备与现有关注/项目筛选仍保留分类，折叠不移除项目新建目标', () => {
 const threads = aggregateThreads([{ id: 'a', name: '甲' }], { a: [{ id: 'p', cwd: '/p', isPinned: true }] });
 const input = { threads, listBackendId: 'a', projectDirectories: ['/p'], collapsedProjectKeys: new Set(['a:/p']) };
 expect(navigation({ ...input, filter: 'favorites' }).map(group => group.category)).toEqual(['pinned']);
 const project = navigation({ ...input, filter: 'projects' }).find(group => group.category === 'project');
 expect(project).toMatchObject({ collapsed: true, items: [], newCommand: { params: { backendId: 'a', cwd: '/p' } } });
 expect(navigation(input).map(group => group.category)).toEqual(['pinned', 'project', 'recent']);
});

it('折叠项目不暴露分页、重试和加载状态，展开后恢复真实动作', () => {
 const input = { listBackendId: 'a', projectDirectories: ['/p'], projectHasMore: { '/p': true }, projectThreadStates: { '/p': 'error' as const }, loadingProjectKeys: new Set<string>() };
 const folded = navigation({ ...input, collapsedProjectKeys: new Set(['a:/p']) }).find(g => g.id === 'a:/p')!;
 expect(folded.actions).toEqual([]); expect(folded.loading).toBeUndefined();
 const expanded = navigation(input).find(g => g.id === 'a:/p')!;
 expect(expanded.actions?.map(a => a.command?.name)).toEqual(['project.retry', 'project.more']);
 expect(expanded.actions?.[1].command?.params).toEqual({ backendId: 'a', cwd: '/p' });
 const loading = navigation({ ...input, projectThreadStates: { '/p': 'ready' }, loadingProjectKeys: new Set(['a:/p']) }).find(g => g.id === 'a:/p')!;
 expect(loading.actions?.[0]).toMatchObject({ title: '加载中…', disabled: true });
});

it('消息时间优先使用真实发送时间，其次turn开始时间，未知时间不填当前时间', () => {
 const turns = [{ id: 'known', startedAt: 100, completedAt: 150, items: [{ id: 'u', type: 'userMessage', text: '问' }, { id: 'c', type: 'agentMessage', phase: 'commentary', text: '过程' }, { id: 'f', type: 'agentMessage', phase: 'final_answer', text: '答' }] },
  { id: 'unknown', items: [{ id: 'u2', type: 'userMessage', text: '再问' }, { id: 'f2', type: 'agentMessage', phase: 'final_answer', text: '再答' }] }];
 const messages = projectConversation({ turns }, path => path);
 expect(messages.find(message => message.id === 'known:u')?.timestamp).toBe(100);
 expect(messages.find(message => message.id === 'known:f')?.timestamp).toBe(150);
 const explicit = projectConversation({ turns: [{ id: 'sent', startedAt: 100, items: [{ id: 'u', type: 'userMessage', text: '问', timestamp: 120 }] }] }, path => path);
 expect(explicit[0]?.timestamp).toBe(120);
 const fallback = projectConversation({ turns: [{ id: 'sent', startedAt: 100, items: [{ id: 'u', type: 'userMessage', text: '问', timestamp: -1 }] }] }, path => path);
 expect(fallback[0]?.timestamp).toBe(100);
 expect(messages.filter(message => message.id.startsWith('unknown:')).every(message => message.timestamp === undefined)).toBe(true);
 for (const timestamp of [0, -1, Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY]) {
  const invalid = projectConversation({ turns: [{ id: 'invalid', startedAt: timestamp, completedAt: timestamp, items: [{ id: 'u', type: 'userMessage', text: '问' }, { id: 'f', type: 'agentMessage', phase: 'final_answer', text: '答' }] }] }, path => path);
  expect(invalid.every(message => message.timestamp === undefined)).toBe(true);
 }
});

describe('真实业务原生投影', () => {
  it('final立即可见且只将commentary折叠，reasoning/tool/diff不计入历史条数，保留用户图片', () => {
    const messages = projectConversation({ id: 't', turns: [{ id: 'turn', status: 'inProgress', startedAt: 1, items: [
      { id: 'u', type: 'userMessage', content: [{ type: 'text', text: '你好' }, { type: 'image', url: 'data:image/png;base64,YQ==' }] },
      { id: 'c', type: 'agentMessage', phase: 'commentary', text: '我先检查' },
      { id: 'r', type: 'reasoning', text: '推理' }, { id: 'tool', type: 'commandExecution', command: 'ls' },
      { id: 'f', type: 'agentMessage', phase: 'final_answer', text: '最终回答' },
    ] }] }, path => 'https://example.invalid/image?path=' + path);
    expect(messages.find(m => m.id === 'turn:f')?.text).toBe('最终回答');
    const history = messages.find(m => m.blocks?.some(b => b.kind === 'disclosure' && b.title?.includes('历史过程')))!.blocks!.find(b => b.kind === 'disclosure')!;
    expect(history.title).toContain('1'); expect(history.children).toHaveLength(1);
    expect(messages.find(m => m.role === 'user')?.blocks?.[0]).toMatchObject({ kind: 'image', value: 'data:image/png;base64,YQ==' });
    expect(messages.flatMap(m => m.blocks ?? []).find(b => b.id.endsWith(':reasoning'))?.children?.[0]?.text).toBe('推理');
  });
  it('延续turn使用已有分组且稳定id，多个最终正文与普通图片都保留', () => {
    const active = { id: 't', turns: [
      { id: 'first', items: [{ id: 'u', type: 'userMessage', content: [{ type: 'text', text: '用户' }] }, { id: 'f1', type: 'agentMessage', phase: 'final_answer', text: '第一段' }] },
      { id: 'continuation', items: [{ id: 'f2', type: 'agentMessage', phase: 'final_answer', text: '第二段' }, { id: 'img', type: 'imageGeneration', savedPath: '/tmp/a.png' }] },
    ] };
    const messages = projectConversation(active, path => `https://resource.invalid/${path}`);
    expect(messages.map(m => m.id)).toContain('first:f2');
    expect(messages.flatMap(m => m.blocks ?? []).some(b => b.value?.includes('/tmp/a.png'))).toBe(true);
    expect(messages.map(m => m.text)).toEqual(expect.arrayContaining(['第一段', '第二段']));
  });
  it('全部设备/关注与项目导航使用真实列表与折叠分页状态，不泄漏设备配置', () => {
    const threads = aggregateThreads([{ id: 'b', name: 'Mac' }], { b: [
      { id: 'p', name: '关注', isPinned: true }, { id: 't', name: '运行', cwd: '/a', status: { type: 'active' } },
    ] });
    const groups = projectNavigation({ threads, listBackendId: 'b', selectedBackendId: 'b', activeThreadId: 't',
      projectDirectories: ['/a', '/empty'], hasProjectlessThreads: true, collapsedProjectKeys: new Set(['b:/a']),
      projectThreadStates: { '/empty': 'error' }, projectHasMore: { '/a': true }, loadingProjectKeys: new Set() });
    expect(groups.find(g => g.id === 'favorites')?.items[0].title).toBe('关注');
    expect(groups.find(g => g.id === 'b:/a')).toMatchObject({ collapsed: true, items: [], command: { name: 'project.toggle' } });
    expect(groups.find(g => g.id === 'b:/empty')?.actions?.[0].command?.name).toBe('project.retry');
    expect(JSON.stringify(groups)).not.toContain('token');
  });
  it('Skill/Plugin插入复用现有mention语法，普通文本后也可通过搜索面板插入', () => {
    const skill = { name: 'swift', path: '/skills/swift', description: '', enabled: true, scope: 'user' as const };
    expect(insertNativeMention('请 @sw', { kind: 'skill', skill })).toBe('请 $swift ');
    const plugin = { id: 'p', name: 'github', installed: true, enabled: true, availability: 'AVAILABLE' };
    expect(insertNativeMention('检查', { kind: 'plugin', plugin })).toBe('检查 @github ');
  });
});

it('引导后运行时旧final保留原身份并收入过程，最新commentary直接显示', () => {
 const messages = projectConversation({ id: 't', turns: [{ id: 'turn', status: 'inProgress', items: [
  { id: 'u1', type: 'userMessage', content: [{ type: 'text', text: '第一问' }] },
  { id: 'a1', type: 'agentMessage', phase: 'final_answer', text: '第一答' },
  { id: 'u2', type: 'userMessage', content: [{ type: 'text', text: '插话' }] },
  { id: 'c2', type: 'agentMessage', phase: 'commentary', text: '继续检查' },
 ] }] }, path => path);
 expect(messages.filter(m => m.role === 'user').map(m => m.text)).toEqual(['第一问', '插话']);
 const oldAnswer = messages.find(m => m.id === 'turn:a1')!;
 expect(oldAnswer).toMatchObject({ text: '第一答', phase: 'final_answer', itemId: 'a1', commentaryCanAttachToReply: true,
  commentary: [{ id: 'turn:a1', text: '第一答', isPreviousReply: true }], actions: [{ command: { name: 'message.copy', params: { id: 'turn:a1' } } }] });
 expect(messages.find(m => m.id === 'turn:c2')?.commentaryIsLiveTail).toBe(true);
 expect(messages.find(m => m.id === 'turn:c2')?.status).toBeUndefined();
 expect(messages.find(m => m.id === 'turn:c2')?.blocks?.some(b => b.kind === 'disclosure')).not.toBe(true);
});

it('同轮引导按原顺序集中到最后final前，旧回答保留动作及媒体归属且不跨逻辑回合', () => {
 const turns = [{ id: 'turn', status: 'completed', items: [
  { id: 'u', type: 'userMessage', text: '最初提问' },
  { id: 'c1', type: 'agentMessage', phase: 'commentary', text: '原过程' },
  { id: 'i1', type: 'imageView', path: '/commentary.png' },
  { id: 'f1', type: 'agentMessage', phase: 'final_answer', text: '旧回答' },
  { id: 'u2', type: 'userMessage', text: '第一条引导', content: [{ type: 'text', text: '第一条引导' }, { type: 'localImage', path: '/user.png' }] },
  { id: 'i2', type: 'imageView', path: '/independent.png' },
  { id: 'f2', type: 'agentMessage', phase: 'final_answer', text: '中间回答' },
  { id: 'u3', type: 'userMessage', text: '第二条引导' },
  { id: 'c2', type: 'agentMessage', phase: 'commentary', text: '最后过程' },
  { id: 'f3', type: 'agentMessage', phase: 'final_answer', text: '最后回答' },
 ] }, { id: 'next', status: 'completed', items: [{ id: 'nu', type: 'userMessage', text: '下一回合' }, { id: 'nf', type: 'agentMessage', phase: 'final_answer', text: '下一回答' }] }];
 const wire = JSON.stringify(turns);
 const messages = projectConversation({ turns }, p => `thumb:${p}`, p => `original:${p}`);
 expect(messages.slice(0, 3).map(m => m.id)).toEqual(['turn:u', 'turn:u2', 'turn:u3']);
 expect(messages.find(m => m.id === 'turn:u2')).toMatchObject({ itemId: 'u2', blocks: [{ value: 'thumb:/user.png' }], actions: [expect.anything(), { command: { name: 'message.edit', params: { turnId: 'turn', messageId: 'u2' } } }] });
 for (const id of ['f1', 'f2']) expect(messages.find(m => m.id === `turn:${id}`)).toMatchObject({ itemId: id, phase: 'final_answer', commentaryCanAttachToReply: true, commentary: [{ id: `turn:${id}`, isPreviousReply: true }] });
 expect(messages.flatMap(m => m.commentary ?? []).filter(c => ['turn:c1', 'turn:c2'].includes(c.id)).every(c => c.isPreviousReply === undefined)).toBe(true);
 expect(messages.find(m => m.id === 'turn:f3')?.commentaryCanAttachToReply).not.toBe(true);
 expect(messages.flatMap(m => m.commentary ?? []).flatMap(c => c.blocks ?? []).map(b => b.value)).toEqual(['thumb:/commentary.png']);
 expect(messages.find(m => m.id === 'turn:i2')?.blocks?.[0].value).toBe('thumb:/independent.png');
 expect(messages.slice(-2).map(m => m.text)).toEqual(['下一回合', '下一回答']);
 expect(JSON.stringify(turns)).toBe(wire);
});
it('同回合生成图与截图跨插话去重，独立截图在原位置显示', () => {
 const messages = projectConversation({ id: 't', turns: [{ id: 'turn', status: 'completed', items: [
  { id: 'u', type: 'userMessage', content: [{ type: 'text', text: '绘图' }] },
  { id: 'view-same', type: 'imageView', path: '/gen.png' },
  { id: 'g1', type: 'imageGeneration', savedPath: '/gen.png' },
  { id: 'u2', type: 'userMessage', content: [{ type: 'text', text: '继续' }] },
  { id: 'g2', type: 'imageGeneration', savedPath: '/gen.png' },
  { id: 's1', type: 'imageView', path: '/screen1.png' },
  { id: 's2', type: 'imageView', path: '/screen2.png' },
  { id: 's3', type: 'imageView', path: '/screen1.png' },
 ] }] }, path => `https://images.invalid${path}`);
 const blocks = messages.flatMap(m => m.blocks ?? []);
 expect(blocks.filter(b => b.value?.endsWith('/gen.png'))).toHaveLength(1);
 expect(blocks.filter(b => b.kind === 'image').map(b => b.value)).toEqual(['https://images.invalid/gen.png','https://images.invalid/screen1.png','https://images.invalid/screen2.png']);
 expect(messages.map(m => m.id)).toEqual(['turn:u','turn:u2','turn:g1','turn:s1','turn:s2']);
});

it('全部设备的项目入口仍按真实项目与无项目分组，含未加载空项目和分页动作', () => {
 const groups = projectNavigation({ threads: [], listBackendId: 'all', selectedBackendId: 'a', projectDirectories: [], hasProjectlessThreads: false,
  collapsedProjectKeys: new Set(), projectThreadStates: {}, projectHasMore: {}, loadingProjectKeys: new Set(), filter: 'projects',
  backends: [{ id: 'a', name: '甲设备' }], backendSnapshots: { a: { projects: ['/empty'], projectlessThreadIds: ['unloaded'], projectThreadStates: {}, projectHasMore: { '/empty': true } } },
 });
 expect(groups.find(g => g.id === 'a:/empty')?.actions?.[0].command?.name).toBe('project.more');
 expect(groups.some(g => g.title.includes('无项目'))).toBe(true);
});

it('本地用户图片与生成图分别保留缩略图和原图回调，data及远程图片URL保持原值', () => {
 const messages = projectConversation({ id: 't', turns: [{ id: 'turn', items: [
  { id: 'user-images', type: 'userMessage', content: [{ type: 'localImage', path: '/user.png' }, { type: 'image', url: 'data:image/png;base64,YQ==' }, { type: 'image', url: 'https://remote.invalid/image.png' }] },
  { id: 'generated', type: 'imageGeneration', savedPath: '/generated.png' },
  { id: 'screen', type: 'imageView', path: '/screen.png' },
 ] }] }, path => `thumbnail:${path}`, path => `original:${path}`);
 const blocks = messages.flatMap(message => message.blocks ?? []).filter(block => block.kind === 'image');
 expect(blocks.filter(block => block.value?.startsWith('thumbnail:')).map(block => block.previewURL)).toEqual(['original:/user.png', 'original:/generated.png', 'original:/screen.png']);
 expect(blocks.filter(block => /^(data:|https:)/.test(block.value ?? '')).every(block => block.previewURL === undefined)).toBe(true);
});


it.each(['inProgress','completed'])('原生 %s 的 commentary 保留分钟时间和所属截图',status=>{
 const timestamp=new Date(2026,9,15,9,7,42).getTime()/1000;
 const messages=projectConversation({turns:[{id:'turn',status,items:[
  {id:'c1',type:'agentMessage',phase:'commentary',text:'检查一',timestamp},
  {id:'i1',type:'imageView',path:'/one.png'},
  {id:'c2',type:'agentMessage',phase:'commentary',text:'检查二',timestamp:timestamp+120},
  {id:'i2',type:'imageView',path:'/two.png'},
  ...(status==='completed'?[{id:'f',type:'agentMessage',phase:'final_answer',text:'完成'}]:[]),
 ]}]},p=>'thumb:'+p,p=>'original:'+p);
 if(status==='completed'){
  const children=messages.find(m=>m.blocks?.[0]?.kind==='disclosure')!.blocks![0].children!;
  expect(children.map(c=>c.kind)).toEqual(['markdown','image','text','markdown','image','text']);
  expect(children.filter(c=>c.kind==='text').map(c=>c.text)).toEqual(['2026-10-15 09:07','2026-10-15 09:09']);
  expect(children.filter(c=>c.kind==='image').map(c=>c.previewURL)).toEqual(['original:/one.png','original:/two.png']);
 }else{
  expect(messages.find(m=>m.id==='turn:c1')?.status).toBeUndefined();
  expect(messages.map(m=>m.id)).toEqual(['turn:c1','turn:c2']);
  expect(messages[0].blocks?.map(block=>block.kind)).toEqual(['image','text']);
  expect(messages[0].blocks?.at(-1)?.text).toBe('2026-10-15 09:07');
  expect(messages[1].blocks?.map(block=>block.kind)).toEqual(['image','text']);
  expect(messages[1].blocks?.at(-1)?.text).toBe('2026-10-15 09:09');
 }
});

it('原生独立生成媒体和视频保留原始位置与失败入口，不回归尾部媒体汇总',()=>{
 const messages=projectConversation({turns:[{id:'turn',status:'completed',items:[
  {id:'c',type:'agentMessage',phase:'commentary',text:'检查'},
  {id:'i',type:'imageView',path:'/screen.png'},
  {id:'g',type:'imageGeneration',savedPath:'/generated.png'},
  {id:'v',type:'videoGeneration',path:'/clip.mp4'},
  {id:'f',type:'agentMessage',phase:'final_answer',text:'完成'},
  {id:'bad',type:'videoGeneration',status:'failed'},
 ]}]},p=>'thumbnail:'+p,p=>'original:'+p,p=>'media:'+p);
 expect(messages.map(m=>m.id)).toEqual(['turn:c:history','turn:g','turn:v','turn:f','turn:bad']);
 const history=messages[0].blocks![0].children!;
 expect(history.map(b=>b.kind)).toEqual(['markdown','image']);
 expect(history[1].previewURL).toBe('original:/screen.png');
 expect(messages[2].blocks![0]).toMatchObject({kind:'video',value:'media:/clip.mp4'});
 expect(messages[4].blocks![0]).toMatchObject({title:'视频生成未完成',command:{name:'panel.open'}});
});


it.each(['inProgress','completed'])('原生 %s 的无图 commentary 仍在正文后独立显示一次分钟时间',status=>{
 const timestamp=new Date(2026,9,15,9,7,42).getTime()/1000;
 const messages=projectConversation({turns:[{id:'turn',status,items:[
  {id:'c',type:'agentMessage',phase:'commentary',text:'只发文字',timestamp},
  ...(status==='completed'?[{id:'f',type:'agentMessage',phase:'final_answer',text:'完成'}]:[]),
 ]}]},p=>p);
 if(status==='completed') {
  expect(messages[0].blocks![0].children?.map(b=>[b.kind,b.text])).toEqual([['markdown','只发文字'],['text','2026-10-15 09:07']]);
 } else {
  expect(messages[0].text).toBe('只发文字');
  expect(messages[0].status).toBeUndefined();
  expect(messages[0].blocks?.map(b=>[b.kind,b.text])).toEqual([['text','2026-10-15 09:07']]);
 }
});


it('任务用时按真实毫秒分解为小时分钟秒，不把分钟当成小时', () => {
 const messages = projectConversation({ turns: [{ id: 'timed', status: 'completed', durationMs: 3_723_000, items: [{ id: 'f', type: 'agentMessage', phase: 'final_answer', text: '完成' }] }] }, path => path);
 expect(messages[0]?.status).toBe('1小时2分钟3秒');
});

it.each([[15_000, '15秒'], [60_000, '1分钟0秒'], [3_603_000, '1小时3秒'], [0, '0秒']])('用时 %s 省略零小时和零分钟并紧凑显示', (durationMs, expected) => {
 const messages = projectConversation({ turns: [{ id: 't', status: 'completed', durationMs, items: [{ id: 'f', type: 'agentMessage', text: '完成' }] }] }, path => path);
 expect(messages[0]?.status).toBe(expected);
});

it('引导后的运行延续回合不把旧完成用时赋给无phase的实时正文，完成后仍显示整轮用时', () => {
 const initial = { id: 'first', status: 'completed', startedAt: 100, completedAt: 120, items: [
  { id: 'user', type: 'userMessage', text: '初始问题' },
  { id: 'old', type: 'agentMessage', phase: 'final_answer', text: '旧回答' },
  { id: 'steer', type: 'userMessage', text: '继续检查' },
 ] };
 const continuation = { id: 'continuation', status: 'inProgress', items: [
  { id: 'current', type: 'agentMessage', text: '正在生成的新正文' },
 ] };
 const running = projectConversation({ turns: [initial, continuation] }, path => path);
 expect(running.find(message => message.id === 'first:current')).toMatchObject({ text: '正在生成的新正文', phase: undefined });
 expect(running.find(message => message.id === 'first:current')?.status).toBeUndefined();
 expect(running.find(message => message.id === 'first:current')?.timestamp).toBeUndefined();
 const completed = projectConversation({ turns: [initial, { ...continuation, status: 'completed', completedAt: 150 }] }, path => path);
 expect(completed.find(message => message.id === 'first:current')).toMatchObject({ status: '50秒', timestamp: 150 });
});

it('工具与推理保留原始记录并标明隐藏类型，commentary不受影响', () => {
 const messages = projectConversation({ turns: [{ id: 't', status: 'inProgress', items: [
  { id: 'c', type: 'agentMessage', phase: 'commentary', text: '读取项目' },
  { id: 'r', type: 'reasoning', text: '推理' }, { id: 'tool', type: 'commandExecution', command: 'ls' },
 ] }] }, path => path);
 expect(messages.find(m => m.phase === 'commentary')?.text).toBe('读取项目');
 expect(messages.filter(m => m.activityKind).map(m => m.activityKind)).toEqual(['reasoning', 'tool']);
});
