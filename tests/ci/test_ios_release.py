import json
import os
import sys
import io
import hashlib
from contextlib import ExitStack
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

    def test_compatibility_config_requires_pinned_private_ipa(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            for name in ('profile', 'p12', 'password', 'installed.ipa'):
                (root/name).write_text('fixture'); (root/name).chmod(0o600)
            (root/'ca.pem').write_text('public CA')
            config = dict(bundleId='app.example.mobile', udid='REGISTERED', profile='profile',
                          p12='p12', passwordFile='password', baseUrl='https://localhost:8766/channels/codex-mobile',
                          localRoot=str(root/'channel'), caFile='ca.pem', compatibilityIpa='installed.ipa')
            path = root/'config.json'; path.write_text(json.dumps(config)); path.chmod(0o600)
            with self.assertRaisesRegex(ValueError, 'compatibility'):
                self.release.load_config(path)
            config['compatibilityIpaSha256'] = 'a' * 64; path.write_text(json.dumps(config))
            loaded = self.release.load_config(path)
            self.assertEqual(loaded['compatibilityIpa'], str((root/'installed.ipa').resolve()))
            (root/'installed.ipa').chmod(0o644)
            with self.assertRaisesRegex(ValueError, '600'):
                self.release.load_config(path)

    def test_channel_restore_requires_explicit_source_and_compatibility_baseline(self):
        self.assertTrue(hasattr(self.release, 'restore_identity_transition'))
        previous = dict(bundleId='app.profile.assigned', version='0.2.125', sha256='a' * 64,
                        teamId='TEAM', applicationIdentifier='TEAM.app.profile.assigned')
        identity = {**previous, 'bundleId': 'vip.original.app'}
        config = dict(compatibilityIpa='installed.ipa', compatibilityIpaSha256='b' * 64,
                      restoreInstalledIdentityFromBundleId=previous['bundleId'])
        result = self.release.restore_identity_transition(config, identity, previous)
        self.assertEqual(result, dict(fromBundleId=previous['bundleId'], toBundleId=identity['bundleId'],
                                     previousVersion=previous['version'], previousSha256=previous['sha256'],
                                     compatibilityIpaSha256=config['compatibilityIpaSha256']))
        for key in config:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.release.restore_identity_transition({**config, key: ''}, identity, previous)
        self.assertIsNone(self.release.restore_identity_transition(config, identity, identity))

    def test_plan_preserves_dependency_tls_while_adding_ota_ca(self):
        config = dict(profile='private-profile', bundleId='app.example.mobile', udid='REGISTERED',
                      baseUrl='https://localhost:8766/channels/codex-mobile', caFile='/private/ota-ca.pem')
        with patch.dict(os.environ, {'SSL_CERT_FILE': '/original/system-ca.pem'}), \
             patch.object(sys, 'argv', ['release-ios.py', '--config', 'private-config', '--notes', 'update', '--plan']), \
             patch.object(self.release, 'load_config', return_value=config), \
             patch('ios_sign.read_profile', return_value={}), \
             patch('ios_sign.signing_identity', create=True, return_value={'bundleId': config['bundleId']}), \
             patch.object(self.release, 'fetch_previous', return_value=None), \
             patch.object(self.release, 'channel_versions', return_value=['0.2.122']), \
             patch.object(sys, 'stdout', io.StringIO()):
            self.release.main()
            self.assertEqual(os.environ['SSL_CERT_FILE'], '/original/system-ca.pem')
            self.assertEqual(os.environ['CODEX_MOBILE_OTA_CA_FILE'], config['caFile'])

    def test_plan_passes_pinned_baseline_to_signing_preflight(self):
        config = dict(profile='private-profile', bundleId='vip.original.app', udid='REGISTERED',
                      baseUrl='https://localhost:8766/channels/codex-mobile',
                      compatibilityIpa='/private/installed.ipa', compatibilityIpaSha256='b' * 64,
                      restoreInstalledIdentityFromBundleId='app.profile.assigned')
        previous = dict(bundleId='app.profile.assigned', teamId='TEAM',
                        applicationIdentifier='TEAM.app.profile.assigned', version='0.2.125',
                        buildNumber='2125', sha256='a' * 64)
        identity = {**previous, 'bundleId': config['bundleId']}
        output = io.StringIO()
        with patch.object(sys, 'argv', ['release-ios.py', '--config', 'private-config', '--notes', 'update', '--plan']), \
             patch.object(self.release, 'load_config', return_value=config), \
             patch('ios_sign.read_profile', return_value={}), \
             patch('ios_sign.signing_identity', create=True, return_value=identity) as signing, \
             patch.object(self.release, 'fetch_previous', return_value=previous), \
             patch.object(self.release, 'channel_versions', return_value=['0.2.125']), \
             patch.object(sys, 'stdout', output):
            self.release.main()
        signing.assert_called_once_with({}, 'vip.original.app', 'REGISTERED',
            compatibility_ipa=config['compatibilityIpa'], compatibility_ipa_sha256=config['compatibilityIpaSha256'])
        planned = json.loads(output.getvalue())
        self.assertEqual(planned['version'], '0.2.126')
        self.assertEqual(planned['identityTransition']['previousSha256'], previous['sha256'])

    def test_subsequent_plan_preserves_baseline_keychain_groups(self):
        groups = ['TEAM.*', 'com.apple.token']
        config = dict(profile='private-profile', bundleId='vip.original.app', udid='REGISTERED',
                      baseUrl='https://localhost:8766/channels/codex-mobile',
                      compatibilityIpa='/private/installed.ipa', compatibilityIpaSha256='b' * 64)
        previous = dict(bundleId=config['bundleId'], teamId='TEAM',
                        applicationIdentifier='TEAM.app.profile.assigned', version='0.2.128',
                        buildNumber='2128', sha256='a' * 64, keychainAccessGroups=groups)
        identity = {k: previous[k] for k in ('bundleId', 'teamId', 'applicationIdentifier')}
        identity['entitlements'] = {'keychain-access-groups': groups}
        with patch.object(sys, 'argv', ['release-ios.py', '--config', 'private-config', '--notes', 'update', '--plan']), \
             patch.object(self.release, 'load_config', return_value=config), \
             patch('ios_sign.read_profile', return_value={}), \
             patch('ios_sign.signing_identity', return_value=identity), \
             patch.object(self.release, 'fetch_previous', return_value=previous), \
             patch.object(self.release, 'channel_versions', return_value=['0.2.128']), \
             patch.object(sys, 'stdout', io.StringIO()) as output:
            self.release.main()
        self.assertEqual(json.loads(output.getvalue())['keychainAccessGroups'], groups)

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

    def test_plan_references_external_guide_without_running_source_workflow(self):
        config = dict(profile='profile', bundleId='vip.loock.codexmobile', udid='DEVICE',
                      baseUrl='https://ota.example')
        with patch.object(sys, 'argv', ['release-ios.py', '--config', 'config', '--notes', 'update', '--plan']), \
             patch.object(self.release, 'load_config', return_value=config), \
             patch('ios_sign.read_profile', return_value={}), \
             patch('ios_sign.signing_identity', return_value={'bundleId': config['bundleId']}), \
             patch.object(self.release, 'fetch_previous', return_value=None), \
             patch.object(self.release, 'channel_versions', return_value=['0.2.149']), \
             patch.object(sys, 'stdout', io.StringIO()) as output:
            self.release.main()
        plan = json.loads(output.getvalue())
        self.assertEqual(plan['steps'][-1], 'lan-publish-verify')
        self.assertEqual(plan['appSource']['status'], 'pending')
        self.assertEqual(plan['appSource']['instructionsUrl'],
            'https://github.com/zh0ngtian/SignOs/blob/main/cloudflare/app-source/PUBLISH_PROMPT.md')

    def test_receipt_is_saved_only_after_lan_full_get_verification(self):
        for valid_lan in (False, True):
            with self.subTest(valid_lan=valid_lan), tempfile.TemporaryDirectory() as directory:
                root = pathlib.Path(directory)
                publisher = root/'publisher.py'; publisher.touch()
                events = []
                package = b'signed ipa'
                release = dict(version='0.2.150', sha256=hashlib.sha256(package).hexdigest(), size=len(package))
                config = dict(profile='profile', p12='p12', bundleId='vip.loock.codexmobile', udid='DEVICE',
                              baseUrl='https://ota.example', localRoot=str(root/'ota'))
                def request(url, **kwargs):
                    if isinstance(url, str) and url.endswith('.json'):
                        return io.BytesIO(json.dumps(release).encode())
                    if not isinstance(url, str):
                        response = io.BytesIO(); response.headers = {'Content-Length': str(len(package))}
                        return response
                    events.append('lan-get')
                    return io.BytesIO(package if valid_lan else b'wrong')
                def sign(unsigned, signed, *args, **kwargs):
                    signed.write_bytes(package)
                    return release
                output = io.StringIO()
                patches = [
                    patch.object(sys, 'argv', ['release-ios.py', '--config', 'config', '--notes', 'update']),
                    patch.object(self.release, 'ROOT', root),
                    patch.object(self.release, 'LAN_PUBLISHER', publisher),
                    patch.object(self.release, 'load_config', return_value=config),
                    patch('ios_sign.read_profile', return_value={}),
                    patch('ios_sign.signing_identity', return_value={'bundleId': config['bundleId']}),
                    patch.object(self.release, 'fetch_previous', return_value=None),
                    patch.object(self.release, 'channel_versions', return_value=['0.2.149']),
                    patch.object(self.release, 'build_unsigned', side_effect=lambda v, c, p: p.write_bytes(b'unsigned')),
                    patch('ios_sign.sign_ipa', side_effect=sign),
                    patch.object(self.release, 'create_release', return_value=release),
                    patch.object(self.release, 'publish_local', side_effect=lambda *a: events.append('ota') or release),
                    patch.object(self.release.subprocess, 'run', side_effect=lambda *a, **k: events.append('lan-publish')),
                    patch.object(self.release.urllib.request, 'urlopen', side_effect=request),
                    patch.object(sys, 'stdout', output),
                ]
                with ExitStack() as stack:
                    for context in patches:
                        stack.enter_context(context)
                    if valid_lan:
                        self.release.main()
                    else:
                        with self.assertRaisesRegex(ValueError, '完整 GET'):
                            self.release.main()
                self.assertEqual(events, ['ota', 'lan-publish', 'lan-get'])
                receipt = root/'.mobile-build/ota-release/0.2.150/ota-release.json'
                self.assertEqual(receipt.exists(), valid_lan)
                if valid_lan:
                    self.assertEqual(json.loads(receipt.read_text()), release)
                    result = json.loads(output.getvalue())
                    self.assertEqual(result['appSource']['status'], 'pending')
                    self.assertEqual(result['releaseReceipt'], str(receipt))
                    self.assertTrue(pathlib.Path(result['ipaPath']).is_file())

if __name__ == '__main__': unittest.main()
