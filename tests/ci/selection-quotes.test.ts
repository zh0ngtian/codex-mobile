import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { mkdtempSync, rmSync, readFileSync } from 'node:fs';
import { expect, it } from 'vitest';
it('原生系统选文菜单保留默认项并投影两个业务动作及引用卡片', () => {
 const selectable = readFileSync('mobile/ios/NativeUI/NativeSelectableText.swift', 'utf8');
 expect(selectable).toContain('editMenuForTextIn');
 expect(selectable).toContain('suggestedActions');
 expect(selectable).toContain('selectionActions');
 const composer=readFileSync('mobile/ios/AgentUI/Composer/ComposerBar.swift','utf8');
 expect(composer).toContain('ComposerQuoteCards');expect(composer).toContain('quoteFocusToken');
});

it.skipIf(process.platform !== 'darwin')('Swift引用DTO按UTF16显示范围取片段并保留来源',()=>{
 const directory=mkdtempSync(join(tmpdir(),'selection-quotes-'));
 try {
  const names=['NativeJSONValue','NativeCommand','NativeOption','NativePanelItem','NativePanel','NativeMessage'];
  const binary=join(directory,'smoke');
  const compile=spawnSync('xcrun',['swiftc',...names.map(name=>`mobile/ios/NativeUI/${name}.swift`),'tests/ci/selection-quotes-smoke.swift','-o',binary],{encoding:'utf8',timeout:60000});
  expect(compile.status,compile.stderr).toBe(0);
  const result=spawnSync(binary,[],{encoding:'utf8',timeout:15000});
  expect(result.status,result.stderr).toBe(0);expect(result.stdout).toContain('Selection quote smoke passed');
 } finally {rmSync(directory,{recursive:true,force:true});}
},90000);
