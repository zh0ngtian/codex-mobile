import { isAbsolute } from 'node:path';
import QRCode from 'qrcode';
import { createAccessUrl, findLanIPv4 } from './access-url.mjs';
const METHODS = ['status', 'queryStatus', 'login', 'authorize', 'recover', 'reauthorize', 'targets', 'pair-local', 'pair', 'accept', 'resume', 'reassociate', 'url'];
const MESSAGES = { busy: 'Remote 管理操作正在进行', timeout: 'Remote 管理操作已超时', cancelled: 'Remote 管理操作已取消', 'commit-pending': 'Remote 身份提交结果尚待核对，请查询 status', 'not-configured': '网关尚未授权 Remote', 'already-configured': '网关已有 Remote 身份，请显式重新授权', 'identity-changed': 'Remote 原账号或本机身份已变化', 'target-unaccepted': 'Remote 完整目标尚未接受', 'target-unavailable': 'Remote 完整目标没有当前有效配对', 'pending-resume': 'Remote 目标需要在 Mac 显式恢复', protocol: 'Remote 命令参数无效', limit: 'Remote 管理通道超过资源上限' };
export const REMOTE_HELP = `用法：
codex-mobile remote status|login|authorize|recover|reauthorize|targets|pair-local [--root <绝对目录>]
codex-mobile remote pair --code <配对码> --environment-id <ID> --installation-id <ID>
codex-mobile remote accept|resume --environment-id <ID> --installation-id <ID>
codex-mobile remote reassociate --previous-environment-id <ID> --previous-installation-id <ID> --next-environment-id <ID> --next-installation-id <ID> [--code <配对码>]
codex-mobile remote url [--plain] [--root <绝对目录>]
仅连接当前用户已经运行的网关。目录也可用 CODEX_MOBILE_REMOTE_DIR 显式选择。
`;
function invalid() {
  const error = new Error('Remote 命令参数无效');
  error.code = 'protocol';
  throw error;
}
function parse(args) {
  const [method, ...rest] = args;
  if (!METHODS.includes(method)) {
    invalid();
  }
  const allowed = ['--root', ...(method === 'url' ? ['--plain'] : []), ...(['pair', 'accept', 'resume'].includes(method) ? ['--environment-id', '--installation-id'] : []), ...(['pair', 'reassociate'].includes(method) ? ['--code'] : []), ...(method === 'reassociate' ? ['--previous-environment-id', '--previous-installation-id', '--next-environment-id', '--next-installation-id'] : [])];
  const flags = {};
  for (let i = 0; i < rest.length; i++) {
    const flag = rest[i];
    if (!allowed.includes(flag) || Object.hasOwn(flags, flag)) {
      invalid();
    }
    if (flag === '--plain') {
      flags[flag] = true;
      continue;
    }
    const value = rest[++i];
    if (!value || value.startsWith('--')) {
      invalid();
    }
    flags[flag] = value;
  }
  if (flags['--root'] && (!isAbsolute(flags['--root']) || flags['--root'].split('/').some(p => p === '.' || p === '..'))) {
    invalid();
  }
  const tuple = prefix => {
    const environmentId = flags[`--${prefix}environment-id`];
    const installationId = flags[`--${prefix}installation-id`];
    if (![environmentId, installationId].every(v => typeof v === 'string' && v.length > 0 && v.length <= 4096 && !/[\x00-\x20\x7f]/.test(v))) {
      invalid();
    }
    return { environmentId, installationId };
  };
  const params = {};
  if (['pair', 'accept', 'resume'].includes(method)) {
    params.target = tuple('');
  }
  if (method === 'reassociate') {
    params.previous = tuple('previous-');
    params.next = tuple('next-');
  }
  if (method === 'pair' && !flags['--code']) {
    invalid();
  }
  if (flags['--code']) {
    if (flags['--code'].length > 1024 || /[\x00-\x20\x7f]/.test(flags['--code'])) {
      invalid();
    }
    params.code = flags['--code'];
  }
  return { method, params, directory: flags['--root'], plain: !!flags['--plain'] };
}
/** 无副作用导出；正式CLI仅从已编译npm-dist加载管理客户端。 */
export async function runRemoteCli(args, dependencies = {}) {
  const stdout = dependencies.stdout ?? (s => process.stdout.write(s));
  const stderr = dependencies.stderr ?? (s => process.stderr.write(s));
  if (args.length === 1 && ['help', '--help', '-h'].includes(args[0])) {
    stdout(REMOTE_HELP);
    return 0;
  }
  if (process.platform === 'win32' || typeof process.getuid !== 'function') {
    stderr('当前平台不支持 Remote 私有管理通道\n');
    return 1;
  }
  const abort = new AbortController();
  const cancel = () => abort.abort();
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const parsed = parse(args);
    const call = dependencies.call ?? (async (options) => {
      const { callRemoteAdmin } = await import('../npm-dist/server/remote/admin-client.js');
      return callRemoteAdmin(options);
    });
    const result = await call({ directory: parsed.directory, method: parsed.method, params: parsed.params, signal: abort.signal });
    if (parsed.method === 'url') {
      const url = createAccessUrl({ ...result, lanIp: findLanIPv4() });
      if (parsed.plain) {
        stdout(`${url}\n`);
      }
      else {
        stdout(`扫描二维码连接：\n${await QRCode.toString(url, { type: 'terminal', small: true })}\n${url}\n`);
      }
    }
    else {
      stdout(`${JSON.stringify(result, null, 2)}\n`);
    }
    return 0;
  }
  catch (error) {
    stderr(`${MESSAGES[error?.code] ?? 'Remote 管理通道不可用，请确认当前用户的网关正在运行'}\n`);
    return 1;
  }
  finally {
    process.off('SIGINT', cancel);
    process.off('SIGTERM', cancel);
  }
}
