import type { MessageReference } from '../../../server/user-message-format';
import { t } from '../../i18n';
import './message-references.css';
export function MessageReferences({ references }: { references: readonly MessageReference[] }) {
  return references.length ? <div className="message-references">{references.map((reference, index) => <details key={index} data-reference-index={index + 1}>
    <summary><small>{t('引用')} {index + 1}</small><span>{reference.text}</span></summary>
    <p>{reference.text}</p>
    {reference.annotation && <p>{reference.annotation}</p>}
    {reference.source && <button type="button" onClick={() => {
      const source = reference.source!;
      const element = document.getElementById(`message-source-${source.messageId}`);
      if (element?.dataset.sourceText?.slice(source.startOffset, source.endOffset) === reference.text) element.scrollIntoView({ block: 'center', behavior: 'smooth' });
    }}>{t('查看来源')}</button>}
  </details>)}</div> : null;
}
