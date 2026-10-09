import json
from unittest.mock import patch
import importlib.util
import pathlib
import tempfile
import unittest

SCRIPT = pathlib.Path(__file__).resolve().parents[2]/'scripts/release-ios.py'

class ReleaseTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.exists(), '缺少 iOS 统一发布入口')
        spec = importlib.util.spec_from_file_location('release_ios', SCRIPT)
        self.release = importlib.util.module_from_spec(spec); spec.loader.exec_module(self.release)

    def test_next_version_exceeds_both_channels(self):
        self.assertEqual(self.release.next_version(['0.2.115', '0.3.1', '0.2.0']), '0.3.2')
        with self.assertRaises(ValueError):
            self.release.require_new_version('0.2.115', ['0.2.115', '0.2.114'])
        self.release.require_new_version('0.2.116', ['0.2.115', '0.2.114'])

    def test_config_requires_matching_profile_not_automatic_bundle_guess(self):
        with tempfile.TemporaryDirectory() as directory:
            path = pathlib.Path(directory)/'config.json'
            path.write_text('{}'); path.chmod(0o600)
            with self.assertRaisesRegex(ValueError, 'bundleId'):
                self.release.load_config(path)
            path.chmod(0o644)
            with self.assertRaisesRegex(ValueError, '600'):
                self.release.load_config(path)

    def test_local_config_requires_ca_and_excludes_remote_mode(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for name in ('profile', 'p12', 'password'):
                (root/name).write_text('fixture'); (root/name).chmod(0o600)
            (root/'ca.pem').write_text('public CA')
            config = dict(bundleId='app.example.mobile', udid='REGISTERED', profile='profile',
                          p12='p12', passwordFile='password', baseUrl='https://localhost:8766/channels/codex-mobile',
                          localRoot=str(root/'channel'), caFile='ca.pem')
            path = root/'config.json'; path.write_text(json.dumps(config)); path.chmod(0o600)
            loaded = self.release.load_config(path)
            self.assertEqual(loaded['localRoot'], str((root/'channel').resolve()))
            self.assertEqual(loaded['caFile'], str((root/'ca.pem').resolve()))
            config.pop('caFile'); path.write_text(json.dumps(config))
            with self.assertRaisesRegex(ValueError, 'caFile'):
                self.release.load_config(path)
            config.update(caFile='ca.pem', sshHost='user@example.com', remoteRoot='/var/www/app')
            path.write_text(json.dumps(config))
            with self.assertRaisesRegex(ValueError, '同时'):
                self.release.load_config(path)

    def test_local_publish_checks_staged_https_before_activation(self):
        release = {'version': '1.2.3'}
        events = []
        with patch.object(self.release, 'stage_local', side_effect=lambda *args: events.append('stage')), \
             patch.object(self.release, 'verify_published', side_effect=lambda value, fixed=True: events.append('fixed' if fixed else 'version')), \
             patch.object(self.release, 'activate_staged', side_effect=lambda *args: events.append('activate')):
            self.assertEqual(self.release.publish_local('source', '/channel', release), release)
        self.assertEqual(events, ['stage', 'version', 'activate', 'fixed'])
        events.clear()
        with patch.object(self.release, 'stage_local', side_effect=lambda *args: events.append('stage')), \
             patch.object(self.release, 'verify_published', side_effect=ValueError('TLS failure')), \
             patch.object(self.release, 'activate_staged') as activate:
            with self.assertRaisesRegex(ValueError, 'TLS failure'):
                self.release.publish_local('source', '/channel', release)
            activate.assert_not_called()

if __name__ == '__main__': unittest.main()
