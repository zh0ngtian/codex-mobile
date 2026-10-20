import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { expect, it } from 'vitest';

it.skipIf(process.platform !== 'darwin')('AgentApp偏好读取真实快照并把语言与传输改动送回现有业务', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-ui-preferences-'));
  try {
    const names = ['NativeJSONValue', 'NativeCommand', 'NativeCommandResult', 'NativeOption', 'NativeBackend', 'NativeNavigationItem', 'NativeGroup', 'NativeAttachment', 'NativeMessage', 'NativePanelItem', 'NativePanel', 'NativeContextUsage', 'NativeRateLimit', 'NativeSnapshot'];
    const compile = spawnSync('xcrun', ['swiftc', ...names.map(name => `mobile/ios/NativeUI/${name}.swift`), 'mobile/ios/AgentUI/Settings/AppPreferences.swift', 'mobile/ios/AgentUI/Settings/AgentAppearance.swift', 'tests/ci/agent-ui-preferences-smoke.swift', '-o', join(directory, 'smoke')], { encoding: 'utf8', timeout: 180_000 });
    expect(compile.status, compile.stderr).toBe(0);
    const result = spawnSync(join(directory, 'smoke'), [], { encoding: 'utf8', timeout: 15_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Agent preferences smoke passed');
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 210_000);

it.skipIf(process.platform !== 'darwin')('真实二维码只导入有效的HTTP网关地址并拒绝歧义口令', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-ui-gateway-'));
  try {
    const compile = spawnSync('xcrun', ['swiftc', 'mobile/ios/AgentUI/Devices/DeviceGatewayAddress.swift', 'tests/ci/agent-ui-gateway-address-smoke.swift', '-o', join(directory, 'smoke')], { encoding: 'utf8', timeout: 180_000 });
    expect(compile.status, compile.stderr).toBe(0);
    const result = spawnSync(join(directory, 'smoke'), [], { encoding: 'utf8', timeout: 15_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Agent gateway address smoke passed');
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 210_000);

it.skipIf(process.platform !== 'darwin')('AgentApp系统默认文字样式在iOS18最低版本可编译', () => {
  const result = spawnSync('xcrun', ['--sdk', 'iphonesimulator', 'swiftc', '-typecheck', '-target', 'arm64-apple-ios18.0-simulator', 'mobile/ios/AgentUI/Design/AgentTheme.swift', 'mobile/ios/AgentUI/Settings/SettingsRow.swift'], { encoding: 'utf8', timeout: 180_000 });
  expect(result.status, result.stderr).toBe(0);
}, 210_000);

it.skipIf(process.platform !== 'darwin')('复制会话ID保留网关原值，缺少映射时不得写剪贴板', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-ui-conversation-id-'));
  try {
    const compile = spawnSync('xcrun', ['swiftc', 'mobile/ios/AgentUI/Home/ConversationIDClipboard.swift', 'tests/ci/agent-ui-conversation-id-smoke.swift', '-o', join(directory, 'smoke')], { encoding: 'utf8', timeout: 180_000 });
    expect(compile.status, compile.stderr).toBe(0);
    const result = spawnSync(join(directory, 'smoke'), [], { encoding: 'utf8', timeout: 15_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Agent conversation ID smoke passed');
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 210_000);

it.skipIf(process.platform !== 'darwin')('附件总预算包含真实已导入size且不重复累计本地数据', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-ui-attachment-budget-'));
  try {
    const files = ['mobile/ios/AgentUI/Session/AttachmentItem.swift', 'mobile/ios/AgentUI/Session/AttachmentKind.swift', 'mobile/ios/AgentUI/Session/AttachmentState.swift', 'mobile/ios/AgentUI/Composer/AttachmentImportLimits.swift', 'mobile/ios/AgentUI/Composer/AttachmentImportError.swift', 'tests/ci/agent-ui-attachment-budget-smoke.swift'];
    const compile = spawnSync('xcrun', ['swiftc', ...files, '-o', join(directory, 'smoke')], { encoding: 'utf8', timeout: 180_000 });
    expect(compile.status, compile.stderr).toBe(0);
    const result = spawnSync(join(directory, 'smoke'), [], { encoding: 'utf8', timeout: 15_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Agent attachment budget smoke passed');
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 210_000);

it.skipIf(process.platform !== 'darwin')('侧栏严格区分加载、失败与已完成的空搜索结果', () => {
  const directory = mkdtempSync(join(tmpdir(), 'agent-ui-navigation-state-'));
  try {
    const compile = spawnSync('xcrun', ['swiftc', 'mobile/ios/AgentUI/Home/SidebarNavigationState.swift', 'tests/ci/agent-ui-navigation-state-smoke.swift', '-o', join(directory, 'smoke')], { encoding: 'utf8', timeout: 180_000 });
    expect(compile.status, compile.stderr).toBe(0);
    const result = spawnSync(join(directory, 'smoke'), [], { encoding: 'utf8', timeout: 15_000 });
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain('Agent navigation state smoke passed');
  } finally { rmSync(directory, { recursive: true, force: true }); }
}, 210_000);
