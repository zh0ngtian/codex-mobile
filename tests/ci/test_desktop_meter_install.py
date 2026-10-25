"""真实临时文件验证桌面适配器安装、恢复与漂移保护；不启动或重启桌面。"""
import hashlib
import importlib
from pathlib import Path
import sys
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))


class DesktopMeterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix='desktop-meter-')
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.adapter = self.root / 'desktop-codex'
        self.original = b'#!/node\n// original desktop adapter\n'
        self.adapter.write_bytes(self.original)
        self.adapter.chmod(0o700)
        self.package = self.root / 'installed'
        self.module = self.package / 'npm-dist/server/desktop-model-upload.js'
        self.module.parent.mkdir(parents=True)
        self.module.write_text('export const runDesktopModelUpload = () => 0;')
        self.options = {'adapterPath': str(self.adapter), 'originalSha256': hashlib.sha256(self.original).hexdigest(),
                        'nodeExecutable': '/path/to/node', 'codexExecutable': '/path/to/codex',
                        'socketPath': str(self.root / 'private/meter.sock'), 'upstreamUrl': 'ws://127.0.0.1:14550/rpc'}

    def installer(self):
        module = importlib.import_module('release_coordination.desktop_meter')
        return module.DesktopMeterInstall(self.options, self.package)

    def test_prepare_is_read_only_then_install_preserves_exact_original(self):
        install = self.installer()
        plan = install.prepare(self.module)
        self.assertEqual(self.adapter.read_bytes(), self.original)
        self.assertFalse(Path(str(self.adapter) + '.pre-model-upload').exists())
        install.install(plan)
        self.assertTrue(install.check(plan))
        self.assertEqual(Path(str(self.adapter) + '.pre-model-upload').read_bytes(), self.original)
        self.assertEqual(self.adapter.stat().st_mode & 0o777, 0o700)
        self.assertIn(b'runDesktopModelUpload', self.adapter.read_bytes())
        self.assertEqual(install.receipt(plan)['activation'], 'requires-user-desktop-restart')

    def test_repeated_install_and_recovery_keep_original_backup(self):
        install = self.installer(); plan = install.prepare(self.module)
        backup = Path(str(self.adapter) + '.pre-model-upload')
        backup.write_bytes(self.original); backup.chmod(0o700)
        install.install(plan)
        first = self.adapter.read_bytes()
        again = self.installer(); recovered = again.prepare(self.module)
        again.install(recovered)
        self.assertEqual(first, self.adapter.read_bytes())
        self.assertEqual(backup.read_bytes(), self.original)

    def test_original_drift_is_rejected_before_writes(self):
        self.adapter.write_text('changed by another task')
        with self.assertRaisesRegex(RuntimeError, '适配器'):
            self.installer().prepare(self.module)
        self.assertFalse(Path(str(self.adapter) + '.pre-model-upload').exists())

    def test_interrupted_backup_write_does_not_publish_partial_original(self):
        install = self.installer(); plan = install.prepare(self.module)
        module = importlib.import_module('release_coordination.desktop_meter')
        with patch.object(module.os, 'fsync', side_effect=OSError('simulated disk interruption')):
            with self.assertRaises(OSError): install.install(plan)
        self.assertFalse(Path(str(self.adapter) + '.pre-model-upload').exists())
        self.assertEqual(self.adapter.read_bytes(), self.original)
        install.install(plan)
        self.assertTrue(install.check(plan))

    def test_module_or_backup_drift_is_not_accepted(self):
        install = self.installer(); plan = install.prepare(self.module)
        install.install(plan)
        self.module.write_text('drift')
        self.assertFalse(install.check(plan))
        with self.assertRaises(RuntimeError): install.install(plan)
        self.module.write_text('export const runDesktopModelUpload = () => 0;')
        backup = Path(str(self.adapter) + '.pre-model-upload'); backup.write_text('drift')
        self.assertFalse(install.check(plan))

    def test_symlink_and_public_adapter_are_rejected(self):
        self.adapter.chmod(0o755)
        with self.assertRaises(RuntimeError): self.installer().prepare(self.module)
        self.adapter.chmod(0o700)
        target = self.root / 'other'; self.adapter.rename(target); self.adapter.symlink_to(target)
        with self.assertRaises(RuntimeError): self.installer().prepare(self.module)


if __name__ == '__main__': unittest.main()
