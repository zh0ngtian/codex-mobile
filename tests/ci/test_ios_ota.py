import importlib.util
import json
import pathlib
import plistlib
import tempfile
import unittest
import os
import ssl
import subprocess
import sys
import threading
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from unittest.mock import patch

SCRIPT = pathlib.Path(__file__).resolve().parents[2] / 'scripts/ios_ota.py'

class OtaTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(SCRIPT.exists(), 'OTA 发布组件尚未实现')
        spec = importlib.util.spec_from_file_location('ios_ota', SCRIPT)
        self.ota = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(self.ota)
        self.meta = dict(signed=True, bundleId='app.example.mobile', teamId='TEAM123456',
                         applicationIdentifier='PREFIX1234.app.example.mobile', profileExpiresAt='2027-10-03T04:08:22Z',
                         version='1.2.3', buildNumber='1002003')

    def test_https_only(self):
        for url in ['http://example.com/app', 'https://user:pass@example.com/app',
                    'https://example.com/app?q=x', 'https://example.com/app#x', 'https://example.com/app/../bad']:
            with self.assertRaises(ValueError):
                self.ota.validate_base_url(url)
        self.assertEqual(self.ota.validate_base_url('https://example.com/app/'), 'https://example.com/app')

    def test_redirect_never_downgrades_to_http(self):
        handler = self.ota.HttpsOnlyRedirectHandler()
        import urllib.request
        req = urllib.request.Request('https://example.com/app')
        with self.assertRaises(ValueError):
            handler.redirect_request(req, None, 302, 'redirect', {}, 'http://example.com/app')
        self.assertEqual(handler.redirect_request(req, None, 302, 'redirect', {}, 'https://example.com/new').full_url, 'https://example.com/new')

    def test_ci_next_version_includes_local_ota_version(self):
        self.assertEqual(self.ota.resolve_version('0.2.86', '0.2.115'), '0.2.116')
        self.assertEqual(self.ota.resolve_version('0.2.120', '0.2.115'), '0.2.121')
        self.assertEqual(self.ota.resolve_version('0.2.86', '0.2.115', '0.2.117'), '0.2.117')
        with self.assertRaises(ValueError):
            self.ota.resolve_version('0.2.86', '0.2.115', '0.2.115')

    def test_manifest_uses_versioned_ipa_and_fixed_install_page(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            ipa = root / 'signed.ipa'
            ipa.write_bytes(b'signed fixture')
            dest = root / 'release'
            release = self.ota.create_release(ipa, self.meta, dest, 'https://example.com/app', '修复更新')
            manifest = plistlib.loads((dest / 'manifest.plist').read_bytes())
            item = manifest['items'][0]
            self.assertEqual(item['assets'][0]['url'], 'https://example.com/app/releases/1.2.3/latest.ipa')
            self.assertEqual(item['metadata']['bundle-identifier'], self.meta['bundleId'])
            self.assertEqual(item['metadata']['bundle-version'], '1002003')
            self.assertEqual(release['installUrl'], 'https://example.com/app/current/install.html')
            self.assertEqual(release['pageUrl'], 'https://example.com/app/current/latest-ios.json')
            self.assertEqual(release['size'], ipa.stat().st_size)
            self.assertIn('itms-services://?action=download-manifest&amp;url=https%3A', (dest / 'install.html').read_text())
            self.assertNotIn('UDID', json.dumps(release))

    def test_rejects_unsigned_and_identity_changes(self):
        with tempfile.TemporaryDirectory() as directory:
            ipa = pathlib.Path(directory) / 'app.ipa'
            ipa.write_bytes(b'ipa')
            with self.assertRaises(ValueError):
                self.ota.create_release(ipa, {**self.meta, 'signed': False}, pathlib.Path(directory)/'a', 'https://example.com/app', '')
            previous = {**self.meta, 'version': '1.2.2', 'buildNumber': '1002002', 'notes': 'old'}
            for changed in ['bundleId', 'teamId', 'applicationIdentifier']:
                with self.assertRaises(ValueError):
                    self.ota.validate_upgrade(self.meta, {**previous, changed: 'other'})
            self.ota.validate_upgrade(self.meta, previous)
            for version in ['1.2.3', '2.0.0']:
                with self.assertRaises(ValueError):
                    self.ota.validate_upgrade(self.meta, {**previous, 'version': version})

    def make_release(self, root, notes='修复更新'):
        ipa = root/'signed.ipa'; ipa.write_bytes(b'signed fixture')
        source = root/'release'
        release = self.ota.create_release(ipa, self.meta, source, 'https://example.com/app', notes)
        return source, release

    def check_install_ui(self, scenario):
        with tempfile.TemporaryDirectory() as directory:
            source, _ = self.make_release(pathlib.Path(directory), '<img src=x onerror=alert(1)> & 更新')
            result = subprocess.run(['node', str(SCRIPT.parents[1]/'tests/ci/ios_ota_waiting_ui.mjs'), scenario],
                                    input=(source/'install.html').read_text(), text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)

    def test_install_first_click_requests_immediately_and_announces_wait(self):
        self.check_install_ui('first-click')

    def test_install_wait_blocks_repeated_click(self):
        self.check_install_ui('repeat-click')

    def test_install_timeout_allows_retry_without_claiming_result(self):
        self.check_install_ui('timeout')

    def test_install_foreground_recovers_after_suspended_timer(self):
        self.check_install_ui('foreground')

    def test_install_modified_click_does_not_show_wait(self):
        self.check_install_ui('modified-click')

    def test_install_without_javascript_keeps_link_and_escaped_notes(self):
        self.check_install_ui('no-javascript')

    def test_install_spinner_respects_reduced_motion(self):
        self.check_install_ui('reduced-motion')

    def test_refresh_changes_only_html_and_preserves_current_package(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source, release = self.make_release(root)
            server = root/'server'; self.ota.activate_local(source, server)
            current = server/'current'
            def snapshot(path, symlink=False):
                stat = path.lstat() if symlink else path.stat()
                return (path.readlink() if symlink else path.read_bytes(), stat.st_ino,
                        stat.st_mode, stat.st_size, stat.st_mtime_ns, stat.st_ctime_ns)
            paths = [current/name for name in ('latest.ipa', 'manifest.plist', 'latest-ios.json')]
            before = [snapshot(path) for path in paths]
            link_before = snapshot(current, symlink=True)
            (current/'install.html').write_text('old page')
            result = subprocess.run([sys.executable, str(SCRIPT), 'refresh-page', '--root', str(server)],
                                    capture_output=True, text=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            page = (current/'install.html').read_text()
            self.assertIn('正在请求系统安装，请等待弹窗', page)
            self.assertIn(release['sha256'], page)
            self.assertEqual((current/'install.html').stat().st_mode & 0o777, 0o644)
            self.assertEqual([snapshot(path) for path in paths], before)
            self.assertEqual(snapshot(current, symlink=True), link_before)
            self.assertFalse(list(current.glob('.install-*')))

    def test_refresh_rejects_damaged_package_before_changing_html(self):
        for broken in ('latest.ipa', 'manifest.plist', 'latest-ios.json'):
            with self.subTest(broken=broken), tempfile.TemporaryDirectory() as directory:
                root = pathlib.Path(directory)
                source, _ = self.make_release(root)
                server = root/'server'; self.ota.activate_local(source, server)
                page = server/'current/install.html'
                before = page.read_bytes()
                path = server/'current'/broken
                if broken == 'latest.ipa':
                    path.write_bytes(b'tampered')
                elif broken == 'manifest.plist':
                    manifest = plistlib.loads(path.read_bytes())
                    manifest['items'][0]['metadata']['bundle-identifier'] = 'other.app'
                    path.write_bytes(plistlib.dumps(manifest))
                else:
                    release = json.loads(path.read_text()); release['size'] += 1
                    path.write_text(json.dumps(release))
                self.assertTrue(hasattr(self.ota, 'refresh_install_page'), '缺少安装页刷新功能')
                with self.assertRaises(ValueError):
                    self.ota.refresh_install_page(server)
                self.assertEqual(page.read_bytes(), before)
                self.assertFalse(list(page.parent.glob('.install-*')))

    def test_refresh_requires_current_in_recorded_version_directory(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source, _ = self.make_release(root)
            server = root/'server'; self.ota.activate_local(source, server)
            current = server/'current'; current.unlink(); current.symlink_to(source)
            self.assertTrue(hasattr(self.ota, 'refresh_install_page'), '缺少安装页刷新功能')
            before = (source/'install.html').read_bytes()
            with self.assertRaises(ValueError):
                self.ota.refresh_install_page(server)
            self.assertEqual((source/'install.html').read_bytes(), before)

    def test_refresh_cleans_temporary_page_after_replace_failure(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            source, _ = self.make_release(root)
            server = root/'server'; self.ota.activate_local(source, server)
            page = server/'current/install.html'; before = page.read_bytes()
            self.assertTrue(hasattr(self.ota, 'refresh_install_page'), '缺少安装页刷新功能')
            with patch.object(self.ota.os, 'replace', side_effect=OSError('replace failed')):
                with self.assertRaises(OSError):
                    self.ota.refresh_install_page(server)
            self.assertEqual(page.read_bytes(), before)
            self.assertFalse(list(page.parent.glob('.install-*')))

    def test_local_activation_is_atomic_and_blocks_old_versions(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            ipa = root / 'signed.ipa'; ipa.write_bytes(b'ipa')
            staging = root / 'staging'
            self.ota.create_release(ipa, self.meta, staging, 'https://example.com/app', 'first')
            server = root / 'server'
            self.ota.activate_local(staging, server)
            current = json.loads((server/'current/latest-ios.json').read_text())
            self.assertEqual(current['version'], '1.2.3')
            self.assertTrue((server/'current').is_symlink())
            self.assertEqual((server/'current').stat().st_mode & 0o777, 0o755)
            self.assertEqual((server/'current/latest.ipa').stat().st_mode & 0o777, 0o644)
            with self.assertRaises(ValueError):
                self.ota.activate_local(staging, server)
            newer = {**self.meta, 'version': '1.2.4', 'buildNumber': '1002004'}
            staging2 = root / 'staging2'
            self.ota.create_release(ipa, newer, staging2, 'https://example.com/app', 'second')
            self.ota.activate_local(staging2, server)
            self.assertEqual(json.loads((server/'current/latest-ios.json').read_text())['version'], '1.2.4')
            self.assertTrue((server/'releases/1.2.3/latest.ipa').exists())

    def test_identity_restore_is_bound_to_previous_release_and_preserves_team(self):
        previous = {**self.meta, 'version': '1.2.2', 'buildNumber': '1002002',
                    'bundleId': 'app.profile.assigned', 'sha256': 'a' * 64,
                    'keychainAccessGroups': ['PREFIX1234.app.profile.assigned']}
        transition = dict(fromBundleId=previous['bundleId'], toBundleId=self.meta['bundleId'],
                          previousVersion=previous['version'], previousSha256=previous['sha256'],
                          compatibilityIpaSha256='b' * 64)
        restored = {**self.meta, 'identityTransition': transition,
                    'keychainAccessGroups': ['PREFIX1234.*', 'com.apple.token']}
        self.ota.validate_upgrade(restored, previous)
        for key, value in [('fromBundleId', 'other.app'), ('toBundleId', 'other.app'),
                           ('previousVersion', '1.2.1'), ('previousSha256', 'c' * 64),
                           ('compatibilityIpaSha256', '')]:
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.ota.validate_upgrade({**restored, 'identityTransition': {**transition, key: value}}, previous)
        for key in ('teamId', 'applicationIdentifier'):
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.ota.validate_upgrade({**restored, key: 'OTHER'}, previous)
        with self.assertRaises(ValueError):
            self.ota.validate_upgrade(restored, None)

    def test_normal_upgrade_retains_recorded_keychain_groups(self):
        previous = {**self.meta, 'version': '1.2.2', 'buildNumber': '1002002',
                    'keychainAccessGroups': ['PREFIX1234.*', 'com.apple.token']}
        self.ota.validate_upgrade({**self.meta, 'keychainAccessGroups': previous['keychainAccessGroups']}, previous)
        with self.assertRaises(ValueError):
            self.ota.validate_upgrade({**self.meta, 'keychainAccessGroups': ['PREFIX1234.app.example.mobile']}, previous)

    def test_restoration_is_rechecked_before_atomic_activation(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory); ipa = root/'signed.ipa'; ipa.write_bytes(b'ipa')
            previous_meta = {**self.meta, 'bundleId': 'app.profile.assigned',
                             'version': '1.2.2', 'buildNumber': '1002002'}
            old_source = root/'old-source'
            previous = self.ota.create_release(ipa, previous_meta, old_source, 'https://example.com/app', 'old')
            server = root/'server'; self.ota.activate_local(old_source, server)
            restored_meta = {**self.meta, 'identityTransition': dict(
                fromBundleId=previous['bundleId'], toBundleId=self.meta['bundleId'],
                previousVersion=previous['version'], previousSha256=previous['sha256'],
                compatibilityIpaSha256='b' * 64)}
            source = root/'restored'
            self.ota.create_release(ipa, restored_meta, source, 'https://example.com/app', 'restore', previous)
            self.ota.stage_local(source, server)
            changed = {**previous, 'sha256': 'c' * 64}
            (server/'current/latest-ios.json').write_text(json.dumps(changed))
            with self.assertRaises(ValueError):
                self.ota.activate_staged(source, server)
            self.assertEqual((server/'current').readlink(), pathlib.Path('releases/1.2.2'))
            (server/'current/latest-ios.json').write_text(json.dumps(previous))
            self.ota.activate_staged(source, server)
            self.assertEqual((server/'current').readlink(), pathlib.Path('releases/1.2.3'))

    def test_https_real_head_get_manifest_and_tamper_detection(self):
        with tempfile.TemporaryDirectory() as directory:
            root = pathlib.Path(directory)
            cert = root/'cert.pem'; key = root/'key.pem'
            conf = root/'openssl.cnf'
            conf.write_text("[req]\ndistinguished_name=dn\nx509_extensions=ext\nprompt=no\n[dn]\nCN=localhost\n[ext]\nsubjectAltName=DNS:localhost\nbasicConstraints=critical,CA:TRUE\n")
            subprocess.run(['openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                            '-days', '1', '-config', str(conf), '-keyout', str(key), '-out', str(cert)],
                           check=True, capture_output=True)
            class QuietHandler(SimpleHTTPRequestHandler):
                def log_message(self, *args): pass
            server = ThreadingHTTPServer(('127.0.0.1', 0), partial(QuietHandler, directory=str(root)))
            ctx = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER); ctx.load_cert_chain(cert, key)
            server.socket = ctx.wrap_socket(server.socket, server_side=True)
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
            try:
                base = f'https://localhost:{server.server_port}/app'
                ipa = root/'signed.ipa'; ipa.write_bytes(b'signed fixture')
                staging = root/'staging'
                release = self.ota.create_release(ipa, self.meta, staging, base, 'first')
                self.ota.activate_local(staging, root/'app')
                with patch.dict(os.environ, {'CODEX_MOBILE_OTA_CA_FILE': str(cert)}):
                    self.ota.verify_published(release)
                    (root/'app/current/latest.ipa').write_bytes(b'tampered data')
                    with self.assertRaisesRegex(ValueError, '大小|校验'):
                        self.ota.verify_published(release)
            finally:
                server.shutdown(); server.server_close(); thread.join()

if __name__ == '__main__':
    unittest.main()
