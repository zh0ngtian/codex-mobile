from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import test_github_only_release_adapter as github_tests
import test_unsigned_release_adapter as unsigned_tests


PHASES = ['main', 'build', 'verify']


class AndroidReleaseTests(unittest.TestCase):
    def context(self, root):
        context = github_tests.GithubOnlyReleaseTests().context(root)
        context['project'] = 'codex-mobile-github-android'
        context['config'].update(target='codex-mobile-github-android', phases=PHASES.copy())
        context['config']['options'] = {'kind':'mobile-github-android', 'github_repository':'zh0ngtian/codex-mobile'}
        return context

    def adapter(self, root):
        return unsigned_tests.a_module().Adapter(self.context(root))

    def test_prepare_reserves_github_version_without_lan_ios_or_source_reads(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.adapter(Path(tmp))
            (a.work / 'mobile-version-floor.json').write_text('{"version":"0.3.50"}')
            with patch.object(a, 'git', return_value='source-tree'), patch.object(a, 'url_json', side_effect=AssertionError('不得读取LAN或软件源')), patch.object(a, 'ios_config', side_effect=AssertionError('不得读取签名配置')), patch.object(a, 'signing_preflight', side_effect=AssertionError('不得验签')), patch.object(a, 'gh_json', return_value=[{'tag_name':'v0.3.51'}]), patch.object(a, 'merged_checks'), patch.object(a, 'freeze_manifest'):
                result = a.prepare()['result']
            self.assertTrue(a.mobile)
            self.assertEqual((result['version'], result['buildNumber']), ('0.3.52', '3052'))

    def test_android_project_requires_exact_identity_and_phase_order(self):
        for field, value in [('project','codex-mobile-github-only'), ('target','codex-mobile-github-only'), ('environment','production'), ('branch','other'), ('scope','other'), ('kind','mobile-github-only'), ('phases',PHASES + ['source']), ('phases',PHASES[:-1]), ('phases',list(reversed(PHASES)))]:
            with self.subTest(field=field), tempfile.TemporaryDirectory() as tmp:
                context = self.context(Path(tmp))
                if field == 'kind': context['config']['options'][field] = value
                else: (context if field in ('project','scope') else context['config'])[field] = value
                with self.assertRaisesRegex(ValueError, 'Android|android|github-only'):
                    unsigned_tests.a_module().Adapter(context)

    def test_all_phase_entries_reject_unauthorized_steps_before_io(self):
        for phase in ['source','iosbuild','sign','ota','ipa','apk','gateway','unknown']:
            for entry in ['check_phase','execute_phase','run_phase']:
                with self.subTest(phase=phase, entry=entry), tempfile.TemporaryDirectory() as tmp:
                    a = self.adapter(Path(tmp))
                    with patch.object(a, 'command', side_effect=AssertionError('不得执行命令')), patch.object(a, 'url_json', side_effect=AssertionError('不得读取渠道')), patch.object(a, 'gh_json', side_effect=AssertionError('不得访问GitHub')), self.assertRaisesRegex(ValueError, 'Android|android|github-only'):
                        getattr(a, entry)(phase)

    def seed(self, a, folder, platform='android', **changes):
        folder.mkdir(parents=True, exist_ok=True)
        filename = f'CodexMobile-v{a.version}' + ('.apk' if platform == 'android' else '-unsigned.ipa')
        path = folder / filename
        path.write_bytes(platform.encode())
        receipt = {'sourceCommit':a.frozen_sha, 'batchId':a.context['id'], 'version':a.version, 'buildNumber':a.build_number, 'platform':platform, 'filename':filename, 'sha256':hashlib.sha256(path.read_bytes()).hexdigest(), 'size':path.stat().st_size, 'runId':'123', 'runAttempt':'1', 'tasks':[{'id':t['id'],'sha':t['sha']} for t in a.context['tasks']], **changes}
        (folder / (platform + '-build.json')).write_text(json.dumps(receipt))
        return {**receipt, 'path':str(path)}

    def test_build_downloads_only_android_and_binds_release_to_frozen_run(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.adapter(Path(tmp))
            downloads = []
            def download(args, **kwargs):
                platform = args[args.index('--name') + 1].removeprefix('codex-mobile-')
                downloads.append(platform)
                self.seed(a, Path(args[args.index('--dir') + 1]), platform)
                return ''
            run = {'id':123,'status':'completed','conclusion':'success','run_attempt':1}
            with patch.object(a, 'ci_run', return_value=run), patch.object(a, 'command', side_effect=download):
                a.run_build()
            self.assertEqual(downloads, ['android'])
            artifacts = a.build_artifacts()
            self.assertEqual(set(artifacts), {'android'})
            item = artifacts['android']
            release = {'id':1,'html_url':'https://github.test/release','assets':[{'name':Path(item['path']).name,'size':item['size'],'digest':'sha256:' + item['sha256'],'browser_download_url':'https://github.test/android'}]}
            with patch.object(a, 'ci_run', return_value=run), patch.object(a, 'gh_json', side_effect=[release, {'sha':a.frozen_sha}]):
                self.assertEqual(set(a.build_check()['result']['artifacts']), {'android'})

    def test_android_receipt_rejects_wrong_frozen_sha_run_attempt_or_extra_ios(self):
        for changes in [{'sourceCommit':'c'*40}, {'runId':'124'}, {'runAttempt':'2'}]:
            with self.subTest(changes=changes), tempfile.TemporaryDirectory() as tmp:
                a = self.adapter(Path(tmp)); a.progress('build', runId=123, attempt=1)
                self.seed(a, a.root / 'ci-artifacts', **changes)
                with self.assertRaisesRegex(ValueError, 'sourceCommit|run/attempt'):
                    a.build_artifacts()
        with tempfile.TemporaryDirectory() as tmp:
            a = self.adapter(Path(tmp)); a.progress('build', runId=123, attempt=1)
            self.seed(a, a.root / 'ci-artifacts')
            self.seed(a, a.root / 'ci-artifacts', 'ios')
            with self.assertRaisesRegex(ValueError, '平台|Android|android'):
                a.build_artifacts()

    def test_android_release_rejects_remote_assets_outside_frozen_platform_and_version(self):
        for extra in ['CodexMobile-v0.2.164-unsigned.ipa', 'CodexMobile-v0.2.164-unsigned.ipa.sha256',
                      'ios-build.json', 'CodexMobile-v0.2.163.apk', 'CodexMobile-v0.2.163.apk.sha256']:
            with self.subTest(extra=extra), tempfile.TemporaryDirectory() as tmp:
                a = self.adapter(Path(tmp)); a.progress('build', runId=123, attempt=1)
                item = self.seed(a, a.root / 'ci-artifacts')
                release = {'id':1, 'html_url':'https://github.test/release', 'assets':[
                    {'name':Path(item['path']).name, 'size':item['size'], 'digest':'sha256:' + item['sha256'], 'browser_download_url':'https://github.test/android'},
                    {'name':extra, 'size':3, 'browser_download_url':'https://github.test/unapproved'}]}
                run = {'id':123, 'status':'completed', 'conclusion':'success', 'run_attempt':1}
                with patch.object(a, 'ci_run', return_value=run), patch.object(a, 'gh_json', side_effect=[release, {'sha':a.frozen_sha}]), self.assertRaisesRegex(ValueError, '未授权.*附件'):
                    a.build_check()

    def test_remote_allowed_build_assets_preserve_android_and_old_dual_contracts(self):
        for factory, platforms in [(self.adapter, ['android']), (github_tests.GithubOnlyReleaseTests().adapter, ['android','ios'])]:
            with self.subTest(platforms=platforms), tempfile.TemporaryDirectory() as tmp:
                a = factory(Path(tmp)); a.progress('build', runId=123, attempt=1)
                assets = [{'name':'release-notes.txt', 'size':3, 'browser_download_url':'https://github.test/notes'}]
                for platform in platforms:
                    item = self.seed(a, a.root / 'ci-artifacts', platform)
                    filename = Path(item['path']).name
                    assets.extend([{'name':filename, 'size':item['size'], 'digest':'sha256:' + item['sha256'], 'browser_download_url':'https://github.test/' + platform},
                                   {'name':filename + '.sha256', 'size':3, 'browser_download_url':'https://github.test/checksum'},
                                   {'name':platform + '-build.json', 'size':3, 'browser_download_url':'https://github.test/receipt'}])
                release = {'id':1, 'html_url':'https://github.test/release', 'assets':assets}
                run = {'id':123, 'status':'completed', 'conclusion':'success', 'run_attempt':1}
                with patch.object(a, 'ci_run', return_value=run), patch.object(a, 'gh_json', side_effect=[release, {'sha':a.frozen_sha}]):
                    result = a.build_check()
                self.assertTrue(result['done'])
                self.assertEqual(set(result['result']['artifacts']), set(platforms))

    def verification(self, a, *, missing=None, corrupt=False):
        data = b'github-android-apk'
        artifact = {'path':str(a.root / 'app.apk'), 'downloadUrl':'https://github.test/android', 'size':len(data), 'sha256':hashlib.sha256(data).hexdigest()}
        stack = ExitStack()
        for phase, method, result in [('development','development_check', {'runId':10}), ('main','main_check', {'sourceCommit':a.frozen_sha}), ('build','build_check', {'artifacts':{'android':artifact}})]:
            stack.enter_context(patch.object(a, method, return_value={'done':phase != missing, 'result':result}))
        for method in ['source_check','source_manage','url_json','ios_config','lan_check']:
            stack.enter_context(patch.object(a, method, side_effect=AssertionError('不得访问软件源、签名或LAN')))
        heads = stack.enter_context(patch.object(a, 'request', return_value='content-length: ' + str(len(data)) + '\r\n'))
        def download(args, **kwargs):
            Path(args[args.index('--output') + 1]).write_bytes(b'x' * len(data) if corrupt else data)
            return ''
        gets = stack.enter_context(patch.object(a, 'command', side_effect=download))
        return stack, heads, gets

    def test_verify_head_get_apk_without_source_and_records_android_scope(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.adapter(Path(tmp))
            stack, heads, gets = self.verification(a)
            with stack:
                result = a.check_phase('verify')
            heads.assert_called_once()
            self.assertEqual(heads.call_args.args[1], 'HEAD')
            gets.assert_called_once()
            receipt = json.loads((a.root / 'github-release.json').read_text())
            for evidence in [result['result'], receipt]:
                self.assertEqual(evidence['platforms'], ['android'])
                for flag in ['softwareSourceUpdated','lanApkPublished','signedIpaPublished','otaPublished','fixedIpaPublished']:
                    self.assertFalse(evidence[flag])
                self.assertEqual(set(evidence['channels']), {'development','main','build'})

    def test_verify_only_waits_for_authorized_prerequisites(self):
        for phase in ['development','main','build']:
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as tmp:
                a = self.adapter(Path(tmp)); stack, _, _ = self.verification(a, missing=phase)
                with stack:
                    self.assertEqual(a.check_phase('verify'), {'done':False,'result':{'missing':phase}})
                self.assertFalse((a.root / 'github-release.json').exists())

    def test_verify_rejects_corrupt_apk_without_success_receipt(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.adapter(Path(tmp)); stack, _, _ = self.verification(a, corrupt=True)
            with stack, self.assertRaisesRegex(ValueError, 'GET.*SHA-256'):
                a.check_phase('verify')
            self.assertFalse((a.root / 'github-release.json').exists())

    def test_old_github_only_contract_still_requires_both_platforms(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = github_tests.GithubOnlyReleaseTests().adapter(Path(tmp)); a.progress('build', runId=123, attempt=1)
            self.seed(a, a.root / 'ci-artifacts')
            self.assertIsNone(a.build_artifacts())

    def test_android_template_has_no_software_source_or_ios_options(self):
        root = Path(__file__).resolve().parents[2]
        template = json.loads((root / 'release/coordinator.android.example.json').read_text())
        self.assertEqual(template['id'], 'codex-mobile-github-android')
        self.assertEqual(template['target'], template['id'])
        self.assertEqual(template['environment'], 'github-only')
        self.assertEqual(template['lock_scope'], 'codex-mobile-main-production')
        self.assertEqual(template['phases'], PHASES)
        self.assertEqual(template['options'], {'kind':'mobile-github-android','github_repository':'zh0ngtian/codex-mobile'})


if __name__ == '__main__':
    unittest.main()
