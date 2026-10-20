import { readdirSync, mkdtempSync, rmSync, copyFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, it } from 'vitest';

it.skipIf(process.platform !== 'darwin')('AgentApp 会话使用真实快照且通过现有业务桥执行命令', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-session-'));
  const native = ['NativeJSONValue','NativeCommand','NativeCommandResult','NativeOption','NativeBackend','NativeNavigationItem','NativeGroup','NativeAttachment','NativeMessage','NativePanelItem','NativePanel','NativeContextUsage','NativeRateLimit','NativeComposerLineLimits','NativeComposerLayoutBudget','NativeComposerSymbols','NativeComposerMenuContext','NativeComposerAttachmentAction','NativeSnapshot','NativeUIStore','NativeComposerPresentation','NativeComposerPresentationEvent','NativeComposerPresentationIntent','NativeUIPreference','NativeMarkdownBlock','NativeMarkdownBlockKind','NativeMarkdownSyntax','NativeMarkdownInlinePart','NativeMediaSource','NativeReferenceAudio','NativeVisualReference','NativeReferenceSettings','NativeHistoryEditReference','NativeTextRhythm','NativeFieldKey','NativeFieldScope','NativeImageData','NativePlainText','NativeInlineMarkdown','NativeMarkdownDisplaySource','NativeMarkdownHTMLScope','NativeTimelineState','NativeTextPrompt'];
  const session = readdirSync('mobile/ios/AgentUI/Session').filter(name => name.endsWith('.swift'));
  try {
    const inputs = [...native.map(name => `mobile/ios/NativeUI/${name}.swift`), ...session.map(name => `mobile/ios/AgentUI/Session/${name}`), 'tests/ci/agent-session-smoke.swift', 'tests/ci/agent-steering-smoke.swift'];
    const frozen = inputs.map((path,index) => { const target = join(directory, `input-${index}.swift`); copyFileSync(path,target); return target; });
    const compilation = spawnSync('xcrun', ['swiftc', '-whole-module-optimization', ...frozen, '-o', join(directory,'smoke')], {encoding:'utf8',timeout:180000});
    expect(compilation.status, compilation.stderr).toBe(0);
    const result = spawnSync(join(directory,'smoke'), [], {encoding:'utf8',timeout:20000});
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Agent session smoke passed');
  } finally { rmSync(directory,{recursive:true,force:true}); }
}, 210000);
