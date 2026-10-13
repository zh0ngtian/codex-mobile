"""协调器的服务端部署阶段：保留已部署前端与现有 LaunchAgent。"""
import hashlib
import json
import os
from pathlib import Path
import re
import shlex
import shutil
import tarfile
import time
import urllib.parse
import urllib.request

from .state import atomic_json, read_json, sha256

MARKER = '.codex-mobile-deployment.json'


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
        self.sha = adapter.context['frozen']['sha']
        self.batch = adapter.context['id']

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
            request = urllib.request.Request(f'http://127.0.0.1:{port}/api/status')
            token = env.get('CODEX_MOBILE_TOKEN')
            if token:
                request.add_header('Cookie', 'codex_mobile_token=' + urllib.parse.quote(str(token), safe="~()*!.'-"))
            with urllib.request.urlopen(request, timeout=3) as response:
                status = json.load(response)
            return status.get('mode') == mode and status.get('upstreamUrl') == upstream
        except Exception:
            # HTTP 错误文本和环境文件中可能含私有数据，仅返回验收状态。
            return False

    def check(self):
        record = self._record()
        if record.get('identity') != self._identity() or not self._matches(self.package, record):
            return {'done': False, 'result': {'reason': 'gateway_files'}}
        intent = record.get('restart', {})
        pid = self._pid()
        if (not intent.get('intent') or pid is None or pid == intent.get('oldPid') or
                not self._process_matches(pid) or not self._healthy(pid) or self._pid() != pid):
            return {'done': False, 'result': {'reason': 'gateway_runtime'}}
        receipt = {**self._identity(), **record['digests'], 'deploymentId': f'{self.batch}:{self.sha}',
                   'pid': pid, 'oldPid': intent.get('oldPid'), 'service': self.service,
                   'package': str(self.package), 'archiveSha256': record['archiveSha256']}
        return {'done': True, 'result': receipt}

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
        tree_digest(self.package / 'dist')
        original = read_json(self.package / 'package.json')
        frozen = read_json(self.work / 'package.json')
        if original.get('dependencies', {}) != frozen.get('dependencies', {}):
            raise RuntimeError('网关依赖声明发生变化，现有安装依赖需要先验证')
        output = self.work / 'npm-dist/server'
        if output.exists():
            shutil.rmtree(output)
        self.adapter.command(['npm', 'run', 'build:server'], cwd=self.work)
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
        atomic_json(self.stage / MARKER, {**self._identity(), **digests})
        pending = self.archive.with_suffix('.tgz.tmp')
        with tarfile.open(pending, 'w:gz') as archive:
            archive.add(self.stage, arcname='package')
        pending.replace(self.archive)
        record = {'identity': self._identity(), 'prepared': True, 'digests': digests,
                  'startup': startup, 'archiveSha256': sha256(self.archive)}
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
