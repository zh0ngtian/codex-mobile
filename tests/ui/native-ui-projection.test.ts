import { describe, expect, it } from 'vitest';
import { projectConversation, projectNavigation, insertNativeMention } from '../../src/native-ui/projection';
import { aggregateThreads } from '../../src/features/threads/thread-list-model';

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

it('同回合助手→用户插话→助手保持真实顺序，运行时无final的commentary直接显示', () => {
 const messages = projectConversation({ id: 't', turns: [{ id: 'turn', status: 'inProgress', items: [
  { id: 'u1', type: 'userMessage', content: [{ type: 'text', text: '第一问' }] },
  { id: 'a1', type: 'agentMessage', phase: 'final_answer', text: '第一答' },
  { id: 'u2', type: 'userMessage', content: [{ type: 'text', text: '插话' }] },
  { id: 'c2', type: 'agentMessage', phase: 'commentary', text: '继续检查' },
 ] }] }, path => path);
 expect(messages.filter(m => m.text).map(m => m.text)).toEqual(['第一问', '第一答', '插话', '继续检查']);
 expect(messages.find(m => m.id === 'turn:c2')?.blocks?.some(b => b.kind === 'disclosure')).not.toBe(true);
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
 expect(messages.map(m => m.id)).toEqual(['turn:u','turn:g1','turn:u2','turn:s1','turn:s2']);
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
  expect(children.map(c=>c.kind)).toEqual(['markdown','text','image','markdown','text','image']);
  expect(children.filter(c=>c.kind==='text').map(c=>c.text)).toEqual(['2026-10-15 09:07','2026-10-15 09:09']);
  expect(children.filter(c=>c.kind==='image').map(c=>c.previewURL)).toEqual(['original:/one.png','original:/two.png']);
 }else{
  expect(messages.find(m=>m.id==='turn:c1')?.status).toBe('2026-10-15 09:07');
  expect(messages.map(m=>m.id)).toEqual(['turn:c1','turn:i1','turn:c2','turn:i2']);
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
