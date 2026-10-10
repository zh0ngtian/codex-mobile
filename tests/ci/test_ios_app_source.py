import hashlib
import json
from pathlib import Path
import plistlib
import sys
import tempfile
import unittest
from unittest.mock import patch
from types import SimpleNamespace
import zipfile

SCRIPTS = Path(__file__).resolve().parents[2] / 'scripts'
sys.path.insert(0, str(SCRIPTS))


class SourceTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue((SCRIPTS / 'ios_app_source.py').exists(), '缺少软件源发布适配器')
        import ios_app_source
        self.module = ios_app_source
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.root = Path(self.tmp.name)
        self.ipa = self.root / 'app.ipa'
        with zipfile.ZipFile(self.ipa, 'w') as archive:
            archive.writestr('Payload/App.app/Info.plist', plistlib.dumps(dict(
                CFBundleIdentifier='vip.loock.codexmobile', CFBundleShortVersionString='0.2.150',
                CFBundleVersion='2150')))
        self.receipt = dict(signed=True, bundleId='vip.loock.codexmobile', version='0.2.150',
                            buildNumber='2150', size=self.ipa.stat().st_size,
                            sha256=hashlib.sha256(self.ipa.read_bytes()).hexdigest(),
                            notes='更新说明', publishedAt='2026-10-10T12:00:00+00:00')
        self.receipt_path = self.root / 'ota-release.json'
        self.receipt_path.write_text(json.dumps(self.receipt))
        self.config = dict(baseUrl='https://source.example', name='Test', identifier='test')

    def source(self):
        release = dict(version='0.2.149', buildVersion='2149', size=4, sha256='a' * 64,
                       downloadURL='https://source.example/files/old.ipa')
        return dict(sourceURL='https://source.example/source.json', apps=[dict(
            bundleIdentifier='vip.loock.codexmobile', iconURL='https://source.example/files/icon.png',
            versions=[release.copy()], **release)])

    def test_receipt_matches_real_package_without_resigning(self):
        before = self.ipa.read_bytes()
        self.assertEqual(self.module.prepare(self.ipa, self.receipt_path), self.receipt)
        self.assertEqual(self.ipa.read_bytes(), before)

    def test_developer_append_preserves_existing_names_and_format(self):
        self.assertTrue(hasattr(self.module, 'merge_developer'), '缺少追加署名规则')
        cases = [('', 'zh0ngtian'), (None, 'zh0ngtian'),
                 ('loock-ai / Yao', 'loock-ai / Yao / zh0ngtian'),
                 ('loock-ai / zh0ngtian', 'loock-ai / zh0ngtian'),
                 ('Yao, @ZH0NGTIAN; Other', 'Yao, @ZH0NGTIAN; Other'),
                 ('Yao & zh0ngtian', 'Yao & zh0ngtian'),
                 ('Yao (@zh0ngtian)', 'Yao (@zh0ngtian)'),
                 ('zh0ngtian-tools', 'zh0ngtian-tools / zh0ngtian')]
        for existing, expected in cases:
            with self.subTest(existing=existing):
                result = self.module.merge_developer(existing, 'zh0ngtian')
                self.assertEqual(result, expected)
                self.assertEqual(self.module.merge_developer(result, 'zh0ngtian'), expected)
        with self.assertRaises(ValueError):
            self.module.merge_developer(['Yao'], 'zh0ngtian')

    def test_github_login_uses_authenticated_user_and_fails_without_valid_identity(self):
        self.assertTrue(hasattr(self.module, 'current_github_user'), '不能硬编码发布用户名')
        with patch.object(self.module.subprocess, 'run', return_value=SimpleNamespace(
                returncode=0, stdout='another-publisher\n')) as run:
            self.assertEqual(self.module.current_github_user(), 'another-publisher')
        self.assertEqual(run.call_args.args[0], ['gh', 'api', '--hostname', 'github.com', 'user', '--jq', '.login'])
        for code, output in [(1, ''), (0, ''), (0, 'name / other')]:
            with patch.object(self.module.subprocess, 'run', return_value=SimpleNamespace(returncode=code, stdout=output)):
                with self.assertRaises(ValueError):
                    self.module.current_github_user()

    def test_rejects_unsigned_or_mismatched_receipt(self):
        for key, value in dict(signed=False, size=1, sha256='b' * 64,
                               bundleId='other.app', version='0.2.151', buildNumber='2151').items():
            with self.subTest(key=key):
                self.receipt_path.write_text(json.dumps({**self.receipt, key: value}))
                with self.assertRaises(ValueError):
                    self.module.prepare(self.ipa, self.receipt_path)

    def test_candidate_allows_same_bytes_retry_but_rejects_conflict_or_downgrade(self):
        source = self.source()
        self.module.check_candidate(source, self.receipt)
        app = source['apps'][0]
        app.update(version=self.receipt['version'], buildVersion=self.receipt['buildNumber'],
                   sha256=self.receipt['sha256'], size=self.receipt['size'])
        self.module.check_candidate(source, self.receipt)
        app['sha256'] = 'b' * 64
        with self.assertRaisesRegex(ValueError, '冲突'):
            self.module.check_candidate(source, self.receipt)
        app.update(version='0.2.151', buildVersion='2151')
        with self.assertRaisesRegex(ValueError, '降级'):
            self.module.check_candidate(source, self.receipt)
        app.update(version='0.2.149', buildVersion='9999')
        with self.assertRaisesRegex(ValueError, '降级'):
            self.module.check_candidate(source, self.receipt)

    def test_generated_manifest_must_match_receipt_before_upload(self):
        self.assertTrue(hasattr(self.module, 'published_app'), '上传前须检查生成清单与凭证一致')
        with self.assertRaises(ValueError):
            self.module.published_app(self.source(), self.receipt)

    def test_all_historical_assets_are_collected_and_untrusted_paths_rejected(self):
        source = self.source()
        self.assertEqual(set(self.module.assets(source, self.config)), {'files/old.ipa', 'files/icon.png'})
        for url in ('https://other.example/files/app.ipa', 'https://source.example/files/../x.ipa',
                    'https://source.example/files/%2e%2e.ipa', 'https://source.example/files/x.ipa?secret=1'):
            with self.subTest(url=url):
                source['apps'][0]['versions'][0]['downloadURL'] = url
                with self.assertRaises(ValueError):
                    self.module.assets(source, self.config)

    def test_no_other_app_or_history_may_disappear(self):
        before = self.source()
        before['apps'].append(dict(before['apps'][0], bundleIdentifier='other.app'))
        after = json.loads(json.dumps(before))
        self.module.check_preserved(before, after, self.receipt)
        after['apps'].pop()
        with self.assertRaisesRegex(ValueError, '其他应用'):
            self.module.check_preserved(before, after, self.receipt)
        after = json.loads(json.dumps(before))
        after['apps'][0]['versions'] = []
        with self.assertRaisesRegex(ValueError, '历史'):
            self.module.check_preserved(before, after, self.receipt)

    def settings(self):
        repo = self.root / 'SignOs'
        (repo / 'scripts').mkdir(parents=True)
        (repo / 'scripts/app_source.py').write_text('# test transport boundary')
        config = self.config | dict(root=str(self.root / 'shared'), bucket='test-bucket', accountId='a' * 32)
        path = self.root / 'source.config.json'
        path.write_text(json.dumps(config))
        return repo, path

    def test_settings_validate_target_without_reading_credentials(self):
        self.assertTrue(hasattr(self.module, 'load_settings'), '缺少发布目标配置校验')
        repo, path = self.settings()
        settings = self.module.load_settings(repo, path)
        self.assertEqual(settings['config']['bucket'], 'test-bucket')
        config = json.loads(path.read_text())
        for key, value in dict(baseUrl='http://source.example', accountId='bad', bucket='../wrong').items():
            path.write_text(json.dumps(config | {key: value}))
            with self.subTest(key=key), self.assertRaises(ValueError):
                self.module.load_settings(repo, path)

    def test_missing_credentials_fail_before_writing(self):
        self.assertTrue(hasattr(self.module, 'preflight'), '缺少软件源发布预检')
        repo, path = self.settings()
        settings = self.module.load_settings(repo, path)
        with patch.dict('os.environ', {}, clear=True), patch.object(self.module.shutil, 'which', return_value='/rclone'):
            with self.assertRaisesRegex(ValueError, 'AWS_ACCESS_KEY_ID'):
                self.module.preflight(settings)
        self.assertFalse((self.root / 'shared').exists())

    def test_restore_checks_historical_ipa_before_publish(self):
        self.assertTrue(hasattr(self.module, 'restore_assets'), '缺少历史资源恢复')
        source = self.source()
        destination = self.root / 'staging'
        destination.mkdir()
        def download(url, path):
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'evil')
        with patch.object(self.module, 'download', side_effect=download):
            with self.assertRaisesRegex(ValueError, '摘要'):
                self.module.restore_assets(source, self.config, destination)

    def test_public_and_bucket_manifests_must_agree(self):
        self.assertTrue(hasattr(self.module, 'baseline'), '缺少公网与存储桶清单对账')
        with patch.object(self.module, 'read_public', return_value=b'{"apps":[]}'), \
             patch.object(self.module, 'read_bucket', return_value=b'{"apps":[1]}'):
            with self.assertRaisesRegex(ValueError, '不一致'):
                self.module.baseline(self.config)

    def test_publish_preserves_evidence_and_checks_baseline_before_sync(self):
        self.assertTrue(hasattr(self.module, 'publish'), '缺少软件源发布流程')
        repo, path = self.settings()
        settings = self.module.load_settings(repo, path)
        before = self.source()
        raw = json.dumps(before).encode()
        events = []
        def cli(script, config_path, *args):
            events.append(args[0])
            stage = Path(json.loads(config_path.read_text())['root'])
            if args[0] == 'publish':
                after = json.loads(raw)
                app = after['apps'][0]
                app.update(version=self.receipt['version'], buildVersion=self.receipt['buildNumber'],
                           sha256=self.receipt['sha256'], size=self.receipt['size'],
                           downloadURL='https://source.example/files/new.ipa',
                           developerName=args[args.index('--developer') + 1])
                (stage / 'source.json').write_text(json.dumps(after))
        attempt = self.root / 'attempts'
        with patch.object(self.module, 'preflight'), \
             patch.object(self.module, 'current_github_user', return_value='current-publisher'), \
             patch.object(self.module, 'baseline', side_effect=[raw, b'changed']), \
             patch.object(self.module, 'restore_assets'), \
             patch.object(self.module, 'run_cli', side_effect=cli):
            with self.assertRaisesRegex(ValueError, '清单已变化'):
                self.module.publish(self.ipa, self.receipt_path, settings, attempt)
        self.assertEqual(events, ['publish'])
        self.assertEqual(len(list(attempt.glob('*/before-source.json'))), 1)
        self.assertEqual(len(list(attempt.glob('*/source.json'))), 1)

    def test_success_verifies_online_manifest_and_returns_matching_release(self):
        self.assertTrue(hasattr(self.module, 'publish'), '缺少软件源发布流程')
        repo, path = self.settings()
        settings = self.module.load_settings(repo, path)
        before = self.source()
        before['apps'][0]['developerName'] = 'loock-ai / Yao'
        raw = json.dumps(before).encode()
        events, staged = [], {}
        def cli(script, config_path, *args):
            events.append(args[0])
            stage = Path(json.loads(config_path.read_text())['root'])
            if args[0] == 'publish':
                self.assertEqual(args[args.index('--developer') + 1], 'loock-ai / Yao / current-publisher')
                after = json.loads(raw)
                after['apps'][0].update(version=self.receipt['version'], buildVersion=self.receipt['buildNumber'],
                                       sha256=self.receipt['sha256'], size=self.receipt['size'],
                                       downloadURL='https://source.example/files/new.ipa',
                                       developerName=args[args.index('--developer') + 1])
                staged['bytes'] = json.dumps(after).encode()
                (stage / 'source.json').write_bytes(staged['bytes'])
        with patch.object(self.module, 'preflight'), \
             patch.object(self.module, 'current_github_user', create=True, return_value='current-publisher'), \
             patch.object(self.module, 'baseline', return_value=raw), \
             patch.object(self.module, 'restore_assets'), \
             patch.object(self.module, 'run_cli', side_effect=cli), \
             patch.object(self.module, 'read_public', side_effect=lambda *a: staged['bytes']):
            result = self.module.publish(self.ipa, self.receipt_path, settings, self.root / 'attempts')
        self.assertEqual(events, ['publish', 'sync'])
        self.assertEqual(result['sha256'], self.receipt['sha256'])
        self.assertEqual(len(list((self.root / 'attempts').glob('*/verification.json'))), 1)

    def test_plan_has_no_network_or_upload_side_effects(self):
        repo, path = self.settings()
        with patch.object(sys, 'argv', ['ios_app_source.py', '--ipa', str(self.ipa),
                '--release-json', str(self.receipt_path), '--signos-repo', str(repo),
                '--source-config', str(path), '--plan']), \
             patch.object(self.module, 'publish') as publish, \
             patch.object(self.module, 'baseline') as baseline, \
             patch('builtins.print'):
            self.module.main()
        publish.assert_not_called()
        baseline.assert_not_called()
        self.assertFalse((self.root / 'shared').exists())

    def test_publisher_cannot_overwrite_prior_developer_before_sync(self):
        repo, path = self.settings()
        settings = self.module.load_settings(repo, path)
        before = self.source()
        before['apps'][0]['developerName'] = 'original-author'
        events = []
        def cli(script, config_path, *args):
            events.append(args[0])
            stage = Path(json.loads(config_path.read_text())['root'])
            app = before['apps'][0] | dict(version=self.receipt['version'],
                buildVersion=self.receipt['buildNumber'], size=self.receipt['size'],
                sha256=self.receipt['sha256'], downloadURL='https://source.example/files/new.ipa',
                developerName='current-publisher')
            (stage/'source.json').write_text(json.dumps(before | {'apps': [app]}))
        with patch.object(self.module, 'preflight'), \
             patch.object(self.module, 'current_github_user', return_value='current-publisher'), \
             patch.object(self.module, 'baseline', return_value=json.dumps(before).encode()), \
             patch.object(self.module, 'restore_assets'), \
             patch.object(self.module, 'run_cli', side_effect=cli):
            with self.assertRaisesRegex(ValueError, '覆盖了开发者署名'):
                self.module.publish(self.ipa, self.receipt_path, settings, self.root/'attempts')
        self.assertEqual(events, ['publish'])


if __name__ == '__main__':
    unittest.main()
