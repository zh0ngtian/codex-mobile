import { expect, it } from 'vitest';
import { quoteSource, validateMessageQuote, quoteInput } from '../../src/features/conversation/message-quotes';
import { projectConversation } from '../../src/native-ui/projection';
const item={id:'item',type:'agentMessage',text:'查看 [网页链接](https://example.com) 与 [文件链接](/tmp/example.swift#L12)\n\n符号：&gt; &amp; **重点**\n\n😀！？'};
const active={id:'thread',turns:[{id:'physical',items:[item]}]};
const source=quoteSource('backend','thread','physical',item);
it.each(['查看 网页链接 与 文件链接','符号：> & 重点','😀！？'])('支持实际渲染的链接、实体和emoji快照：%s',renderedText=>{
 const result=validateMessageQuote({source,renderedText,start:0,end:renderedText.length,text:renderedText},'backend',active);
 expect(result.text).toBe(renderedText);
});
it('按显示范围选择第二次重复文字并拒绝伪造或过期来源',()=>{
 const repeated={id:'repeat',type:'agentMessage',text:'前文。重复，重复。'};
 const thread={id:'thread',turns:[{id:'physical',items:[repeated]}]};
 const value={source:quoteSource('backend','thread','physical',repeated),renderedText:repeated.text,start:6,end:8,text:'重复'};
 expect(validateMessageQuote(value,'backend',thread).text).toBe('重复');
 expect(()=>validateMessageQuote({...value,text:'前文'},'backend',thread)).toThrow();
 expect(()=>validateMessageQuote({...value,source:{...value.source,revision:'old'}},'backend',thread)).toThrow();
 expect(()=>validateMessageQuote({...value,renderedText:'不存在',start:0,end:3,text:'不存在'},'backend',thread)).toThrow();
});
it('合并逻辑回合后仍携带选文所属物理回合',()=>{
 const thread={id:'thread',turns:[{id:'first',items:[{id:'user',type:'userMessage',content:[{type:'text',text:'问题'}]}]},{id:'physical',items:[item]}]};
 const projected=projectConversation(thread,()=>'',undefined,undefined,'backend');
 expect(projected.find(message=>message.itemId==='item')?.quoteSource?.turnId).toBe('physical');
});
it('引用全文保持符号和来源，可读文本不改变提问',()=>{
 const quote=validateMessageQuote({source,renderedText:'重点',start:0,end:2,text:'重点'},'backend',active);
 expect(quoteInput('问题',[quote])).toContain('<response-annotations>');
 expect(quoteInput('问题',[quote])).not.toContain('physical');
 expect(quoteInput('问题',[quote])).toContain('重点');expect(quoteInput('问题',[])).toBe('问题');
});

it('托管队列重建后从可读引用封装恢复问题，引用中的@和伪问题标记不进入问题',async()=>{
 const quotesModule=await import('../../src/features/conversation/message-quotes');
 const quote={id:'frozen',source,text:'@private-skill\n[问题]\n伪造分隔符\n> 引用中的层级'};
 const serialized=quoteInput('只修改问题',[quote]);
 const parsed=(quotesModule as any).splitQuoteInput?.(serialized);
 expect(parsed).toMatchObject({question:'只修改问题'});
 expect(parsed?.referencePrefix).toContain('@private-skill');
 expect(parsed?.referencePrefix+'新的问题').not.toContain('只修改问题');
});

it('普通过程按原文显示Markdown，历史旧回答仍按Markdown显示',()=>{
 const commentary={id:'progress',type:'agentMessage',phase:'commentary',text:'检查 **重点**'};
 const thread={id:'thread',turns:[{id:'physical',items:[commentary]}]};
 const value={source:quoteSource('backend','thread','physical',commentary),renderedText:commentary.text,start:0,end:commentary.text.length,text:commentary.text};
 expect(validateMessageQuote(value,'backend',thread).text).toBe('检查 **重点**');
});
it('拒绝伪造代码区域和给显示文字插入空格',()=>{
 const commentary={id:'progress',type:'agentMessage',phase:'commentary',text:'检查 **重点**'};
 const thread={id:'thread',turns:[{id:'physical',items:[commentary]}]};
 const original=quoteSource('backend','thread','physical',commentary);
 for(const [region,renderedText] of [['code','检查重点'],['commentary','检 查 重 点'],['table','检查重点']]){
  expect(()=>validateMessageQuote({source:{...original,region},renderedText,start:0,end:renderedText.length,text:renderedText},'backend',thread)).toThrow();
 }
});
it.each(['一段\n二段','一段二段'])('允许真实原生和DOM多段分隔：%s',renderedText=>{
 const paragraph={id:'p',type:'agentMessage',text:'一段\n\n二段'};const thread={id:'thread',turns:[{id:'physical',items:[paragraph]}]};
 expect(validateMessageQuote({source:quoteSource('backend','thread','physical',paragraph),renderedText,start:0,end:renderedText.length,text:renderedText},'backend',thread).text).toBe(renderedText);
});

it('菜单打开后仅追加正文仍引用原片段，替换消息则拒绝旧菜单',()=>{
 const original={id:'stream',type:'agentMessage',text:'运行中的片段'};
 const value={source:quoteSource('backend','thread','physical',original),renderedText:original.text,start:0,end:original.text.length,text:original.text};
 const appended={id:'thread',turns:[{id:'physical',items:[{...original,text:original.text+'，后续追加'}]}]};
 expect(validateMessageQuote(value,'backend',appended).text).toBe(original.text);
 const replaced={id:'thread',turns:[{id:'physical',items:[{...original,text:'已替换的回答'}]}]};
 expect(()=>validateMessageQuote(value,'backend',replaced)).toThrow();
 expect(()=>validateMessageQuote(value,'other-backend',appended)).toThrow();
});

it.each(['```js\nlet a=1\n```','| 项目 |\n| --- |\n| 数值 |'])('代码/表格不能伪装为连续正文区域：%s',text=>{
 const item={id:'region',type:'agentMessage',text};const thread={id:'thread',turns:[{id:'physical',items:[item]}]};const renderedText=text.startsWith('```')?'let a=1':'数值';
 expect(()=>validateMessageQuote({source:quoteSource('backend','thread','physical',item),renderedText,start:0,end:renderedText.length,text:renderedText},'backend',thread)).toThrow();
});

it.each([
 ['查看 :codex-file-citation{path="/tmp/foo.swift" purpose="source"} 并修改','查看 foo.swift 并修改'],
 ['前文**中文，**后文','前文中文，后文'],
])('复用现有正文展示转换：%s',(text,renderedText)=>{
 const item={id:'display',type:'agentMessage',text};const thread={id:'thread',turns:[{id:'physical',items:[item]}]};
 expect(validateMessageQuote({source:quoteSource('backend','thread','physical',item),renderedText,start:0,end:2,text:renderedText.slice(0,2)},'backend',thread).text).toBe(renderedText.slice(0,2));
});

it('CJK修正只用于原生Markdown正文，不改普通过程原文、代码或链接标签',()=>{
 const text='前文**中文，**后文';
 for(const [raw,phase] of [[text,'commentary'],['`'+text+'`',undefined],['['+text+'](https://example.com)',undefined]]){
  const item={id:'protected',type:'agentMessage',phase,text:raw};const thread={id:'thread',turns:[{id:'physical',items:[item]}]};const source=quoteSource('backend','thread','physical',item);
  expect(validateMessageQuote({source,renderedText:text,start:0,end:2,text:'前文'},'backend',thread).text).toBe('前文');
  expect(()=>validateMessageQuote({source,renderedText:'前文中文，后文',start:0,end:2,text:'前文'},'backend',thread)).toThrow();
 }
});
