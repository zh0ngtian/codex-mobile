import { readFileSync } from 'node:fs';
import { expect, it } from 'vitest';

const view = (name: string) => readFileSync(`mobile/ios/AgentUI/Chat/${name}.swift`, 'utf8');

it('用户气泡使用可见文本生成可选择富文本，整条复制继续使用原文', () => {
  const source = view('UserMessageView');
  expect(source).toContain('UserMessageText.visible(message.text)');
  expect(source).toMatch(/NativeSelectableText\(text:\s*NativeSelectableMarkdown\.inline\(displayText,/);
  expect(source.match(/NativeSelectableMarkdown\.inline\(displayText,/g)).toHaveLength(1);
  expect(source).toContain('canSelect: !displayText.isEmpty');
  expect(source).toContain('select: { selectionRequest = UUID() }');
  expect(source).toContain('selectionEnabled: selectionRequest != nil, selectionRequest: selectionRequest');
  expect(source).toContain('onSelectionEnd: { selectionRequest = nil }');
  expect(source).toContain('identifier: "user.selectable"');
  expect(source).not.toContain('Text(message.text)');
  expect(source).toContain('Clipboard.copy(message.rawText ?? message.text)');
  expect(source).not.toContain('Clipboard.copy(displayText)');

  // 实际展示与测量复用同一 UITextView 的富文本，选择开关传到系统文本视图。
  const selectable = readFileSync('mobile/ios/NativeUI/NativeSelectableText.swift', 'utf8');
  expect(selectable).toContain('view.attributedText = text');
  expect(selectable).toContain('uiView.attributedText.boundingRect');
  expect(selectable).toContain('view.isSelectable = selectionEnabled');
  expect(selectable).toContain('context.coordinator.applySelectionRequest(selectionRequest, to: view)');
});

it('历史用时入口使用真实月日时分和原生分隔线，业务区块只替换显式历史区块', () => {
  const history = view('CommentaryHistoryView');
  expect(history).toContain('preferences.text("用时\\(duration)"');
  expect(history).toContain('preferences.text("执行过程"');
  expect(history).not.toContain('之前的');
  expect(history).toContain('UIFont.preferredFont(forTextStyle: .body)');
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
