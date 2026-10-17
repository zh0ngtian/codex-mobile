import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const view = (name: string) => readFileSync(`mobile/ios/AgentUI/Chat/${name}.swift`, 'utf8');

it('用户气泡正文与高度测量使用相同可见文本，复制继续使用原文', () => {
  const source = view('UserMessageView');
  expect(source).toContain('UserMessageText.visible(message.text)');
  expect(source.match(/Text\(displayText\)/g)).toHaveLength(2);
  expect(source).not.toContain('Text(message.text)');
  expect(source).toContain('Clipboard.copy(message.text)');
});

it('历史使用灰色条目标题、真实HH:mm和原生分隔线，业务区块只替换显式历史区块', () => {
  const history = view('CommentaryHistoryView');
  expect(history).toContain('之前的 \\(entries.count) 条消息');
  expect(history).toContain('AgentTheme.chatBody');
  expect(history).toContain('entry.timestampLabel');
  expect(history).toContain('Divider()');
  expect(history).toContain('"chevron.right").font(.caption)');
  expect(history).toContain('.font(AgentTheme.small).foregroundStyle(.secondary)');
  expect(history).not.toContain('.opacity(');
  expect(history).not.toMatch(/\.background\(|strokeBorder|NativePanelItemView/);
  expect(view('LiveBusinessBlocks')).toContain('message.presentationBlocks');
  expect(view('MessageView')).toContain('MessagePresentation.showsResponseActions(for: message)');
  expect(view('MessageView')).toContain('if !message.outputs.isEmpty');
  expect(view('LiveBusinessBlocks')).toContain('if !items.isEmpty');
});
