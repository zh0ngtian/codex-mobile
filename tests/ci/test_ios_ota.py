import importlib.util
import json
import pathlib
import plistlib
import tempfile
import unittest
import os
import ssl
import subprocess
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
                with patch.dict(os.environ, {'SSL_CERT_FILE': str(cert)}):
                    self.ota.verify_published(release)
                    (root/'app/current/latest.ipa').write_bytes(b'tampered data')
                    with self.assertRaisesRegex(ValueError, '大小|校验'):
                        self.ota.verify_published(release)
            finally:
                server.shutdown(); server.server_close(); thread.join()

if __name__ == '__main__':
    unittest.main()
