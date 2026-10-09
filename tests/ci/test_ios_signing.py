"""Ad Hoc 签名边界与隔离行为测试；无需本机证书。"""
import contextlib
import datetime as dt
import io
import hashlib
import importlib.util
import json
from pathlib import Path
import plistlib
import stat
import ssl
import subprocess
import sys
import tempfile
import unittest
from unittest.mock import patch
import zipfile

MODULE_PATH = Path(__file__).resolve().parents[2] / 'scripts' / 'ios_sign.py'


def module():
    assert MODULE_PATH.exists(), '独立 iOS 签名模块尚未实现'
    spec = importlib.util.spec_from_file_location('ios_sign', MODULE_PATH)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


def profile():
    return {
        'ExpirationDate': dt.datetime(2030, 1, 1),
        'ProvisionedDevices': ['test-udid'],
        'TeamIdentifier': ['TEAM123'],
        'ApplicationIdentifierPrefix': ['OLDPREFIX'],
        'DeveloperCertificates': [b'certificate'],
        'Entitlements': {
            'application-identifier': 'OLDPREFIX.vip.example.app',
            'com.apple.developer.team-identifier': 'TEAM123',
            'keychain-access-groups': ['OLDPREFIX.*'],
            'get-task-allow': False,
            'aps-environment': 'production',
        },
    }


class ProfileTests(unittest.TestCase):
    def test_minimal_entitlements_distinguish_app_prefix_and_team(self):
        result = module().validate_profile(profile(), 'vip.example.app', 'test-udid')
        self.assertEqual(result['entitlements'], {
            'application-identifier': 'OLDPREFIX.vip.example.app',
            'com.apple.developer.team-identifier': 'TEAM123',
            'keychain-access-groups': ['OLDPREFIX.vip.example.app'],
            'get-task-allow': False,
        })
        self.assertEqual(result['teamId'], 'TEAM123')
        self.assertNotIn('test-udid', json.dumps(result))

    def test_adhoc_rejects_development_enterprise_and_appstore(self):
        m = module()
        cases = [dict(ProvisionsAllDevices=True), dict(ProvisionedDevices=[])]
        for updates in cases:
            p = profile(); p.update(updates)
            with self.assertRaises(m.SigningError):
                m.validate_profile(p, 'vip.example.app', 'test-udid')
        for value in [True, None, 'false', 0]:
            p = profile(); p['Entitlements']['get-task-allow'] = value
            with self.assertRaises(m.SigningError):
                m.validate_profile(p, 'vip.example.app', 'test-udid')

    def test_expired_profile_and_missing_device_are_rejected(self):
        m = module()
        p = profile(); p['ExpirationDate'] = dt.datetime(2000, 1, 1)
        with self.assertRaisesRegex(m.SigningError, '过期'):
            m.validate_profile(p, 'vip.example.app', 'test-udid')
        with self.assertRaisesRegex(m.SigningError, 'UDID'):
            m.validate_profile(profile(), 'vip.example.app', 'missing')

    def test_wildcard_matches_only_authorized_bundle_id(self):
        m = module(); p = profile()
        p['Entitlements']['application-identifier'] = 'OLDPREFIX.vip.example.*'
        result = m.validate_profile(p, 'vip.example.other', 'test-udid')
        self.assertEqual(result['applicationIdentifier'], 'OLDPREFIX.vip.example.other')
        for bundle_id in ['vip.other.app', 'vip.example', 'vip.example.*', 'vip.example/app']:
            with self.assertRaises(m.SigningError):
                m.validate_profile(p, bundle_id, 'test-udid')

    def test_rejects_mismatching_team_prefix_and_keychain_authorization(self):
        m = module()
        mutations = [
            ('TeamIdentifier', ['OTHER']),
            ('ApplicationIdentifierPrefix', ['OTHER']),
            ('DeveloperCertificates', []),
        ]
        for key, value in mutations:
            p = profile(); p[key] = value
            with self.assertRaises(m.SigningError):
                m.validate_profile(p, 'vip.example.app', 'test-udid')
        p = profile(); p['Entitlements']['keychain-access-groups'] = ['OTHER.*']
        with self.assertRaises(m.SigningError):
            m.validate_profile(p, 'vip.example.app', 'test-udid')


class ArchiveTests(unittest.TestCase):
    def test_safe_unpack_preserves_executable_permission(self):
        m = module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); ipa = root / 'in.ipa'
            with zipfile.ZipFile(ipa, 'w') as z:
                info = zipfile.ZipInfo('Payload/App.app/App'); info.external_attr = (stat.S_IFREG | 0o755) << 16
                z.writestr(info, b'fake executable')
                z.writestr('Payload/App.app/Info.plist', plistlib.dumps({'CFBundleIdentifier': 'vip.example.app'}))
            app = m.unpack_ipa(ipa, root / 'out')
            self.assertEqual(app.name, 'App.app')
            self.assertEqual((app / 'App').stat().st_mode & 0o777, 0o755)

    def test_archive_rejects_traversal_absolute_duplicate_and_symlink_entries(self):
        m = module()
        for name in ['../outside', '/outside', 'Payload/../../outside', 'Payload\\..\\outside']:
            with self.subTest(name=name), tempfile.TemporaryDirectory() as d:
                root = Path(d); ipa = root / 'in.ipa'
                with zipfile.ZipFile(ipa, 'w') as z: z.writestr(name, b'x')
                with self.assertRaises(m.SigningError): m.unpack_ipa(ipa, root / 'out')
                self.assertFalse((root / 'outside').exists())
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); ipa = root / 'in.ipa'
            with zipfile.ZipFile(ipa, 'w') as z:
                info = zipfile.ZipInfo('Payload/App.app/link'); info.external_attr = (stat.S_IFLNK | 0o777) << 16
                z.writestr(info, '../../outside')
            with self.assertRaises(m.SigningError): m.unpack_ipa(ipa, root / 'out')

    def test_normalized_duplicate_archive_paths_rejected(self):
        m = module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); ipa = root / 'in.ipa'
            with zipfile.ZipFile(ipa, 'w') as z:
                z.writestr('Payload/App.app/Info.plist', plistlib.dumps({'CFBundleIdentifier': 'vip.example.app'}))
                z.writestr('Payload//App.app/Info.plist', b'overwrite')
            with self.assertRaises(m.SigningError): m.unpack_ipa(ipa, root / 'out')

    def test_multiple_apps_and_extensions_rejected(self):
        m = module()
        for extra in ['Payload/Other.app/Info.plist', 'Payload/App.app/PlugIns/Widget.appex/Info.plist']:
            with tempfile.TemporaryDirectory() as d:
                root = Path(d); ipa = root / 'in.ipa'
                with zipfile.ZipFile(ipa, 'w') as z:
                    z.writestr('Payload/App.app/Info.plist', plistlib.dumps({'CFBundleIdentifier': 'vip.example.app'}))
                    z.writestr(extra, b'x')
                with self.assertRaises(m.SigningError): m.unpack_ipa(ipa, root / 'out')

    def test_signature_entitlements_must_match_profile_exactly(self):
        m = module(); expected = m.validate_profile(profile(), 'vip.example.app', 'test-udid')
        m.validate_signed_entitlements(expected['entitlements'], expected)
        for key, value in [('application-identifier', 'TEAM123.vip.example.app'), ('get-task-allow', True), ('aps-environment', 'production')]:
            altered = dict(expected['entitlements']); altered[key] = value
            with self.assertRaises(m.SigningError): m.validate_signed_entitlements(altered, expected)


class ToolBoundaryTests(unittest.TestCase):
    def test_command_failure_never_exposes_password_or_stderr(self):
        m = module()
        import subprocess
        error = subprocess.CalledProcessError(1, ['security', 'import', '-P', 'secret'], stderr=b'secret')
        with patch.object(m.subprocess, 'run', side_effect=error):
            with self.assertRaises(m.SigningError) as caught: m.run(['security', 'import', '-P', 'secret'])
        self.assertNotIn('secret', str(caught.exception))

    def test_command_timeout_is_sanitized(self):
        m = module()
        import subprocess
        error = subprocess.TimeoutExpired(['security', 'import', '-P', 'secret'], 120, stderr=b'secret')
        with patch.object(m.subprocess, 'run', side_effect=error):
            with self.assertRaises(Exception) as caught: m.run(['security', 'import', '-P', 'secret'])
        self.assertIsInstance(caught.exception, m.SigningError)
        self.assertNotIn('secret', str(caught.exception))

    def test_temporary_keychain_deleted_even_on_failure_without_changing_search_list(self):
        m = module(); commands = []
        def fake_run(command):
            commands.append(command); return b''
        with tempfile.TemporaryDirectory() as d, patch.object(m, 'run', side_effect=fake_run):
            with self.assertRaisesRegex(RuntimeError, 'stop'):
                with m.temporary_keychain(Path(d)):
                    raise RuntimeError('stop')
        verbs = [c[1] for c in commands]
        self.assertIn('create-keychain', verbs)
        self.assertIn('delete-keychain', verbs)
        self.assertNotIn('default-keychain', verbs)
        self.assertNotIn('list-keychains', verbs)

    def test_p12_identity_must_be_authorized_by_profile(self):
        m = module()
        with tempfile.TemporaryDirectory() as d, patch.object(m, 'run', return_value=b' 1) AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA "Apple Distribution"\n'):
            with self.assertRaisesRegex(m.SigningError, '证书'):
                m.import_identity(Path('input.p12'), 'secret', Path('isolated.keychain-db'), 'keychain-secret', profile(), Path(d))

    def test_cli_password_requires_exactly_one_secret_source(self):
        m = module()
        common = ['--ipa', 'a.ipa', '--output', 'b.ipa', '--profile', 'a.mobileprovision', '--p12', 'a.p12', '--bundle-id', 'vip.example.app', '--udid', 'test-udid']
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit): m.parse_args(common)
        parsed = m.parse_args(common + ['--password-file', 'secret.txt'])
        self.assertEqual(parsed.password_file, 'secret.txt')
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit): m.parse_args(common + ['--password-file', 'secret.txt', '--password-keychain-service', 'codex'])

    def test_signing_failure_removes_incomplete_output_and_metadata(self):
        m = module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); ipa = root / 'in.ipa'; output = root / 'out.ipa'
            ipa.write_bytes(b'bad'); (root / 'secret').write_text('secret')
            with patch.object(m, 'require_macos'), patch.object(m, 'read_profile', return_value=profile()):
                with self.assertRaises(m.SigningError):
                    m.sign_ipa(ipa, output, root / 'profile', root / 'p12', password_file=root / 'secret', bundle_id='vip.example.app', udid='test-udid')
            self.assertFalse(output.exists())
            self.assertFalse(Path(str(output) + '.signing.json').exists())


def der(tag, data):
    size = len(data); count = (size.bit_length() + 7) // 8
    length = bytes([size]) if size < 128 else bytes([0x80 + count]) + size.to_bytes(count, 'big')
    return bytes([tag]) + length + data


def certificate(profile_marker=False):
    validity = der(0x30, der(0x17, b'240101000000Z') + der(0x17, b'300101000000Z'))
    tbs = der(0x30, der(0x02, b'\x01') + der(0x30, b'') + der(0x30, b'') + validity)
    if profile_marker:
        extension = der(0x30, der(6, bytes.fromhex('2a864886f76364063a')) + der(4, b'\x05\x00'))
        _, body, _ = module().der_item(tbs)
        tbs = der(0x30, body + der(0xa3, der(0x30, extension)))
    return der(0x30, tbs)


class FullFlowTests(unittest.TestCase):
    def test_certificate_validity_rejects_expired_and_truncated_der(self):
        m = module()
        m.certificate_validity(certificate(), dt.datetime(2026, 1, 1))
        with self.assertRaisesRegex(m.SigningError, '过期'):
            m.certificate_validity(certificate(), dt.datetime(2031, 1, 1))
        with self.assertRaises(m.SigningError): m.certificate_validity(certificate()[:-1])

    def test_password_file_requires_private_permissions_and_preserves_content(self):
        m = module()
        with tempfile.TemporaryDirectory() as d:
            secret = Path(d) / 'password'; secret.write_text('  test secret  \n')
            secret.chmod(0o644)
            with self.assertRaises(m.SigningError): m.read_password(secret)
            secret.chmod(0o600)
            self.assertEqual(m.read_password(secret), '  test secret  ')

    def test_signature_metadata_reports_version_build_and_rejects_info_identity_mismatch(self):
        m = module(); p = profile(); p['DeveloperCertificates'] = [certificate()]
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); app = root / 'App.app'; app.mkdir()
            info = {'CFBundleIdentifier': 'vip.example.app', 'CFBundleShortVersionString': '1.2.3', 'CFBundleVersion': '42',
                    'CodexMobileTeamID': 'TEAM123', 'CodexMobileApplicationIdentifier': 'OLDPREFIX.vip.example.app'}
            info_path = app / 'Info.plist'; info_path.write_bytes(plistlib.dumps(info))
            expected = m.validate_profile(p, 'vip.example.app')
            extraction_commands = []
            def fake_run(command):
                if '--entitlements' in command: return plistlib.dumps(expected['entitlements'])
                extract = next((str(c) for c in command if str(c).startswith('--extract-certificates')), None)
                if extract:
                    extraction_commands.append(extract)
                    prefix = extract.split('=', 1)[1] if '=' in extract else str(command[-2])
                    Path(prefix + '0').write_bytes(certificate())
                return b''
            with patch.object(m, 'run', side_effect=fake_run), patch.object(m, 'read_profile', return_value=p):
                result = m.verify_app(app, root)
                self.assertEqual(result.get('version'), '1.2.3')
                self.assertEqual(result.get('buildNumber'), '42')
                self.assertTrue(extraction_commands[0].startswith('--extract-certificates='), 'codesign 的可选参数必须使用等号')
                info['CodexMobileTeamID'] = 'OTHER'; info_path.write_bytes(plistlib.dumps(info))
                with self.assertRaises(m.SigningError): m.verify_app(app, root)
                info['CodexMobileTeamID'] = 'TEAM123'; info['CFBundleVersion'] = 42
                info_path.write_bytes(plistlib.dumps(info))
                with self.assertRaises(m.SigningError): m.verify_app(app, root)

    def test_full_signing_writes_identity_preserves_urls_and_signs_inside_out(self):
        m = module(); p = profile(); cert = certificate(); p['DeveloperCertificates'] = [cert]
        identity = hashlib.sha1(cert).hexdigest().upper()
        expected = m.validate_profile(p, 'vip.example.app', 'test-udid')
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); ipa = root / 'input.ipa'; output = root / 'signed.ipa'
            profile_path = root / 'profile'; profile_path.write_bytes(b'profile placeholder')
            secret = root / 'password'; secret.write_text('secret'); secret.chmod(0o600)
            info = {'CFBundleIdentifier': 'old.bundle.app', 'CFBundleShortVersionString': '1.2.3', 'CFBundleVersion': '42',
                    'CodexMobileUpdateURL': 'https://update.example', 'CodexMobileInstallURL': 'https://install.example'}
            with zipfile.ZipFile(ipa, 'w') as z:
                z.writestr('Payload/App.app/Info.plist', plistlib.dumps(info))
                z.writestr('Payload/App.app/Frameworks/Outer.framework/Frameworks/Inner.framework/Inner', b'binary')
                z.writestr('Payload/App.app/Frameworks/Outer.framework/Outer', b'binary')
                z.writestr('Payload/App.app/Frameworks/lib.dylib', b'binary')
            commands = []
            def fake_run(command):
                commands.append(command)
                if command[:2] == ['security', 'find-identity']:
                    return f' 1) {identity} "Apple Distribution"\n'.encode()
                if command[:2] == ['codesign', '-d'] and '--entitlements' in command:
                    return plistlib.dumps(expected['entitlements'])
                extract = next((str(c) for c in command if str(c).startswith('--extract-certificates')), None)
                if extract:
                    prefix = extract.split('=', 1)[1] if '=' in extract else str(command[-2])
                    Path(prefix + '0').write_bytes(cert)
                return b''
            with patch.object(m, 'require_macos'), patch.object(m, 'read_profile', return_value=p), patch.object(m, 'run', side_effect=fake_run):
                result = m.sign_ipa(ipa, output, profile_path, root / 'input.p12', password_file=secret,
                                    bundle_id='vip.example.app', udid='test-udid')
            self.assertTrue(result['signed'])
            self.assertEqual(result.get('version'), '1.2.3')
            sidecar = Path(str(output) + '.signing.json')
            self.assertEqual(json.loads(sidecar.read_text()), result)
            self.assertNotIn('test-udid', sidecar.read_text())
            with zipfile.ZipFile(output) as z:
                signed_info = plistlib.loads(z.read('Payload/App.app/Info.plist'))
            self.assertEqual(signed_info['CodexMobileTeamID'], 'TEAM123')
            self.assertEqual(signed_info['CodexMobileApplicationIdentifier'], 'OLDPREFIX.vip.example.app')
            self.assertEqual(signed_info['CodexMobileUpdateURL'], info['CodexMobileUpdateURL'])
            self.assertEqual(signed_info['CodexMobileInstallURL'], info['CodexMobileInstallURL'])
            signed_paths = [Path(c[-1]).name for c in commands if c[0] == 'codesign' and '--sign' in c]
            self.assertLess(signed_paths.index('Inner.framework'), signed_paths.index('Outer.framework'))
            self.assertEqual(signed_paths[-1], 'App.app')
            self.assertIn('delete-keychain', [c[1] for c in commands])
            replace = m.os.replace
            interrupted_output = root / 'interrupted.ipa'
            def interrupt_sidecar(source, target):
                if str(target).endswith('.signing.json'): raise KeyboardInterrupt()
                replace(source, target)
            with patch.object(m, 'require_macos'), patch.object(m, 'read_profile', return_value=p), patch.object(m, 'run', side_effect=fake_run), patch.object(m.os, 'replace', side_effect=interrupt_sidecar):
                with self.assertRaises(KeyboardInterrupt):
                    m.sign_ipa(ipa, interrupted_output, profile_path, root / 'input.p12', password_file=secret,
                               bundle_id='vip.example.app', udid='test-udid')
            self.assertFalse(interrupted_output.exists())
            self.assertFalse(Path(str(interrupted_output) + '.signing.json').exists())


class CMSAuthenticityTests(unittest.TestCase):
    def test_profile_authentication_uses_only_system_apple_roots_without_keychain_mutation(self):
        m = module(); commands = []; temporary_roots = []
        def fake_run(command):
            commands.append([str(x) for x in command])
            if command[:2] == ['security', 'find-certificate']:
                return b'-----BEGIN CERTIFICATE-----\ntrusted system Apple roots\n-----END CERTIFICATE-----\n'
            if command[0] == '/usr/bin/openssl':
                root_path = Path(command[command.index('-CAfile') + 1])
                temporary_roots.append(root_path)
                if '-signer' in command:
                    Path(command[command.index('-signer') + 1]).write_text(ssl.DER_cert_to_PEM_cert(certificate(profile_marker=True)))
                self.assertTrue(root_path.is_file())
                self.assertIn(b'trusted system Apple roots', root_path.read_bytes())
            return plistlib.dumps(profile())
        with patch.object(m, 'require_macos'), patch.object(m, 'run', side_effect=fake_run):
            self.assertEqual(m.read_profile(Path('input.mobileprovision')), profile())
        self.assertEqual([c[0] for c in commands], ['security', '/usr/bin/openssl'])
        self.assertEqual(commands[0], ['security', 'find-certificate', '-a', '-c', 'Apple Root CA', '-p', '/System/Library/Keychains/SystemRootCertificates.keychain'])
        self.assertTrue(temporary_roots)
        self.assertTrue(all(not p.exists() for p in temporary_roots))
        verification = commands[1]
        self.assertIn('-verify', verification)
        self.assertIn('-CApath', verification)
        self.assertNotIn('-noverify', verification)
        self.assertNotIn('-nosigs', verification)

    def test_unsigned_or_forged_cms_is_not_accepted_as_a_profile(self):
        m = module()
        for failure in ['unsigned CMS', 'forged certificate CMS']:
            with self.subTest(failure=failure):
                root_paths = []
                def fake_run(command):
                    if command[:2] == ['security', 'find-certificate']: return b'Apple roots'
                    if command[0] == '/usr/bin/openssl':
                        root_paths.append(Path(command[command.index('-CAfile') + 1]))
                        raise m.SigningError('CMS authentication failed')
                    # security cms -D 只解码时会返回不受信任的正文。
                    return plistlib.dumps(profile())
                with patch.object(m, 'require_macos'), patch.object(m, 'run', side_effect=fake_run):
                    with self.assertRaises(m.SigningError): m.read_profile(Path('forged.mobileprovision'))
                self.assertTrue(all(not p.exists() for p in root_paths))


class VerifyCLITests(unittest.TestCase):
    def test_verify_mode_requires_no_signing_parameters(self):
        m = module()
        with contextlib.redirect_stderr(io.StringIO()):
            try:
                args = m.parse_args(['--verify-ipa', 'installed.ipa'])
            except SystemExit:
                self.fail('独立验签入口尚未实现')
        self.assertEqual(args.verify_ipa, 'installed.ipa')
        with contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            m.parse_args(['--verify-ipa', 'installed.ipa', '--profile', 'profile.mobileprovision'])

    def test_verify_cli_prints_public_metadata_and_sanitizes_unexpected_errors(self):
        m = module(); output = io.StringIO()
        metadata = {'bundleId': 'vip.example.app', 'signed': True, 'version': '1.2.3', 'buildNumber': '42'}
        with patch.object(m, 'verify_ipa', return_value=metadata), contextlib.redirect_stdout(output), contextlib.redirect_stderr(io.StringIO()):
            try:
                code = m.main(['--verify-ipa', 'installed.ipa'])
            except SystemExit:
                self.fail('独立验签入口尚未实现')
        self.assertEqual(code, 0)
        self.assertEqual(json.loads(output.getvalue()), metadata)
        errors = io.StringIO()
        with patch.object(m, 'verify_ipa', side_effect=RuntimeError('secret')), contextlib.redirect_stderr(errors):
            self.assertEqual(m.main(['--verify-ipa', 'installed.ipa']), 1)
        self.assertNotIn('secret', errors.getvalue())


@unittest.skipUnless(sys.platform == 'darwin', '真实 CMS 验证需要 macOS 系统 Apple root keychain')
class RealCMSAttackTests(unittest.TestCase):
    def test_unsigned_cms_rejected_without_touching_user_keychains(self):
        m = module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            content = plistlib.dumps(profile())
            oid_data = der(6, bytes.fromhex('2a864886f70d010701'))
            oid_signed = der(6, bytes.fromhex('2a864886f70d010702'))
            encapsulated = der(0x30, oid_data + der(0xa0, der(4, content)))
            unsigned = der(0x30, oid_signed + der(0xa0, der(0x30, der(2, b'\x01') + der(0x31, b'') + encapsulated + der(0x31, b''))))
            path = root / 'unsigned.mobileprovision'; path.write_bytes(unsigned)
            before = subprocess.check_output(['security', 'list-keychains', '-d', 'user'])
            with self.assertRaisesRegex(m.SigningError, 'CMS'): m.read_profile(path)
            after = subprocess.check_output(['security', 'list-keychains', '-d', 'user'])
            self.assertEqual(before, after)

    def test_cms_signed_by_fake_apple_root_is_rejected(self):
        m = module()
        with tempfile.TemporaryDirectory() as d:
            root = Path(d); data = root / 'profile.plist'; data.write_bytes(plistlib.dumps(profile()))
            key = root / 'fake-key.pem'; cert = root / 'fake-root.pem'; cms = root / 'forged.mobileprovision'
            subprocess.run(['/usr/bin/openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes',
                            '-keyout', str(key), '-out', str(cert), '-subj', '/CN=Apple Root CA', '-days', '1'],
                           check=True, capture_output=True, timeout=30)
            subprocess.run(['/usr/bin/openssl', 'cms', '-sign', '-binary', '-nodetach', '-in', str(data),
                            '-signer', str(cert), '-inkey', str(key), '-outform', 'DER', '-out', str(cms)],
                           check=True, capture_output=True, timeout=30)
            with self.assertRaisesRegex(m.SigningError, 'CMS'): m.read_profile(cms)

    def test_real_profile_payload_tampering_rejected(self):
        m = module()
        source = Path.home() / 'Library/Application Support/CodexMobile/signing/adhoc.mobileprovision'
        if not source.is_file(): self.skipTest('未配置本机真实 Ad Hoc profile')
        verified = m.read_profile(source)
        self.assertIsInstance(verified.get('Entitlements'), dict)
        for developer_certificate in verified['DeveloperCertificates']:
            with self.assertRaisesRegex(m.SigningError, '专用签名证书'):
                m.validate_profile_signer_certificate(developer_certificate)
        original = source.read_bytes()
        # 改动 CMS 中一个 plist 字节，不调整 CMS 结构或签名。
        position = original.find(b'<plist')
        if position < 0: self.skipTest('此 profile 的 CMS payload 不含 XML plist')
        tampered = bytearray(original); tampered[position + 1] ^= 1
        with tempfile.TemporaryDirectory() as d:
            path = Path(d) / 'tampered.mobileprovision'; path.write_bytes(tampered)
            with self.assertRaisesRegex(m.SigningError, 'CMS'): m.read_profile(path)


class ProfileSignerPolicyTests(unittest.TestCase):
    def test_profile_signer_requires_dedicated_apple_provisioning_marker(self):
        m = module()
        self.assertTrue(hasattr(m, 'validate_profile_signer_certificate'), '缺少 profile 专用 signer policy')
        m.validate_profile_signer_certificate(certificate(profile_marker=True))
        with self.assertRaises(m.SigningError): m.validate_profile_signer_certificate(certificate())

    def test_trusted_developer_signer_and_multiple_cms_signers_rejected(self):
        m = module()
        for signer_bytes in [ssl.DER_cert_to_PEM_cert(certificate()).encode(),
                             (ssl.DER_cert_to_PEM_cert(certificate(profile_marker=True)) * 2).encode()]:
            def fake_run(command):
                if command[:2] == ['security', 'find-certificate']: return b'Apple roots'
                if '-signer' in command:
                    Path(command[command.index('-signer') + 1]).write_bytes(signer_bytes)
                return plistlib.dumps(profile())
            with patch.object(m, 'require_macos'), patch.object(m, 'run', side_effect=fake_run):
                with self.assertRaises(m.SigningError): m.read_profile(Path('developer-signed.mobileprovision'))


class PKCS12CompatibilityTests(unittest.TestCase):
    def test_conversion_keeps_private_material_encrypted_and_temporary(self):
        m = module()
        self.assertTrue(hasattr(m, 'compatible_pkcs12'), '缺少兼容 macOS 的安全 P12 转换')
        commands = []; temporary_paths = []
        def fake_run(command):
            commands.append([str(x) for x in command])
            if '-out' in command:
                output = Path(command[command.index('-out') + 1])
                self.assertEqual(output.stat().st_mode & 0o777, 0o600)
                self.assertEqual(output.parent.stat().st_mode & 0o777, 0o700)
                output.write_bytes(b'encrypted test material')
            for flag in ('-passin', '-passout'):
                value = command[command.index(flag) + 1]
                self.assertTrue(value.startswith('file:'))
                secret = Path(value[5:])
                self.assertEqual(secret.stat().st_mode & 0o777, 0o600)
                temporary_paths.append(secret)
            return b''
        with tempfile.TemporaryDirectory() as d, patch.object(m, 'run', side_effect=fake_run):
            source = Path(d) / 'original.p12'; source.write_bytes(b'original')
            with m.compatible_pkcs12(source, 'original-secret', Path(d)) as (compatible, password):
                self.assertTrue(compatible.is_file())
                self.assertNotEqual(password, 'original-secret')
                temporary_paths.append(compatible)
                self.assertEqual(source.read_bytes(), b'original')
            self.assertTrue(all(not path.exists() for path in temporary_paths))
        self.assertEqual(len(commands), 2)
        self.assertNotIn('-nodes', commands[0])
        self.assertIn('-des3', commands[0])
        self.assertIn('-export', commands[1])
        self.assertIn('PBE-SHA1-3DES', commands[1])
        self.assertNotEqual(commands[1][commands[1].index('-passin') + 1], commands[1][commands[1].index('-passout') + 1])
        self.assertNotIn('original-secret', str(commands))

    def test_conversion_failure_cleans_all_temporary_material(self):
        m = module()
        self.assertTrue(hasattr(m, 'compatible_pkcs12'), '缺少兼容 macOS 的安全 P12 转换')
        with tempfile.TemporaryDirectory() as d:
            root = Path(d)
            with patch.object(m, 'run', side_effect=m.SigningError('conversion failed')):
                with self.assertRaises(m.SigningError):
                    with m.compatible_pkcs12(root / 'original.p12', 'secret', root): pass
            self.assertEqual(list(root.iterdir()), [])

    def test_import_uses_converted_container_and_keeps_profile_cert_matching(self):
        m = module(); cert = certificate(); p = profile(); p['DeveloperCertificates'] = [cert]
        identity = hashlib.sha1(cert).hexdigest().upper(); commands = []
        def fake_run(command):
            commands.append(command)
            if command[:2] == ['security', 'find-identity']:
                return f' 1) {identity} "Apple Distribution"\n'.encode()
            return b''
        with tempfile.TemporaryDirectory() as d, patch.object(m, 'run', side_effect=fake_run):
            root = Path(d)
            result = m.import_identity(root / 'original.p12', 'original-secret', root / 'isolated.keychain-db', 'keychain-secret', p, root)
            self.assertEqual(result, identity)
        import_command = next(command for command in commands if command[:2] == ['security', 'import'])
        self.assertNotEqual(Path(import_command[2]).name, 'original.p12')
        self.assertNotEqual(import_command[import_command.index('-P') + 1], 'original-secret')


if __name__ == '__main__':
    unittest.main()
