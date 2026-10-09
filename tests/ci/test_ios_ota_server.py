"""LAN OTA 服务、证书与 launchd 边界测试。"""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import plistlib
import ssl
import socket
import tempfile
import threading
import unittest
import urllib.error
import urllib.request
from unittest.mock import patch

MODULE_PATH = Path(__file__).resolve().parents[2] / 'scripts/ios_ota_server.py'


def module():
    assert MODULE_PATH.exists(), '本机 LAN HTTPS OTA 服务尚未实现'
    spec = importlib.util.spec_from_file_location('ios_ota_server', MODULE_PATH)
    result = importlib.util.module_from_spec(spec); spec.loader.exec_module(result)
    return result


class InitializationTests(unittest.TestCase):
    def test_init_generates_private_tls_public_bootstrap_and_idempotent_config(self):
        m = module()
        with tempfile.TemporaryDirectory() as d:
            state = Path(d) / 'state'; config = m.init_state(state)
            self.assertEqual(config['baseUrl'], 'https://192.168.123.79:8766/channels/codex-mobile')
            self.assertEqual(config['localRoot'], str(state.resolve() / 'channels/codex-mobile'))
            self.assertEqual(state.stat().st_mode & 0o777, 0o700)
            self.assertEqual((state / 'tls').stat().st_mode & 0o777, 0o700)
            for name in ['ca.key', 'server.key']:
                self.assertEqual((state / 'tls' / name).stat().st_mode & 0o777, 0o600)
            ca_before = (state / 'tls/ca.pem').read_bytes()
            self.assertEqual(m.init_state(state), config)
            self.assertEqual((state / 'tls/ca.pem').read_bytes(), ca_before)
            public = plistlib.loads((state / 'public/codex-mobile-ca.mobileconfig').read_bytes())
            self.assertEqual(public['PayloadType'], 'Configuration')
            self.assertEqual(public['PayloadDisplayName'], 'Codex Mobile LAN CA')
            self.assertEqual(public['PayloadContent'][0]['PayloadType'], 'com.apple.security.root')
            self.assertEqual(public['PayloadContent'][0]['PayloadContent'], (state / 'public/codex-mobile-ca.cer').read_bytes())
            description = m.run(['/usr/bin/openssl', 'x509', '-in', state / 'tls/server.pem', '-text', '-noout']).decode()
            self.assertIn('IP Address:192.168.123.79', description)
            self.assertIn('IP Address:127.0.0.1', description)
            self.assertIn('DNS:localhost', description)
            self.assertIn('TLS Web Server Authentication', description)

    def test_init_refuses_repository_state_or_changed_existing_ca_configuration(self):
        m = module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); (root / '.git').mkdir()
            with self.assertRaises(m.ServerError): m.init_state(root / 'state')
        with tempfile.TemporaryDirectory() as d:
            state = Path(d) / 'state'; m.init_state(state)
            ca_before = (state / 'tls/ca.pem').read_bytes()
            with self.assertRaises(m.ServerError): m.init_state(state, host='10.0.0.1')
            self.assertEqual((state / 'tls/ca.pem').read_bytes(), ca_before)

    def test_launchd_uses_stable_python_path_when_executable_points_to_cellar(self):
        m = module()
        with tempfile.TemporaryDirectory() as d:
            state = Path(d) / 'state'; m.init_state(state)
            with patch.object(m.sys, 'executable', '/opt/homebrew/Cellar/python@3.11/old/bin/python3.11'), patch.object(m.shutil, 'which', return_value='/opt/homebrew/bin/python3'):
                self.assertEqual(m.launchd_spec(state)['ProgramArguments'][0], '/opt/homebrew/bin/python3')

    def test_renew_changes_only_leaf_certificate_under_same_ca(self):
        m = module()
        self.assertTrue(hasattr(m, 'renew_state'), '缺少保留 CA 的服务器证书续期')
        with tempfile.TemporaryDirectory() as d:
            state = Path(d) / 'state'; config = m.init_state(state)
            unchanged = {name: (state / name).read_bytes() for name in ['tls/ca.pem', 'tls/ca.key', 'tls/server.key', 'config.json', 'public/codex-mobile-ca.mobileconfig']}
            before = m.run(['/usr/bin/openssl', 'x509', '-in', state / 'tls/server.pem', '-fingerprint', '-sha256', '-noout'])
            m.renew_state(state)
            after = m.run(['/usr/bin/openssl', 'x509', '-in', state / 'tls/server.pem', '-fingerprint', '-sha256', '-noout'])
            self.assertNotEqual(before, after)
            self.assertEqual({name: (state / name).read_bytes() for name in unchanged}, unchanged)
            m.run(['/usr/bin/openssl', 'verify', '-CAfile', config['caFile'], state / 'tls/server.pem'])

    def test_load_refuses_permission_drift_and_symlinked_tls_directory(self):
        m = module()
        with tempfile.TemporaryDirectory() as d:
            state = Path(d) / 'state'; m.init_state(state)
            key = state / 'tls/ca.key'; key.chmod(0o644)
            with self.assertRaises(m.ServerError): m.load_config(state)
            key.chmod(0o600)
            tls = state / 'tls'; tls.rename(state / 'outside-tls'); tls.symlink_to('outside-tls', target_is_directory=True)
            with self.assertRaises(m.ServerError): m.load_config(state)

    def test_launchd_install_targets_user_domain_and_status_without_running_it(self):
        m = module(); commands = []
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); state = root / 'state'; m.init_state(state)
            def fake_run(command):
                commands.append([str(x) for x in command]); return b'pid = 1234'
            with patch.object(m.Path, 'home', return_value=root / 'home'), patch.object(m, 'run', side_effect=fake_run):
                result = m.install(state)
            self.assertEqual(result['pid'], 1234)
            self.assertTrue(result['running'])
            plist = root / 'home/Library/LaunchAgents/local.codex-mobile.ios-ota.plist'
            self.assertEqual(plist.stat().st_mode & 0o777, 0o600)
            self.assertEqual([command[1] for command in commands], ['bootout', 'bootstrap', 'enable', 'print'])
            self.assertTrue(all(command[0] == '/bin/launchctl' for command in commands))

    def test_openssl_failure_does_not_expose_key_or_tool_output(self):
        m = module()
        import subprocess
        error = subprocess.CalledProcessError(1, ['openssl'], stderr=b'private material')
        with patch.object(m.subprocess, 'run', side_effect=error):
            with self.assertRaises(m.ServerError) as caught: m.run(['/usr/bin/openssl', 'req'])
        self.assertNotIn('private material', str(caught.exception))

    def test_launchd_spec_uses_actual_script_and_python_without_installing(self):
        m = module()
        with tempfile.TemporaryDirectory() as d:
            state = Path(d) / 'state'; config = m.init_state(state)
            spec = m.launchd_spec(state)
            self.assertEqual(spec['Label'], 'local.codex-mobile.ios-ota')
            self.assertTrue(Path(spec['ProgramArguments'][0]).is_absolute())
            self.assertEqual(Path(spec['ProgramArguments'][1]), MODULE_PATH)
            self.assertIn('serve', spec['ProgramArguments'])
            self.assertEqual(spec['ProgramArguments'][-1], str(state.resolve()))
            self.assertTrue(spec['RunAtLoad'])
            self.assertTrue(spec['KeepAlive'])
            self.assertNotIn('ca.key', json.dumps(spec))


class HTTPBoundaryTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cls.m = module(); cls.temporary = tempfile.TemporaryDirectory(); cls.state = Path(cls.temporary.name) / 'state'
        cls.config = cls.m.init_state(cls.state)
        cls.root = Path(cls.config['localRoot']); release = cls.root / 'releases/1.2.3'; release.mkdir(parents=True)
        for name, data in [('latest.ipa', b'signed ipa bytes'), ('manifest.plist', b'<plist/>'), ('latest-ios.json', b'{"version":"1.2.3"}'), ('install.html', b'<h1>Install</h1>')]:
            (release / name).write_bytes(data)
        (cls.root / 'current').symlink_to('releases/1.2.3', target_is_directory=True)
        (cls.root / 'secret.key').write_text('private')
        (release / 'outside.json').symlink_to(cls.state / 'tls/ca.key')
        config = {**cls.config, 'httpsPort': 0, 'bootstrapPort': 0}
        cls.servers = cls.m.create_servers(config, bind_host='127.0.0.1')
        for server in cls.servers:
            thread = threading.Thread(target=server.serve_forever, daemon=True); thread.start()
        cls.context = ssl.create_default_context(cafile=cls.config['caFile'])
        cls.https = f'https://127.0.0.1:{cls.servers[0].server_address[1]}'
        cls.http = f'http://127.0.0.1:{cls.servers[1].server_address[1]}'

    @classmethod
    def tearDownClass(cls):
        for server in cls.servers: server.shutdown(); server.server_close()
        cls.temporary.cleanup()

    def request(self, path, *, bootstrap=False, method='GET', origin=None):
        request = urllib.request.Request((self.http if bootstrap else self.https) + path, method=method)
        if origin is not None: request.add_header('Origin', origin)
        return urllib.request.urlopen(request, context=self.context, timeout=3)

    def test_real_tls_get_head_current_symlink_and_mime(self):
        for name, content_type in [('latest.ipa', 'application/octet-stream'), ('manifest.plist', 'application/xml'), ('latest-ios.json', 'application/json'), ('install.html', 'text/html')]:
            with self.request('/channels/codex-mobile/current/' + name) as response:
                self.assertEqual(response.status, 200)
                self.assertEqual(response.headers.get_content_type(), content_type)
                data = response.read()
            with self.request('/channels/codex-mobile/releases/1.2.3/' + name, method='HEAD') as response:
                self.assertEqual(int(response.headers['Content-Length']), len(data))
                self.assertEqual(response.read(), b'')

    def test_access_log_identifies_install_requests_and_redacts_rejected_urls(self):
        output = io.StringIO()
        with patch.object(self.m.sys, 'stderr', output):
            with self.request('/channels/codex-mobile/current/latest-ios.json') as response:
                response.read()
            with self.request('/channels/codex-mobile/releases/1.2.3/latest.ipa', method='HEAD') as response:
                response.read()
            with self.assertRaises(urllib.error.HTTPError):
                self.request('/secret-password?token=secret-token')
        records = [json.loads(line) for line in output.getvalue().splitlines()]
        self.assertEqual(len(records), 3)
        self.assertEqual([(r['method'], r['status'], r['path']) for r in records], [
            ('GET', 200, '/channels/codex-mobile/current/latest-ios.json'),
            ('HEAD', 200, '/channels/codex-mobile/releases/1.2.3/latest.ipa'),
            ('GET', 404, '[rejected]')])
        for record in records:
            self.assertEqual(record['event'], 'ota_request')
            self.assertEqual(record['remoteAddress'], '127.0.0.1')
            self.assertTrue(record['time'].endswith('+00:00'))
        self.assertNotIn('secret-password', output.getvalue())
        self.assertNotIn('secret-token', output.getvalue())

    def test_idle_tcp_connection_cannot_block_other_tls_requests(self):
        stalled = socket.create_connection(self.servers[0].server_address, timeout=3)
        try:
            try:
                with self.request('/channels/codex-mobile/current/latest-ios.json') as response:
                    self.assertEqual(response.status, 200)
            except (TimeoutError, urllib.error.URLError):
                self.fail('未握手的 TCP 连接阻塞了整个 TLS 服务')
        finally:
            stalled.close()

    def test_bootstrap_only_serves_public_ca_and_mobileconfig(self):
        for name, mime in [('codex-mobile-ca.cer', 'application/x-x509-ca-cert'), ('codex-mobile-ca.mobileconfig', 'application/x-apple-aspen-config')]:
            with self.request('/' + name, bootstrap=True) as response:
                self.assertEqual(response.headers.get_content_type(), mime)
                self.assertTrue(response.read())
        for path in ['/', '/channels/codex-mobile/current/latest.ipa', '/tls/ca.key', '/latest-ios.json']:
            with self.assertRaises(urllib.error.HTTPError): self.request(path, bootstrap=True)

    def test_rejects_traversal_private_files_directory_listing_and_external_symlink(self):
        for path in ['/', '/channels/codex-mobile/current/', '/channels/codex-mobile/secret.key', '/tls/ca.key', '/channels/codex-mobile/current/outside.json', '/channels/codex-mobile/current/../secret.key', '/channels/codex-mobile/current/%2e%2e/secret.key', '/channels/codex-mobile/current/%2f..%2fsecret.key']:
            with self.subTest(path=path), self.assertRaises(urllib.error.HTTPError): self.request(path)
        target = self.root / 'releases/1.2.3/latest.ipa'; original = target.read_bytes(); target.unlink(); target.symlink_to(self.state / 'tls/ca.key')
        try:
            with self.assertRaises(urllib.error.HTTPError): self.request('/channels/codex-mobile/current/latest.ipa')
        finally:
            target.unlink(); target.write_bytes(original)

    def test_options_allows_only_null_get_head_preflight(self):
        for origin, method, expected in [('null', 'GET', 204), ('null', 'HEAD', 204), ('null', 'POST', 403), ('https://evil.example', 'GET', 403)]:
            request = urllib.request.Request(self.https + '/channels/codex-mobile/current/latest-ios.json', method='OPTIONS',
                headers={'Origin': origin, 'Access-Control-Request-Method': method})
            try:
                with urllib.request.urlopen(request, context=self.context, timeout=3) as response:
                    self.assertEqual(response.status, expected)
                    self.assertEqual(response.headers.get('Access-Control-Allow-Origin'), 'null')
                    self.assertEqual(response.headers.get('Access-Control-Allow-Methods'), 'GET, HEAD')
                    self.assertIsNone(response.headers.get('Access-Control-Allow-Credentials'))
            except urllib.error.HTTPError as error:
                self.assertEqual(error.code, expected)

    def test_cors_allows_only_null_file_origin_without_credentials(self):
        for origin in ['null', 'https://evil.example', None]:
            with self.request('/channels/codex-mobile/current/latest-ios.json', origin=origin) as response:
                self.assertEqual(response.headers.get('Access-Control-Allow-Origin'), 'null' if origin == 'null' else None)
                self.assertIsNone(response.headers.get('Access-Control-Allow-Credentials'))
                self.assertIsNone(response.headers.get('Set-Cookie'))
        with self.assertRaises(urllib.error.HTTPError): self.request('/channels/codex-mobile/current/latest-ios.json', method='POST', origin='null')
        request = urllib.request.Request(self.https + '/channels/codex-mobile/current/latest-ios.json', method='OPTIONS',
            headers={'Origin': 'null', 'Access-Control-Request-Method': 'GET', 'Access-Control-Request-Headers': 'Authorization'})
        with self.assertRaises(urllib.error.HTTPError) as caught: urllib.request.urlopen(request, context=self.context, timeout=3)
        self.assertEqual(caught.exception.code, 403)


if __name__ == '__main__': unittest.main()
