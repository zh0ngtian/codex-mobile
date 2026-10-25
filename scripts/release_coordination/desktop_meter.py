"""协调安装桌面计量启动层；不退出、启动或重启桌面 App。"""
import hashlib
import json
import os
from pathlib import Path
import stat
import tempfile

from .state import sha256


def desktop_meter_options(options, tasks):
    """安装输入随任务验证冻结；不改变现役项目的目标、环境或共享锁配置。"""
    selected = options.get('gateway_desktop_meter')
    for task in tasks:
        validation = task.get('validation', {})
        if 'desktopModelMeter' not in validation:
            continue
        requested = validation['desktopModelMeter']
        if (not isinstance(requested, dict) or validation.get('scope') != 'gateway-only' or
                validation.get('sourceCommit') != task.get('sha')):
            raise RuntimeError('桌面计量安装参数必须绑定网关任务的实际来源 SHA')
        if selected is not None and selected != requested:
            raise RuntimeError('桌面计量安装参数在任务或项目配置之间冲突')
        selected = requested
    return selected


class DesktopMeterInstall:
    def __init__(self, options, package):
        self.options = dict(options)
        self.package = Path(package)
        self.adapter = Path(options['adapterPath']).expanduser().absolute()
        self.backup = self.adapter.with_name(self.adapter.name + '.pre-model-upload')
        self.module = self.package / 'npm-dist/server/desktop-model-upload.js'
        self.original_sha = options['originalSha256']
        node = options['nodeExecutable']
        if not Path(node).is_absolute() or any(c.isspace() for c in node):
            raise RuntimeError('桌面计量 Node 入口必须是无空白绝对路径')
        if len(self.original_sha) != 64 or any(c not in '0123456789abcdef' for c in self.original_sha):
            raise RuntimeError('桌面适配器原始摘要无效')
        config = {key: options[key] for key in ('codexExecutable', 'nodeExecutable', 'socketPath', 'upstreamUrl')}
        config['originalAdapter'] = str(self.backup)
        self.launcher = (f'#!{node}\n// Codex Mobile desktop model upload meter; original adapter retained.\n'
                         f'import({json.dumps(self.module.as_uri())}).then(async module => {{\n'
                         f'  process.exitCode = await module.runDesktopModelUpload({json.dumps(config)});\n'
                         '}).catch(() => { console.error("桌面模型计量启动失败，请检查安装与配置"); process.exitCode = 1; });\n').encode()
        self.launcher_sha = hashlib.sha256(self.launcher).hexdigest()

    def _private(self, path, directory=False):
        try:
            info = path.lstat()
        except OSError:
            raise RuntimeError('桌面适配器或私有目录缺失') from None
        expected = stat.S_ISDIR(info.st_mode) if directory else stat.S_ISREG(info.st_mode)
        if (not expected or info.st_uid != os.getuid() or info.st_mode & 0o077):
            raise RuntimeError('桌面适配器必须为当前用户所有的私有常规文件及目录')

    def _guard(self):
        self._private(self.adapter.parent, directory=True)
        self._private(self.adapter)
        current = sha256(self.adapter)
        if current not in (self.original_sha, self.launcher_sha):
            raise RuntimeError('桌面适配器与已确认原始摘要或安装候选不符')
        if self.backup.exists() or self.backup.is_symlink():
            self._private(self.backup)
            if sha256(self.backup) != self.original_sha:
                raise RuntimeError('桌面适配器原始备份摘要不符')
        elif current == self.launcher_sha:
            raise RuntimeError('桌面适配器缺少原始备份，拒绝接纳现有启动层')

    def prepare(self, module_file):
        self._guard()
        module = Path(module_file)
        if not module.is_file() or module.is_symlink():
            raise RuntimeError('桌面计量模块缺失')
        return {'launcherSha256': self.launcher_sha, 'originalSha256': self.original_sha,
                'moduleSha256': sha256(module)}

    def install(self, plan):
        self._guard()
        if (plan.get('launcherSha256') != self.launcher_sha or plan.get('originalSha256') != self.original_sha or
                not self.module.is_file() or self.module.is_symlink() or sha256(self.module) != plan.get('moduleSha256')):
            raise RuntimeError('桌面计量安装计划或模块摘要不符')
        if not self.backup.exists():
            # 先写完整原件再原子链接；中断不能留下可见的半份备份。
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=self.adapter.parent, prefix='.desktop-original-', delete=False) as output:
                    temporary = Path(output.name)
                    output.write(self.adapter.read_bytes()); output.flush(); os.fsync(output.fileno())
                temporary.chmod(0o700)
                self._guard()
                os.link(temporary, self.backup)
            finally:
                if temporary is not None and temporary.exists(): temporary.unlink()
        self._guard()
        if sha256(self.adapter) != self.launcher_sha:
            temporary = None
            try:
                with tempfile.NamedTemporaryFile(dir=self.adapter.parent, prefix='.desktop-meter-', delete=False) as output:
                    temporary = Path(output.name)
                    output.write(self.launcher); output.flush(); os.fsync(output.fileno())
                temporary.chmod(0o700)
                self._guard()
                temporary.replace(self.adapter)
                descriptor = os.open(self.adapter.parent, os.O_RDONLY)
                try: os.fsync(descriptor)
                finally: os.close(descriptor)
            finally:
                if temporary is not None and temporary.exists(): temporary.unlink()
        if not self.check(plan):
            raise RuntimeError('桌面计量安装后回验失败')

    def check(self, plan):
        try:
            self._guard()
            return (plan.get('launcherSha256') == self.launcher_sha and plan.get('originalSha256') == self.original_sha and
                    sha256(self.adapter) == self.launcher_sha and self.backup.is_file() and
                    self.module.is_file() and not self.module.is_symlink() and sha256(self.module) == plan.get('moduleSha256'))
        except (OSError, RuntimeError):
            return False

    def receipt(self, plan):
        return {**plan, 'activation': 'requires-user-desktop-restart'}
