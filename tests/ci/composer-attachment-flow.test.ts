import { copyFileSync, mkdtempSync, readdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it.skipIf(process.platform !== 'darwin')('附件直接选择后原子导入，失败可恢复且旧会话结果不能串入新草稿', () => {
  const directory = mkdtempSync(join(tmpdir(), 'composer-attachments-'));
  const native = ['NativeJSONValue','NativeCommand','NativeCommandResult','NativeOption','NativeBackend','NativeNavigationItem','NativeGroup','NativeAttachment','NativeMessage','NativePanelItem','NativePanel','NativeContextUsage','NativeRateLimit','NativeComposerLineLimits','NativeComposerLayoutBudget','NativeComposerSymbols','NativeComposerMenuContext','NativeComposerAttachmentAction','NativeSnapshot','NativeUIStore','NativeComposerPresentation','NativeComposerPresentationEvent','NativeComposerPresentationIntent','NativeUIPreference','NativeMarkdownBlock','NativeMarkdownBlockKind','NativeMarkdownSyntax','NativeMarkdownInlinePart','NativeMediaSource','NativeReferenceAudio','NativeVisualReference','NativeReferenceSettings','NativeHistoryEditReference','NativeTextRhythm','NativeFieldKey','NativeFieldScope','NativeImageData','NativePlainText','NativeInlineMarkdown','NativeMarkdownDisplaySource','NativeMarkdownHTMLScope','NativeTimelineState','NativeTextPrompt'];
  const session = readdirSync('mobile/ios/AgentUI/Session').filter(name => name.endsWith('.swift')).map(name => `mobile/ios/AgentUI/Session/${name}`);
  const composer = ['AttachmentImportStore', 'AttachmentLoader', 'AttachmentPhotoTransfer', 'AttachmentImportLimits', 'AttachmentImportError', 'ComposerAttachmentFlow', 'ComposerAttachmentSubmitGate'];
  try {
    const files = [...native.map(name => `mobile/ios/NativeUI/${name}.swift`), ...session, ...composer.map(name => `mobile/ios/AgentUI/Composer/${name}.swift`), 'tests/ci/composer-attachment-flow-smoke.swift'];
    const frozen = files.map((path, index) => { const copy = join(directory, `input-${index}.swift`); copyFileSync(path, copy); return copy; });
    const compile = spawnSync('xcrun', ['swiftc', '-whole-module-optimization', ...frozen, '-o', join(directory, 'smoke')], { encoding: 'utf8', timeout: 180_000 });
    expect(compile.status, compile.error?.message ?? compile.stderr).toBe(0);
    const result = spawnSync(join(directory, 'smoke'), [], { encoding: 'utf8', timeout: 20_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Composer attachment flow smoke passed');
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 210_000);
