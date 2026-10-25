"""协调器的服务端部署阶段：保留已部署前端与现有 LaunchAgent。"""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import subprocess
import sys
import tarfile
import time
import urllib.parse
import urllib.request

from .state import atomic_json, read_json, sha256
from .desktop_meter import DesktopMeterInstall

MARKER = '.codex-mobile-deployment.json'
BUILD_COMMAND = ['npm', 'run', 'build:server']
BUILD_WRAPPER = '''import sys
sys.path.insert(0, sys.argv[1])
from release_coordination.gateway import build_server
build_server(*sys.argv[2:])
'''


def tree_digest(root):
    """摘要包含相对文件名和内容；不接受运行文件树中的符号链接。"""
    root = Path(root)
    if not root.is_dir() or root.is_symlink():
        raise RuntimeError('网关部署文件树缺失')
    digest = hashlib.sha256()
    for path in sorted(root.rglob('*')):
        if path.is_symlink():
            raise RuntimeError('网关部署文件树不能包含符号链接')
        relative = path.relative_to(root).as_posix().encode()
        digest.update((b'd' if path.is_dir() else b'f') + b'\0' + relative + b'\0')
        if path.is_file():
            digest.update(sha256(path).encode())
    return digest.hexdigest()


def source_fingerprint(work):
    work = Path(work)
    inputs = {'server': tree_digest(work / 'server'), 'bin': tree_digest(work / 'bin')}
    for name in ('package.json', 'package-lock.json', 'tsconfig.npm.json'):
        inputs[name] = sha256(work / name)
    return hashlib.sha256(json.dumps(inputs, sort_keys=True).encode()).hexdigest()


def build_server(work, checkpoint_path, identity_json, fingerprint):
    """构建子进程先持久化成功凭证；父适配器响应丢失不丢失构建结果。"""
    work = Path(work).resolve()
    checkpoint_path = Path(checkpoint_path)
    checkpoint_path.parent.mkdir(parents=True, exist_ok=True)
    log = checkpoint_path.with_suffix('.log')
    if source_fingerprint(work) != fingerprint:
        raise RuntimeError('网关构建源指纹在启动前发生变化')
    record = {'identity': json.loads(identity_json), 'work': str(work),
              'sourceFingerprint': fingerprint, 'status': 'running',
              'command': BUILD_COMMAND, 'log': str(log.resolve()), 'startedAt': time.time()}
    atomic_json(checkpoint_path, record)
    output = work / 'npm-dist/server'
    if output.exists():
        shutil.rmtree(output)
    with log.open('wb') as compiler_log:
        result = subprocess.run(BUILD_COMMAND, cwd=work, stdout=compiler_log, stderr=subprocess.STDOUT)
        compiler_log.flush()
        os.fsync(compiler_log.fileno())
    record.update(exitCode=result.returncode, logSha256=sha256(log), completedAt=time.time())
    if result.returncode != 0:
        record['status'] = 'failed'
        atomic_json(checkpoint_path, record)
        sys.stderr.write(log.read_text(errors='replace'))
        raise RuntimeError('网关服务端构建失败')
    if source_fingerprint(work) != fingerprint:
        record['status'] = 'failed'
        atomic_json(checkpoint_path, record)
        raise RuntimeError('网关构建源指纹在编译期间发生变化')
    record.update(status='success', serverDigest=tree_digest(output))
    # 在任何快照/打包及 stdout/stderr 回传前完成原子落盘。
    atomic_json(checkpoint_path, record)
    sys.stderr.write(log.read_text(errors='replace'))


class Gateway:
    def __init__(self, adapter):
        self.adapter = adapter
        self.root = Path(adapter.root)
        self.work = Path(adapter.work)
        options = adapter.options
        self.target = Path(options.get('gateway_root') or Path.home() / '.local/share/codex-mobile-gateway').expanduser().resolve()
        self.label = options.get('gateway_label', 'com.minis.codex-mobile-gateway')
        self.service = f'gui/{os.getuid()}/{self.label}'
        self.package = self.target / 'node_modules/codex-mobile'
        self.stage = self.root / 'gateway-stage/package'
        self.backup = self.root / 'gateway-backup/package'
        self.archive = self.root / 'gateway-package.tgz'
        self.record_path = self.root / 'gateway-progress.json'
        self.build_path = self.root / 'gateway-build.json'
        self.build_log = self.root / 'gateway-build.log'
        self.sha = adapter.context['frozen']['sha']
        self.batch = adapter.context['id']
        desktop_options = options.get('gateway_desktop_meter')
        self.desktop_meter = DesktopMeterInstall(desktop_options, self.package) if desktop_options else None

    def _record(self):
        return read_json(self.record_path) if self.record_path.exists() else {}

    def _save(self, record):
        atomic_json(self.record_path, record)

    def _identity(self):
        return {'batchId': self.batch, 'sha': self.sha, 'target': str(self.target), 'label': self.label}

    def _digests(self, package):
        return {'serverDigest': tree_digest(package / 'npm-dist/server'),
                'frontendDigest': tree_digest(package / 'dist'),
                'binDigest': tree_digest(package / 'bin'),
                'manifestDigest': sha256(package / 'package.json')}

    def _startup(self):
        return {name: sha256(self.target / name) for name in ('start.py', 'gateway-env.json')}

    def _matches(self, package, record):
        try:
            marker = read_json(package / MARKER)
            return (marker == {**self._identity(), **record['digests']} and
                    self._digests(package) == record['digests'] and
                    self._startup() == record['startup'])
        except (OSError, ValueError, KeyError, RuntimeError):
            return False

    def _pid(self, strict=False):
        try:
            output = self.adapter.command(['launchctl', 'print', self.service])
            match = re.search(r'^\s*pid\s*=\s*(\d+)\s*$', output, re.MULTILINE)
            return int(match[1]) if match else None
        except Exception:
            if strict:
                raise RuntimeError('无法读取网关 launchd 状态，不能判定是否需要重启') from None
            return None

    def _process_matches(self, pid):
        try:
            command = self.adapter.command(['ps', '-p', str(pid), '-o', 'command='])
            args = shlex.split(command.strip())
            expected = str(self.package / 'bin/codex-mobile.mjs')
            return (len(args) == 3 and Path(args[0]).name == 'node' and
                    Path(args[1]).resolve() == Path(expected).resolve() and args[2] == 'start')
        except Exception:
            return False

    def _healthy(self, pid):
        # /api/status 支持 cookie；口令不传递给可记录命令的 runner。
        try:
            env = read_json(self.target / 'gateway-env.json')
            port = int(env.get('PORT') or 18766)
            if not 0 < port <= 65535:
                return False
            listeners = self.adapter.command(['lsof', '-nP', '-a', '-p', str(pid),
                                              f'-iTCP:{port}', '-sTCP:LISTEN', '-t'])
            if str(pid) not in listeners.split():
                return False
            mode = 'external' if env.get('CODEX_APP_SERVER_MODE') == 'external' else 'managed'
            upstream_port = env.get('CODEX_APP_SERVER_PORT', '18765')
            upstream = (env.get('CODEX_APP_SERVER_URL') or f'ws://127.0.0.1:{upstream_port}') if mode == 'external' else f'ws://127.0.0.1:{upstream_port}'
            host = str(env.get('HOST') or '127.0.0.1')
            if host == '0.0.0.0':
                host = '127.0.0.1'
            elif host == '::':
                host = '::1'
            authority = f'[{host}]' if ':' in host and not host.startswith('[') else host
            request = urllib.request.Request(f'http://{authority}:{port}/api/status')
            token = env.get('CODEX_MOBILE_TOKEN')
            if token:
                request.add_header('Cookie', 'codex_mobile_token=' + urllib.parse.quote(str(token), safe="~()*!.'-"))
            opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))
            with opener.open(request, timeout=3) as response:
                status = json.load(response)
            return status.get('mode') == mode and status.get('upstreamUrl') == upstream
        except Exception:
            # HTTP 错误文本和环境文件中可能含私有数据，仅返回验收状态。
            return False

    def check(self):
        record = self._record()
        if record.get('identity') != self._identity() or not self._matches(self.package, record):
            return {'done': False, 'result': {'reason': 'gateway_files'}}
        if self.desktop_meter and not self.desktop_meter.check(record.get('desktopMeter', {})):
            return {'done': False, 'result': {'reason': 'desktop_meter_files'}}
        intent = record.get('restart', {})
        pid = self._pid()
        if (not intent.get('intent') or pid is None or pid == intent.get('oldPid') or
                not self._process_matches(pid) or not self._healthy(pid) or self._pid() != pid):
            return {'done': False, 'result': {'reason': 'gateway_runtime'}}
        receipt = {**self._identity(), **record['digests'], 'deploymentId': f'{self.batch}:{self.sha}',
                   'pid': pid, 'oldPid': intent.get('oldPid'), 'service': self.service,
                   'package': str(self.package), 'archiveSha256': record['archiveSha256']}
        if self.desktop_meter:
            receipt['desktopMeter'] = self.desktop_meter.receipt(record['desktopMeter'])
        return {'done': True, 'result': receipt}

    def _build(self):
        fingerprint = source_fingerprint(self.work)
        if self.build_path.exists():
            checkpoint = read_json(self.build_path)
            if checkpoint.get('status') == 'success':
                try:
                    valid = (checkpoint.get('identity') == self._identity() and
                             checkpoint.get('work') == str(self.work.resolve()) and
                             checkpoint.get('sourceFingerprint') == fingerprint and
                             checkpoint.get('exitCode') == 0 and checkpoint.get('command') == BUILD_COMMAND and
                             checkpoint.get('serverDigest') == tree_digest(self.work / 'npm-dist/server') and
                             checkpoint.get('log') == str(self.build_log.resolve()) and
                             checkpoint.get('logSha256') == sha256(self.build_log))
                except (OSError, ValueError, RuntimeError):
                    valid = False
                if not valid:
                    raise RuntimeError('网关成功构建 checkpoint 的源指纹、输出或日志摘要不符')
                return checkpoint
        self.adapter.command([sys.executable, '-c', BUILD_WRAPPER,
                              str(Path(__file__).resolve().parent.parent), str(self.work),
                              str(self.build_path), json.dumps(self._identity()), fingerprint], cwd=self.work)
        # wrapper 必须自己保存成功凭证；不能把成功响应代替持久检查点。
        checkpoint = read_json(self.build_path) if self.build_path.exists() else {}
        if checkpoint.get('status') != 'success':
            raise RuntimeError('网关构建缺少成功 checkpoint')
        return self._build()

    def _prepare(self):
        record = self._record()
        if record:
            if record.get('identity') != self._identity():
                raise RuntimeError('网关阶段记录与冻结批次或部署目标不符')
            if record.get('prepared'):
                if not self._matches(self.stage, record) or sha256(self.archive) != record['archiveSha256']:
                    raise RuntimeError('网关 stage 阶段产物摘要不符')
                return record
        # 在旧包、启动文件与前端均存在时才开始；任何构建均来自冻结提交。
        if self.adapter.command(['git', 'rev-parse', 'HEAD'], cwd=self.work).strip() != self.sha:
            raise RuntimeError('网关构建 worktree 与冻结 SHA 不符')
        if self.adapter.command(['git', 'status', '--porcelain', '--untracked-files=no'], cwd=self.work).strip():
            raise RuntimeError('网关冻结 worktree 存在未提交修改')
        startup = self._startup()
        if self.desktop_meter:
            environment = read_json(self.target / 'gateway-env.json')
            if (environment.get('CODEX_APP_SERVER_MODE') != 'external' or
                    environment.get('CODEX_APP_SERVER_URL') != self.desktop_meter.options['upstreamUrl']):
                raise RuntimeError('桌面计量接入必须保持已确认的 external 网关来源')
            home = Path(environment.get('CODEX_HOME') or Path(environment.get('HOME') or Path.home()) / '.codex')
            expected_socket = home / 'mobile-model-upload/meter.sock'
            if Path(self.desktop_meter.options['socketPath']).absolute() != expected_socket.absolute():
                raise RuntimeError('桌面计量 socket 必须与网关现有状态目录的默认来源一致')
        tree_digest(self.package / 'dist')
        original = read_json(self.package / 'package.json')
        frozen = read_json(self.work / 'package.json')
        if original.get('dependencies', {}) != frozen.get('dependencies', {}):
            raise RuntimeError('网关依赖声明发生变化，现有安装依赖需要先验证')
        checkpoint = self._build()
        # 快照写入临时目录再 rename，避免恢复时采用半个旧包。
        if not self.backup.exists():
            temporary = self.backup.parent.with_name('gateway-backup-pending')
            if temporary.exists():
                shutil.rmtree(temporary)
            temporary.mkdir(parents=True)
            shutil.copytree(self.package, temporary / 'package', symlinks=True)
            temporary.replace(self.backup.parent)
        if self.stage.parent.exists():
            shutil.rmtree(self.stage.parent)
        self.stage.parent.mkdir(parents=True)
        shutil.copytree(self.backup, self.stage, symlinks=True)
        for relative in ('npm-dist/server', 'bin'):
            target = self.stage / relative
            if target.exists():
                shutil.rmtree(target)
            shutil.copytree(self.work / relative, target)
        shutil.copy2(self.work / 'package.json', self.stage / 'package.json')
        digests = self._digests(self.stage)
        if (digests['serverDigest'] != checkpoint['serverDigest'] or
                source_fingerprint(self.work) != checkpoint['sourceFingerprint']):
            raise RuntimeError('网关打包源指纹或服务端输出摘要与成功构建不符')
        atomic_json(self.stage / MARKER, {**self._identity(), **digests})
        pending = self.archive.with_suffix('.tgz.tmp')
        with tarfile.open(pending, 'w:gz') as archive:
            archive.add(self.stage, arcname='package')
        pending.replace(self.archive)
        record = {'identity': self._identity(), 'prepared': True, 'digests': digests,
                  'startup': startup, 'archiveSha256': sha256(self.archive)}
        if self.desktop_meter:
            record['desktopMeter'] = self.desktop_meter.prepare(self.work / 'npm-dist/server/desktop-model-upload.js')
        self._save(record)
        self.adapter.progress('gateway_prepared', sha=self.sha, **digests)
        return record

    def _unpack(self, target):
        """只解包自己手工打包的 tgz；先提取文件，再创建链接。"""
        target.mkdir(parents=True)
        with tarfile.open(self.archive, 'r:gz') as archive:
            links = []
            for member in archive.getmembers():
                relative = Path(member.name)
                if relative.is_absolute() or '..' in relative.parts or relative.parts[0] != 'package':
                    raise RuntimeError('网关 package tgz 含越界路径')
                path = target / relative
                if member.isdir():
                    path.mkdir(parents=True, exist_ok=True)
                elif member.isfile():
                    path.parent.mkdir(parents=True, exist_ok=True)
                    with archive.extractfile(member) as source, path.open('wb') as output:
                        shutil.copyfileobj(source, output)
                    path.chmod(member.mode & 0o777)
                elif member.issym():
                    links.append((path, member.linkname))
                else:
                    raise RuntimeError('网关 package tgz 含不支持的条目')
            for path, destination in links:
                path.parent.mkdir(parents=True, exist_ok=True)
                path.symlink_to(destination)

    def _install(self, record):
        # intent 在文件切换前落盘；崩溃后可根据包摘要补齐缺失动作。
        record['restart'] = {}
        record['installIntent'] = True
        self._save(record)
        pending = self.target / 'node_modules' / f'.codex-mobile-{self.batch}.pending'
        retired = self.target / 'node_modules' / f'.codex-mobile-{self.batch}.retired'
        if pending.exists():
            shutil.rmtree(pending)
        self._unpack(pending)
        if not self._matches(pending / 'package', record):
            raise RuntimeError('网关安装候选包摘要不符')
        if retired.exists():
            shutil.rmtree(retired)
        if self.package.exists():
            self.package.replace(retired)
        (pending / 'package').replace(self.package)
        shutil.rmtree(pending)
        # 原包已经保存在批次目录；移除用于原子切换的短期副本。
        if retired.exists():
            shutil.rmtree(retired)
        record['installed'] = True
        self._save(record)
        self.adapter.progress('gateway_installed', sha=self.sha, target=str(self.target))

    def run(self):
        observed = self.check()
        if observed['done']:
            record = self._record()
            record['receipt'] = observed['result']
            self._save(record)
            return observed['result']
        record = self._prepare()
        if not self._matches(self.package, record):
            self._install(record)
        if self.desktop_meter:
            self.desktop_meter.install(record['desktopMeter'])
        if not record.get('restart', {}).get('intent'):
            record['restart'] = {'intent': True, 'oldPid': self._pid(strict=True), 'startedAt': time.time()}
            self._save(record)
        observed = self.check()
        if not observed['done']:
            # kickstart 响应丢失时，后续 check 以真实新 PID、文件和 HTTP 确认。
            # 新 PID 已出现但健康接口尚未就绪，等待而不重复 kickstart。
            current_pid = self._pid(strict=True)
            if current_pid == record['restart'].get('oldPid') or current_pid is None:
                self.adapter.command(['launchctl', 'kickstart', '-k', self.service])
            attempts = int(self.adapter.options.get('gateway_health_attempts', 30))
            for attempt in range(max(1, attempts)):
                observed = self.check()
                if observed['done']:
                    break
                if attempt + 1 < attempts:
                    time.sleep(1)
        if not observed['done']:
            raise RuntimeError('网关部署尚未通过进程、文件与健康接口验收')
        record['receipt'] = observed['result']
        self._save(record)
        self.adapter.progress('gateway_deployed', **observed['result'])
        return observed['result']
