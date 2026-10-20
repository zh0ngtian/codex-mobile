import { cloneElement, createContext, useContext, useEffect, useMemo, useRef, useState, type ReactNode, type ReactElement, type Ref, type SyntheticEvent } from 'react';
import { quoteLabel, quoteSource, type MessageQuote, type QuoteSource, type SelectionQuote } from './message-quotes';
import { t } from '../../i18n';
import './selection-quotes.css';
function displayText(node: Node): string {
 const clone=node.cloneNode(true) as Node & ParentNode;
 clone.querySelectorAll?.('button, [aria-hidden="true"], img, video, audio, canvas').forEach(element=>element.remove());
 return clone.textContent ?? '';
}
const SelectionContext = createContext<{ sources: Map<object, QuoteSource>; sidechat: boolean; readOnly: boolean; select?: (quote: SelectionQuote, side: boolean) => void }>({ sources: new Map(), sidechat: false, readOnly: false });
export function SelectionQuotesProvider({ active, backendId, sidechat, readOnly, select, children }: { active: Record<string, any>; backendId: string; sidechat: boolean; readOnly: boolean; select?: (quote: SelectionQuote, side: boolean) => void; children: ReactNode }) {
 const sources = useMemo(() => {
  const map = new Map<object, QuoteSource>();
  for (const turn of active.turns ?? []) for (const item of turn.items ?? []) if (['userMessage', 'agentMessage'].includes(item.type) && turn.id && item.id) map.set(item, quoteSource(backendId, String(active.id), String(turn.id), item));
  return map;
 }, [active, backendId]);
 return <SelectionContext value={{ sources, sidechat, readOnly, select }}>{children}</SelectionContext>;
}
export function SelectionQuoteBoundary({ item, children }: { item: object; children: ReactNode }) {
 const context = useContext(SelectionContext); const root = useRef<HTMLDivElement>(null);
 const source = context.sources.get(item);
 const [selection, setSelection] = useState<(SelectionQuote & { x: number; y: number }) | null>(null);
 useEffect(() => {
  const capture = () => {
   const selected = window.getSelection(); const element = root.current;
   if (!source || !element || !selected?.rangeCount || selected.isCollapsed) { setSelection(null); return; }
   const range = selected.getRangeAt(0);
   // 不允许跨消息、跨代码/表格区域引用。
   if (!element.contains(range.startContainer) || !element.contains(range.endContainer)) { setSelection(null); return; }
   const regionElement = (node: Node) => (node.nodeType === Node.ELEMENT_NODE ? node as Element : node.parentElement)?.closest('pre,td,th,.markdown-body') ?? element;
   const startRoot = regionElement(range.startContainer); const endRoot = regionElement(range.endContainer);
   if (startRoot !== endRoot || !startRoot) { setSelection(null); return; }
   const snapshotRange=range.cloneRange(); snapshotRange.selectNodeContents(startRoot);
   if (source.region === 'body' && startRoot instanceof Element && startRoot.matches('.markdown-body')) {
    const children: Node[]=Array.from(startRoot.childNodes);
    const childOf=(node: Node): Node => { while(node.parentNode && node.parentNode!==startRoot) node=node.parentNode; return node; };
    const blocked=(node: Node) => node instanceof Element && (node.matches('pre,table') || !!node.querySelector('pre,table'));
    let first=children.indexOf(childOf(range.startContainer)); let last=children.indexOf(childOf(range.endContainer));
    if(first<0 || last<first || children.slice(first,last+1).some(blocked)) {setSelection(null);return;}
    while(first>0&&!blocked(children[first-1]))first--;
    while(last<children.length-1&&!blocked(children[last+1]))last++;
    snapshotRange.setStartBefore(children[first]);snapshotRange.setEndAfter(children[last]);
   }
   const prefix=snapshotRange.cloneRange(); prefix.setEnd(range.startContainer,range.startOffset);
   const renderedText=displayText(snapshotRange.cloneContents()); const start=displayText(prefix.cloneContents()).length; const text=range.toString();
   if (!text.trim() || renderedText.slice(start,start+text.length)!==text) { setSelection(null); return; }
   const rect=range.getBoundingClientRect();
   setSelection({source:{...source,region:source.region !== 'body' ? source.region : startRoot instanceof Element && startRoot.matches('pre')?'code':startRoot instanceof Element && startRoot.matches('td,th')?'table':source.region},renderedText,start,end:start+text.length,text,x:Math.max(8,Math.min(window.innerWidth-280,rect.left)),y:Math.max(8,rect.top-48)});
  };
  document.addEventListener('selectionchange', capture); return () => document.removeEventListener('selectionchange',capture);
 }, [source]);
 const preserveTextSelection = (event: SyntheticEvent) => {
  if (context.select && (event.target as Element).closest('.markdown-body') && !(event.target as Element).closest('button,a,input,textarea')) event.stopPropagation();
 };
 const child=children as ReactElement<{className?: string; ref?: Ref<HTMLDivElement>; onPointerDownCapture?: (event: SyntheticEvent) => void; onContextMenuCapture?: (event: SyntheticEvent) => void}>;
 return <>{cloneElement(child, {ref:root,className:((child.props.className ?? '')+' selection-quote-boundary').trim(),onPointerDownCapture:preserveTextSelection,onContextMenuCapture:preserveTextSelection})}{selection && context.select && <div className="selection-quote-menu" role="toolbar" style={{left:selection.x,top:selection.y}} onPointerDown={event=>event.preventDefault()}>
  {!context.readOnly && <button type="button" onClick={()=>{context.select?.(selection,false);setSelection(null);window.getSelection()?.removeAllRanges();}}>{t('加入聊天')}</button>}
  {!context.sidechat && <button type="button" onClick={()=>{context.select?.(selection,true);setSelection(null);window.getSelection()?.removeAllRanges();}}>{t('在 Sidechat 中提问')}</button>}
 </div>}</>;
}
export function QuoteCards({ quotes, remove }: { quotes: MessageQuote[]; remove?: (id: string) => void }) {
 return quotes.length ? <div className="composer-quotes" aria-label={t('待发送引用')}>{quotes.map(quote=><article key={quote.id} className="composer-quote"><details><summary>{quoteLabel(quote.source)}<span>{quote.text}</span></summary><p>{quote.text}</p></details><button type="button" aria-label={t('移除引用')} onClick={()=>remove?.(quote.id)}>×</button></article>)}</div> : null;
}
