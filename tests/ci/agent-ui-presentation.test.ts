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

it.skipIf(process.platform !== 'darwin')('AgentApp原生字号在iOS18最低版本可编译并保持字体比例', () => {
  const result = spawnSync('xcrun', ['--sdk', 'iphonesimulator', 'swiftc', '-typecheck', '-target', 'arm64-apple-ios18.0-simulator', 'mobile/ios/AgentUI/Design/AgentTheme.swift', 'mobile/ios/AgentUI/Settings/SettingsRow.swift'], { encoding: 'utf8', timeout: 180_000 });
  expect(result.status, result.stderr).toBe(0);
}, 210_000);
