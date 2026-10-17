import { readdirSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it.skipIf(process.platform !== 'darwin')('账户刷新时间保留真实窗口与设备归属，不推算缺失时间', () => {
  const directory = mkdtempSync(join(tmpdir(), 'usage-refresh-'));
  const native = ['NativeJSONValue','NativeCommand','NativeCommandResult','NativeOption','NativeBackend','NativeNavigationItem','NativeGroup','NativeAttachment','NativeMessage','NativePanelItem','NativePanel','NativeContextUsage','NativeRateLimit','NativeComposerLineLimits','NativeComposerLayoutBudget','NativeComposerSymbols','NativeComposerMenuContext','NativeComposerAttachmentAction','NativeSnapshot','NativeUIStore','NativeComposerPresentation','NativeComposerPresentationEvent','NativeComposerPresentationIntent','NativeUIPreference','NativeMarkdownBlock','NativeMarkdownBlockKind','NativeMarkdownSyntax','NativeMarkdownInlinePart','NativeMediaSource','NativeReferenceAudio','NativeVisualReference','NativeReferenceSettings','NativeHistoryEditReference','NativeTextRhythm','NativeFieldKey','NativeFieldScope','NativeImageData','NativePlainText','NativeInlineMarkdown','NativeMarkdownDisplaySource','NativeMarkdownHTMLScope','NativeTimelineState','NativeTextPrompt'];
  const session = readdirSync('mobile/ios/AgentUI/Session').filter(name => name.endsWith('.swift'));
  try {
    const paths = [...native.map(name => `mobile/ios/NativeUI/${name}.swift`), ...session.map(name => `mobile/ios/AgentUI/Session/${name}`), 'tests/ci/usage-refresh-smoke.swift'];
    const frozen = paths.map((path, index) => { const target = join(directory, `input-${index}.swift`); copyFileSync(path, target); return target; });
    const compiled = spawnSync('xcrun', ['swiftc', ...frozen, '-o', join(directory, 'smoke')], { encoding: 'utf8', timeout: 180_000 });
    expect(compiled.status, compiled.error?.message ?? compiled.stderr).toBe(0);
    const result = spawnSync(join(directory, 'smoke'), [], { encoding: 'utf8', timeout: 20_000 });
    expect(result.status, result.error?.message ?? result.stderr).toBe(0);
    expect(result.stdout).toContain('Usage refresh smoke passed');
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 210_000);
