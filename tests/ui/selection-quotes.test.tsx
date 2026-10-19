import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
import { SelectionQuoteBoundary, SelectionQuotesProvider } from '../../src/features/conversation/SelectionQuotes';
import { validateMessageQuote, type SelectionQuote } from '../../src/features/conversation/message-quotes';
afterEach(()=>{cleanup();window.getSelection()?.removeAllRanges();});
it('Web选文快照排除复制按钮，保留重复文字的真实显示范围',()=>{
 const item={id:'answer',type:'agentMessage',text:'重复，重复。\n\n```js\nlet a=1\n```'};
 const active={id:'thread',turns:[{id:'physical',items:[item]}]};const select=vi.fn();
 render(<SelectionQuotesProvider active={active} backendId="backend" sidechat={false} readOnly={false} select={select}><SelectionQuoteBoundary item={item}><div className="markdown-body"><p data-testid="text">重复，重复。</p><div><pre>let a=1</pre><button>复制代码块</button></div></div></SelectionQuoteBoundary></SelectionQuotesProvider>);
 const text=screen.getByTestId('text').firstChild!;const range=document.createRange();range.setStart(text,3);range.setEnd(text,5);
 Object.assign(range,{getBoundingClientRect:()=>({left:10,top:50})});
 act(()=>{window.getSelection()!.addRange(range);document.dispatchEvent(new Event('selectionchange'));});
 fireEvent.click(screen.getByRole('button',{name:'加入聊天'}));
 const value=select.mock.calls[0][0] as SelectionQuote;
 expect(value.text).toBe('重复');expect(value.start).toBe(3);
 expect(validateMessageQuote(value,'backend',active).text).toBe('重复');
});
