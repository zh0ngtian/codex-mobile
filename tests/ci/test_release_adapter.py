import concurrent.futures
import importlib.util
import json
import os
import plistlib
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile
import unittest
from types import SimpleNamespace
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / 'scripts'))


class ReleaseAdapterTests(unittest.TestCase):
    def load(self):
        path = ROOT / 'scripts/codex_mobile_release_adapter.py'
        self.assertTrue(path.is_file(), '缺少项目真实发布适配器')
        spec = importlib.util.spec_from_file_location('codex_release_adapter', path)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        return module

    def context(self, root):
        return {'id': 'batch-test', 'project': 'codex-mobile-lan-production',
                'workspace': str(root / 'work'), 'progressPath': str(root / 'progress/batch-test.json'),
                'scope': 'codex-mobile-main-production', 'tasks': [{'id': 'task-a', 'sha': 'a' * 40, 'validation': {'checks':[{'name':'unit','status':'passed'}]}}],
                'config': {'target': 'vip.loock.codexmobile', 'environment': 'lan-production',
                           'repository': str(root / 'work'), 'branch': 'main',
                           'options': {'kind': 'mobile', 'github_repository': 'zh0ngtian/codex-mobile'}},
                'results': {'prepare': {'version': '0.2.164', 'buildNumber': '2164'}},
                'frozen': {'sha': 'b' * 40, 'version': '0.2.164', 'buildNumber': '2164'}}

    def notes_fixture(self, root, manifest=None, notes='- 新增原生界面。\n- 修复输入丢字。'):
        work = root / 'work'
        work.mkdir()
        (work / 'scripts').mkdir()
        # 使用合批工作区中的真实共享读取器，不能从适配器安装路径读取日志。
        reader = ROOT / 'scripts/read-release-notes.mjs'
        (work / 'scripts/read-release-notes.mjs').write_bytes(reader.read_bytes())
        (work / '.release-batch.json').write_text(json.dumps(manifest or {}))
        if notes is not None:
            (work / 'release').mkdir()
            (work / 'release/notes.md').write_text(notes)
        for args in [('init', '-q'), ('config', 'user.email', 'test@example.com'),
                     ('config', 'user.name', 'Test'), ('add', '.'), ('commit', '-qm', 'freeze')]:
            subprocess.run(['git', *args], cwd=work, check=True, capture_output=True)
        return self.load().Adapter(self.context(root))

    def test_notes_reads_tracked_file_from_merged_worktree(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.notes_fixture(Path(tmp))
            self.assertEqual(a.notes(), '- 新增原生界面。\n- 修复输入丢字。')

    def test_notes_prefers_explicit_manifest_content(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.notes_fixture(Path(tmp), {'releaseNotes': '  - 修复会话搜索。\n'})
            self.assertEqual(a.notes(), '- 修复会话搜索。')

    def test_notes_missing_empty_or_invalid_fails_without_template(self):
        for manifest, notes in [({}, None), ({}, ''), ({}, ' \n '),
                                ({'releaseNotes': ''}, '- 不能自动替代。'),
                                ({'releaseNotes': None}, '- 不能自动替代。')]:
            with self.subTest(manifest=manifest, notes=notes), tempfile.TemporaryDirectory() as tmp:
                a = self.notes_fixture(Path(tmp), manifest, notes)
                with self.assertRaisesRegex(RuntimeError, 'exited'):
                    a.notes()

    def test_notes_rejects_untracked_or_modified_file(self):
        for tracked in (False, True):
            with self.subTest(tracked=tracked), tempfile.TemporaryDirectory() as tmp:
                a = self.notes_fixture(Path(tmp), notes='- 冻结日志。' if tracked else None)
                (a.work / 'release').mkdir(exist_ok=True)
                (a.work / 'release/notes.md').write_text('- 未提交的日志。')
                with self.assertRaisesRegex(RuntimeError, 'exited'):
                    a.notes()

    def test_reservation_is_atomic_and_reused_across_concurrent_retries(self):
        m = self.load()
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            def reserve(i):
                return m.reserve_version(root / 'version.json', ['0.2.163' if i == 0 else '0.2.162'], 'fingerprint')
            with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
                results = list(pool.map(reserve, range(8)))
            self.assertEqual(len({r['version'] for r in results}), 1)
            self.assertEqual(results[0]['buildNumber'], str(m.version_code(results[0]['version'])))
            self.assertEqual(m.reserve_version(root / 'version.json', ['0.2.999'], 'fingerprint'), results[0])
            with self.assertRaisesRegex(ValueError, '来源|fingerprint'):
                m.reserve_version(root / 'version.json', ['0.2.999'], 'other')

    def test_version_rollover_and_bounds_preserve_project_rules(self):
        m = self.load()
        with tempfile.TemporaryDirectory() as tmp:
            r=m.reserve_version(Path(tmp)/'v.json', ['0.2.999'], 'f')
            self.assertEqual((r['version'], r['buildNumber']), ('0.3.0', '3000'))
        for v in ['0.2.1000', '2101.0.0', '0.0.0']:
            with self.assertRaises(ValueError): m.version_code(v)

    def test_real_repository_floor_reserves_030_then_increments_future_versions(self):
        m = self.load()
        floor = json.loads((ROOT / 'mobile-version-floor.json').read_text())['version']
        with tempfile.TemporaryDirectory() as tmp:
            path = Path(tmp) / 'version.json'
            first = m.reserve_version(path, [floor, '0.2.191'], 'fingerprint-030')
            self.assertEqual((first['version'], first['buildNumber']), ('0.3.0', '3000'))
            self.assertEqual(m.reserve_version(path, [floor, '0.2.191'], 'fingerprint-030'), first)
            future = m.reserve_version(Path(tmp) / 'future.json', [floor, '0.3.4'], 'fingerprint-future')
            self.assertEqual((future['version'], future['buildNumber']), ('0.3.5', '3005'))

    def test_remote_success_after_lost_response_does_not_publish_again(self):
        m = self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)))
            with patch.object(a, 'check_phase', return_value={'done': True, 'result': {'releaseId': 'verified'}}), patch.object(a, 'execute_phase') as execute:
                self.assertTrue(a.run_phase('apk')['done'])
                execute.assert_not_called()

    def test_missing_channel_is_the_only_executed_step(self):
        m = self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)))
            with patch.object(a, 'check_phase', side_effect=[{'done': False, 'result': {}}, {'done': True, 'result': {'sha256':'c'*64}}]), patch.object(a, 'execute_phase') as execute:
                self.assertTrue(a.run_phase('ipa')['done'])
                execute.assert_called_once_with('ipa')

    def test_error_after_external_effect_is_reconciled(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)))
            with patch.object(a, 'check_phase', side_effect=[{'done': False}, {'done': True, 'result': {'id':'remote'}}]), patch.object(a, 'execute_phase', side_effect=OSError('response lost')):
                self.assertTrue(a.run_phase('ota')['done'])

    def test_failed_channel_remains_failed(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)))
            with patch.object(a, 'check_phase', return_value={'done': False}), patch.object(a, 'execute_phase', side_effect=OSError('channel failed')):
                with self.assertRaisesRegex(OSError, 'channel failed'): a.run_phase('ipa')

    def test_ci_selection_never_uses_another_commit(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)))
            with patch.object(a, 'gh_json', return_value={'workflow_runs':[{'id':1, 'head_sha':'a'*40, 'status':'completed','conclusion':'success'}]}):
                self.assertIsNone(a.ci_run())
            with patch.object(a, 'gh_json', return_value={'workflow_runs':[{'id':2, 'head_sha':'b'*40, 'status':'completed','conclusion':'success','run_attempt':1}]}):
                self.assertEqual(a.ci_run()['id'],2)

    def test_freeze_gate_rejects_changed_worktree_or_manifest(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)))
            with patch.object(a, 'git', return_value='a'*40):
                with self.assertRaisesRegex(ValueError, '冻结|frozen'): a.assert_frozen()

    def test_artifact_receipt_wrong_commit_is_rejected(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)))
            with self.assertRaisesRegex(ValueError,'来源|source|commit'):
                a.validate_build_receipt({'sourceCommit':'a'*40,'batchId':'batch-test','version':'0.2.164','buildNumber':'2164'}, 'android')

    def test_progress_keeps_operation_ids_across_restart(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            c=self.context(Path(tmp));a=m.Adapter(c)
            a.progress('build', runId=123, attempt=1)
            b=m.Adapter(c)
            self.assertEqual(b.read_progress()['runId'],123)
            b.progress('apk', releaseId='batch-test:apk')
            self.assertEqual(b.read_progress()['operations']['build']['runId'],123)

    def test_prepare_retry_keeps_reservation_and_successful_merged_validation(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            c=self.context(Path(tmp)); a=m.Adapter(c);a.work.mkdir()
            (a.work/'mobile-version-floor.json').write_text('{"version":"0.2.122"}')
            with patch.object(a,'git',return_value='source-tree'), patch.object(a,'ios_config',return_value={'baseUrl':'https://test/ota','caFile':'test-ca'}), patch.object(a,'url_json',return_value={'version':'0.2.163'}), patch.object(a,'gh_json',return_value=[{'tag_name':'v0.2.163'}]), patch.object(a,'signing_preflight'), patch.object(a,'merged_checks') as checks:
                first=a.prepare()
                second=a.prepare()
                self.assertEqual(first,second)
                self.assertEqual(first['result']['version'],'0.2.164')
                checks.assert_called_once()

    def test_artifact_receipt_must_match_recorded_run_and_task_set(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)));a.progress('build',runId=123,attempt=1)
            receipt={'sourceCommit':'b'*40,'batchId':'batch-test','version':'0.2.164','buildNumber':'2164',
                     'platform':'android','sha256':'c'*64,'size':7,'runId':'999','runAttempt':'1',
                     'tasks':[{'id':'task-a','sha':'a'*40}]}
            with self.assertRaisesRegex(ValueError,'run|运行'):a.validate_build_receipt(receipt,'android')
            receipt['runId']='123';receipt['tasks'][0]['sha']='c'*40
            with self.assertRaisesRegex(ValueError,'任务'):a.validate_build_receipt(receipt,'android')

    def test_signing_preflight_rejects_other_bundle_identity(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)))
            with self.assertRaisesRegex(ValueError,'身份|Bundle'):
                a.signing_preflight({'bundleId':'other.app'}, {'version':'0.2.164','buildNumber':'2164'}, {})

    def test_complete_device_candidate_is_adopted_without_rebuilding(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)));candidate=a.root/'device-candidate.ipa';candidate.write_bytes(b'complete-package')
            m.atomic_json(a.root/'iosbuild-intent.json',{'sourceCommit':'b'*40,'batchId':'batch-test','candidate':str(candidate)})
            with patch.object(a,'package_info',return_value={}):
                self.assertTrue(a.iosbuild_check()['done'])
            self.assertTrue(a.local_ipa().exists());self.assertFalse(candidate.exists())

    def test_source_append_preserves_complete_presentation(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)));credentials=a.root/'credentials.json'
            m.atomic_json(credentials,{'url':'https://source.test','token':'test-secret'})
            a.options['source_credentials']=str(credentials)
            presentation={'developerName':'alice-old','description':'Keep description','iconURL':'https://source.test/icon.png','legacyDefault':True}
            catalog={'revision':7,'entries':[{'id':'entry-a','config':{'repository':a.repo},'presentation':presentation}], 'jobs':[]}
            with patch.object(a,'url_json',return_value=catalog) as request, patch.object(a,'gh_json',return_value={'login':'alice'}):
                a.source_manage()
            body=next(c.kwargs['data'] for c in request.call_args_list if c.args[0].endswith('/presentation'))
            self.assertEqual(body,{'revision':7,**presentation,'developerName':'alice-old, alice'})

    def test_source_pre_request_intent_does_not_claim_job_exists(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)));credentials=a.root/'credentials.json'
            m.atomic_json(credentials,{'url':'https://source.test','token':'test-secret'})
            a.options['source_credentials']=str(credentials);a.progress('source',syncRequested=True,syncIntentAt=1)
            catalog={'revision':7,'entries':[{'id':'entry-a','config':{'repository':a.repo},'presentation':{'developerName':'alice'}}], 'jobs':[]}
            with patch.object(a,'url_json',return_value=catalog) as request, patch.object(a,'gh_json',return_value={'login':'alice'}):
                a.source_manage()
            self.assertTrue(any(c.args[0].endswith('/sync') for c in request.call_args_list))

    def test_ota_staging_candidate_is_atomically_adopted(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp))); candidate=a.root/'ota-candidate';candidate.mkdir()
            (candidate/'latest-ios.json').write_text('{"version":"0.2.164"}')
            m.atomic_json(a.root/'ota-intent.json',{'candidate':str(candidate),'sourceCommit':'b'*40})
            with patch.object(a,'validate_ota_staging',return_value={'version':'0.2.164'}):
                staging=a.ota_staging({'sourceCommit':'b'*40})
            self.assertEqual(staging,a.root/'ota');self.assertFalse(candidate.exists())

    def test_successfully_signed_temp_candidate_is_adopted_without_signing(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)));temporary=a.root/'.codex-ios-sign-recovery';temporary.mkdir()
            candidate=temporary/'signed.ipa'
            with zipfile.ZipFile(candidate,'w') as archive:archive.writestr('Payload/PakePlus.app/Info.plist',b'verified-signature')
            expected={'bundleId':'vip.loock.codexmobile','teamId':'TEAM','applicationIdentifier':'TEAM.APP','entitlements':{'key':'value'}}
            with patch.object(a,'validate_signed_candidate',return_value={'signed':True}):
                self.assertTrue(a.recover_signed_candidate(expected))
            self.assertTrue(a.local_ipa(True).exists());self.assertFalse(temporary.exists())

    def test_partial_ci_download_retains_complete_platform_and_fetches_only_missing(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)));a.progress('build',runId=123,attempt=1)
            partials=a.root/'ci-partials';partials.mkdir()
            downloads=[]
            def seed(folder,platform):
                folder.mkdir(parents=True,exist_ok=True)
                name=f'CodexMobile-v0.2.164'+('.apk' if platform=='android' else '-unsigned.ipa')
                f=folder/name;f.write_bytes(platform.encode())
                m.atomic_json(folder/f'{platform}-build.json',{'sourceCommit':'b'*40,'batchId':'batch-test','version':'0.2.164','buildNumber':'2164','platform':platform,'sha256':m.sha256(f),'size':f.stat().st_size,'runId':'123','runAttempt':'1','tasks':[{'id':'task-a','sha':'a'*40}]})
            seed(partials/'android','android')
            def command(args,**kwargs):
                if args[:3]==['gh','run','download']:
                    platform=args[args.index('--name')+1].removeprefix('codex-mobile-');downloads.append(platform)
                    seed(Path(args[args.index('--dir')+1]),platform)
                return ''
            with patch.object(a,'ci_run',return_value={'id':123,'status':'completed','conclusion':'success','run_attempt':1}), patch.object(a,'command',side_effect=command):
                a.run_build()
            self.assertEqual(downloads,['ios']);self.assertIsNotNone(a.build_artifacts())

    def test_device_compile_success_is_reused_before_archive_response(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)));a.work=ROOT;legacy=a.ios_module()
            retained=a.root/'device-build';app=retained/'DerivedData/Build/Products/Release-iphoneos/PakePlus.app';app.mkdir(parents=True)
            (app/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier':'vip.loock.codexmobile','CFBundleShortVersionString':'0.2.164','CFBundleVersion':'2164','CFBundleExecutable':'PakePlus'}))
            (app/'PakePlus').write_bytes(b'compiled executable');(retained/'compile.log').write_text('** BUILD SUCCEEDED **')
            calls=[]
            def run(args,**kwargs):calls.append(args)
            with patch.object(legacy.subprocess,'run',side_effect=run):
                legacy.build_unsigned('0.2.164',{'bundleId':'vip.loock.codexmobile','baseUrl':'https://ota.test'},a.root/'candidate.ipa',retained_root=retained)
            self.assertFalse(any(call[0]=='xcodebuild' for call in calls))
            self.assertTrue(any(call[0]=='ditto' for call in calls))

    def test_iosbuild_cli_keeps_subprocess_progress_out_of_protocol_stdout(self):
        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp); work = root/'work'; scripts = work/'scripts'; scripts.mkdir(parents=True)
            for name in ('release-ios.py', 'ios_sign.py', 'ios_ota.py'):
                (scripts/name).write_bytes((ROOT/'scripts'/name).read_bytes())
            (work/'.gitignore').write_text('.mobile-build/\n__pycache__/\n')
            config = {'bundleId': 'vip.loock.codexmobile', 'udid': 'REGISTERED', 'profile': 'profile',
                      'p12': 'p12', 'passwordFile': 'password', 'baseUrl': 'https://ota.test',
                      'localRoot': str(root/'channel'), 'caFile': 'ca.pem'}
            for name in ('profile', 'p12', 'password', 'ca.pem'):
                (root/name).write_text('fixture'); (root/name).chmod(0o600)
            config_path = root/'ios-config.json'; config_path.write_text(json.dumps(config)); config_path.chmod(0o600)
            def git(*args):
                return subprocess.run(['git', *args], cwd=work, check=True, capture_output=True, text=True).stdout.strip()
            git('init', '-q'); git('config', 'user.email', 'test@example.com'); git('config', 'user.name', 'Test')
            git('add', '.'); git('commit', '-qm', 'source fixture')
            source_sha = git('rev-parse', 'HEAD')
            context = self.context(root)
            context['tasks'][0]['sha'] = source_sha
            context['config']['options']['ios_config'] = str(config_path)
            manifest = {'batchId': context['id'], 'project': context['project'], 'scope': context['scope'],
                        'target': context['config']['target'], 'environment': context['config']['environment'],
                        'tasks': [{'id': 'task-a', 'sha': source_sha}],
                        'prepared': {'version': '0.2.164', 'buildNumber': '2164'}}
            manifest_path = work/'.release-batch.json'; manifest_path.write_text(json.dumps(manifest))
            git('add', '.release-batch.json'); git('commit', '-qm', 'freeze fixture')
            context['frozen'].update(sha=git('rev-parse', 'HEAD'), tasks=manifest['tasks'],
                                     manifestSha256=self.load().sha256(manifest_path))
            context_path = root/'context.json'; context_path.write_text(json.dumps(context))
            commands = root/'bin'; commands.mkdir()
            def external(name, source):
                path = commands/name
                path.write_text('#!' + sys.executable + '\n' + source)
                path.chmod(0o700)
            external('node', '''import os, sys
from pathlib import Path
assert Path(sys.argv[1]).name == 'prepare-ios.mjs'
build = Path('.mobile-build/ios/pakeplus'); build.mkdir(parents=True)
(build/'version').write_text(sys.argv[sys.argv.index('--version') + 1])
os.write(1, b'PREPARE_STDOUT_PROGRESS\\n')
os.write(2, b'PREPARE_STDERR_PROGRESS\\n')
''')
            external('xcodebuild', '''import os, plistlib, sys
from pathlib import Path
version = Path('.mobile-build/ios/pakeplus/version').read_text()
app = Path(sys.argv[sys.argv.index('-derivedDataPath') + 1])/'Build/Products/Release-iphoneos/PakePlus.app'
app.mkdir(parents=True)
(app/'Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': os.environ['APP_ID'],
    'CFBundleShortVersionString': version, 'CFBundleVersion': str(sum(int(p)*f for p,f in zip(version.split('.'), (1000000,1000,1)))),
    'CFBundleExecutable': 'PakePlus'}))
(app/'PakePlus').write_bytes(b'compiled executable')
os.write(1, b'XCODE_STDOUT_PROGRESS\\n** BUILD SUCCEEDED **\\n')
os.write(2, b'XCODE_STDERR_DIAGNOSTIC\\n')
''')
            external('ditto', '''import os, sys, zipfile
from pathlib import Path
payload = Path(sys.argv[-2])
with zipfile.ZipFile(sys.argv[-1], 'w') as archive:
    for path in payload.rglob('*'):
        if path.is_file(): archive.write(path, path.relative_to(payload.parent))
os.write(1, b'DITTO_STDOUT_PROGRESS\\n')
os.write(2, b'DITTO_STDERR_PROGRESS\\n')
''')
            result = subprocess.run([sys.executable, '-B', str(ROOT/'scripts/codex_mobile_release_adapter.py'),
                                     'run', 'iosbuild', '--context', str(context_path)], cwd=ROOT,
                                    env={**os.environ, 'PATH': str(commands) + os.pathsep + os.environ.get('PATH', '')},
                                    capture_output=True, text=True, timeout=30)
            self.assertEqual(result.returncode, 0, result.stderr)
            # 和协调引擎一样解析完整stdout，不能跳过进度行或只读取末行。
            try:
                receipt = json.loads(result.stdout)
            except json.JSONDecodeError:
                self.fail('适配器stdout必须是唯一JSON，实际包含子进程输出：' + repr(result.stdout[:160]))
            self.assertEqual(len(result.stdout.splitlines()), 1)
            self.assertTrue(receipt['done'])
            self.assertEqual(receipt['result']['sourceCommit'], context['frozen']['sha'])
            self.assertEqual(receipt['result']['version'], '0.2.164')
            for progress in ('PREPARE_STDOUT_PROGRESS', 'PREPARE_STDERR_PROGRESS', 'DITTO_STDOUT_PROGRESS', 'DITTO_STDERR_PROGRESS'):
                self.assertIn(progress, result.stderr)
            log = root/'artifacts/codex-mobile/batch-test/device-build/compile.log'
            self.assertIn('XCODE_STDOUT_PROGRESS', log.read_text())
            self.assertIn('XCODE_STDERR_DIAGNOSTIC', log.read_text())
            self.assertIn('** BUILD SUCCEEDED **', log.read_text())
            self.assertNotIn('XCODE_', result.stdout + result.stderr)
            self.assertTrue(Path(receipt['result']['path']).is_file())

    def test_final_delivery_requires_development_ci_for_the_frozen_commit(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)))
            self.assertTrue(callable(getattr(a,'development_check',None)),'缺少最终必要 CI 核对')
            with patch.object(a,'gh_json',return_value={'workflow_runs':[{'id':1,'head_sha':'a'*40,'status':'completed','conclusion':'success'}]}):
                self.assertFalse(a.development_check()['done'])
            with patch.object(a,'gh_json',return_value={'workflow_runs':[{'id':2,'head_sha':'b'*40,'status':'completed','conclusion':'success','run_attempt':1}]}):
                self.assertTrue(a.development_check()['done'])

    def test_prepare_freeze_commit_preserves_project_commit_convention(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)));a.work.mkdir()
            with patch.object(a,'git',return_value=' M .release-batch.json') as git:
                a.freeze_manifest({'version':'0.2.164','buildNumber':'2164','inputFingerprint':'f'*64,'localValidation':'passed'})
            manifest=json.loads((a.work/'.release-batch.json').read_text())
            self.assertEqual(manifest['batchId'],'batch-test')
            commits=[c.args for c in git.call_args_list if c.args[0]=='commit']
            self.assertTrue(commits);self.assertTrue(commits[0][2].startswith('ci(发布):'))

    def test_source_response_loss_records_real_remote_job_without_duplicate_sync(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)));credentials=a.root/'credentials.json'
            m.atomic_json(credentials,{'url':'https://source.test','token':'test-secret'});a.options['source_credentials']=str(credentials)
            catalog={'revision':7,'entries':[{'id':'entry-a','config':{'repository':a.repo},'presentation':{'developerName':'alice'}}], 'jobs':[]}
            requests=[]
            def request(url,**kwargs):
                requests.append(url)
                if url.endswith('/sync'):
                    catalog['jobs'].append({'id':'job-confirmed','entryId':'entry-a','status':'queued'})
                    raise OSError('reply lost after queued')
                return catalog
            with patch.object(a,'url_json',side_effect=request),patch.object(a,'gh_json',return_value={'login':'alice'}):
                a.source_manage();a.source_manage()
            self.assertEqual(sum(u.endswith('/sync') for u in requests),1)
            self.assertEqual(a.read_progress()['operations']['source']['jobId'],'job-confirmed')

    def test_partial_device_zip_is_missing_not_a_permanent_parse_failure(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)));candidate=a.root/'half.ipa';candidate.write_bytes(b'PK partial')
            m.atomic_json(a.root/'iosbuild-intent.json',{'sourceCommit':'b'*40,'batchId':'batch-test','candidate':str(candidate)})
            self.assertFalse(a.iosbuild_check()['done']);self.assertTrue(candidate.exists())

    def test_ota_candidate_without_install_page_is_not_complete(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)));staging=a.root/'ota-half';staging.mkdir()
            release={'sourceCommit':'b'*40,'batchId':'batch-test','version':'0.2.164','sha256':'c'*64,'size':3,'entitlementsSha256':'e'*64,'manifestUrl':'https://ota.test/releases/0.2.164/manifest.plist'}
            m.atomic_json(a.root/'signed.json',release)
            with patch('ios_ota.check_package',return_value=release):
                with self.assertRaisesRegex((ValueError,OSError),'install|安装'):a.validate_ota_staging(staging)

    def test_source_without_presentation_preserves_public_developer(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)));credentials=a.root/'credentials.json'
            m.atomic_json(credentials,{'url':'https://source.test','token':'test-secret'})
            a.options.update(source_credentials=str(credentials),source_url='https://source.test/feed')
            catalog={'revision':7,'entries':[{'id':'entry-a','config':{'repository':a.repo},'presentation':{}}],'jobs':[]}
            feed={'apps':[{'appID':'entry-a','developerName':'legacy-owner','iconURL':'https://source.test/icon.png'}]}
            def request(url,**kwargs):return feed if url.endswith('/feed') else catalog
            with patch.object(a,'url_json',side_effect=request) as requests,patch.object(a,'gh_json',return_value={'login':'new-user'}):
                a.source_manage()
            body=next(c.kwargs['data'] for c in requests.call_args_list if c.args[0].endswith('/presentation'))
            self.assertEqual(body['developerName'],'legacy-owner, new-user');self.assertEqual(body['iconURL'],'https://source.test/icon.png')

    def test_partial_signed_zip_repacks_verified_app_without_signing(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)));directory=a.root/'.codex-ios-sign-partial';app=directory/'unpacked/Payload/PakePlus.app';app.mkdir(parents=True)
            (app/'Info.plist').write_bytes(plistlib.dumps({'CFBundleShortVersionString':'0.2.164','CFBundleVersion':'2164'}))
            (directory/'signed.ipa').write_bytes(b'PK partial archive')
            expected={'entitlements':{'key':'value'}};details={'metadata':{'version':'0.2.164','buildNumber':'2164'},'entitlements':{'key':'value'}}
            with patch('ios_sign.verify_app',return_value=details),patch('ios_sign.validate_signed_entitlements'),patch.object(a,'validate_signed_candidate',return_value={'signed':True}):
                self.assertTrue(a.recover_signed_candidate(expected))
            with zipfile.ZipFile(a.local_ipa(True)) as zip_file:self.assertIn('Payload/PakePlus.app/Info.plist',zip_file.namelist())

    def test_readonly_github_eof_retries_then_returns_same_query(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)))
            replies=[SimpleNamespace(returncode=1,stderr='Get API: EOF',stdout=''),SimpleNamespace(returncode=0,stderr='',stdout='{"ok":true}')]
            with patch.object(m.subprocess,'run',side_effect=replies) as run,patch.object(m.time,'sleep'):
                self.assertEqual(a.gh_json('repos/test/repo/actions/runs'),{'ok':True})
            self.assertEqual(run.call_count,2);self.assertEqual(run.call_args_list[0].args,run.call_args_list[1].args)

    def test_readonly_github_retry_is_bounded_and_auth_failure_is_not_retried(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)))
            with patch.object(m.subprocess,'run',return_value=SimpleNamespace(returncode=1,stderr='Get API: EOF',stdout='')) as run,patch.object(m.time,'sleep'):
                with self.assertRaisesRegex(RuntimeError,'EOF'):a.gh_json('test/read')
                self.assertEqual(run.call_count,4)
            with patch.object(m.subprocess,'run',return_value=SimpleNamespace(returncode=1,stderr='HTTP 403: forbidden',stdout='')) as run,patch.object(m.time,'sleep'):
                with self.assertRaises(RuntimeError):a.gh_json('test/read')
                self.assertEqual(run.call_count,1)

    def test_http_get_retries_eof_but_post_never_blindly_retries(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)))
            eof=SimpleNamespace(returncode=56,stderr='connection EOF',stdout='')
            ok=SimpleNamespace(returncode=0,stderr='',stdout='{"ok":true}\n200')
            with patch.object(m.subprocess,'run',side_effect=[eof,ok]) as run,patch.object(m.time,'sleep'):
                self.assertEqual(a.url_json('https://test/read'),{'ok':True});self.assertEqual(run.call_count,2)
            with patch.object(m.subprocess,'run',return_value=eof) as run,patch.object(m.time,'sleep'):
                with self.assertRaises(RuntimeError):a.request('https://test/write',method='POST',data={})
                self.assertEqual(run.call_count,1)

    def test_github_single_read_has_timeout_and_can_reconcile_after_timeout(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)))
            replies=[subprocess.TimeoutExpired('gh',45),SimpleNamespace(returncode=0,stderr='',stdout='{"ok":true}')]
            with patch.object(m.subprocess,'run',side_effect=replies) as run,patch.object(m.time,'sleep'):
                self.assertEqual(a.gh_json('test/read'),{'ok':True})
                self.assertTrue(all(c.kwargs.get('timeout')==45 for c in run.call_args_list))

    def test_source_missing_digest_is_a_missing_attestation_step(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)));a.options['source_url']='https://source.test/feed'
            expected={'downloadUrl':'https://github.test/unsigned.ipa','size':3,'sha256':'c'*64}
            feed={'apps':[{'appID':'entry-a','bundleIdentifier':'vip.loock.codexmobile','downloadURL':expected['downloadUrl'],'version':'0.2.164','buildVersion':'2164','size':3,'developerName':'alice'}]}
            feed['apps'][0]['downloadURL']='https://github.test/app-unsigned.ipa';expected['downloadUrl']=feed['apps'][0]['downloadURL']
            with patch.object(a,'build_check',return_value={'done':True,'result':{'artifacts':{'ios':expected}}}),patch.object(a,'url_json',return_value=feed),patch.object(a,'gh_json',return_value={'login':'alice'}):
                self.assertFalse(a.source_check()['done'])

    def test_source_attests_only_the_exact_missing_digest_once_after_response_loss(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)));credentials=a.root/'credentials.json'
            m.atomic_json(credentials,{'url':'https://source.test','token':'test-secret'});a.options['source_credentials']=str(credentials)
            expected={'downloadUrl':'https://github.test/app-unsigned.ipa','size':3,'sha256':'c'*64}
            entry={'id':'entry-a','config':{'repository':a.repo},'presentation':{'developerName':'alice'},
                   'current':{'downloadURL':expected['downloadUrl'],'metadata':{'version':'0.2.164','buildVersion':'2164'},'inspection':{'fullBytes':3},'fingerprint':'asset-fingerprint'}}
            catalog={'revision':7,'entries':[entry],'jobs':[]};posts=[]
            def request(url,**kwargs):
                if url.endswith('/attest'):
                    posts.append(kwargs['data']);entry['current']['sha256']='c'*64
                    raise OSError('attestation response lost')
                return catalog
            with patch.object(a,'url_json',side_effect=request),patch.object(a,'gh_json',return_value={'login':'alice'}),patch.object(a,'build_check',return_value={'done':True,'result':{'artifacts':{'ios':expected}}}):
                a.source_manage();a.source_manage()
            self.assertEqual(posts,[{'revision':7,'sha256':'c'*64}])
            self.assertTrue(a.read_progress()['operations']['source']['attestationVerified'])

    def test_source_attestation_last_allowed_cas_retry_is_verified(self):
        m=self.load()
        with tempfile.TemporaryDirectory() as tmp:
            a=m.Adapter(self.context(Path(tmp)));expected={'downloadUrl':'https://github.test/app-unsigned.ipa','size':3,'sha256':'c'*64}
            entry={'id':'entry-a','current':{'downloadURL':expected['downloadUrl'],'metadata':{'version':'0.2.164','buildVersion':'2164'},'inspection':{'fullBytes':3}}}
            catalog={'revision':1,'entries':[entry]};posts=[]
            def request(url,**kwargs):
                if url.endswith('/attest'):
                    posts.append(kwargs['data']);catalog['revision']+=1
                    if len(posts)<=3:raise RuntimeError('HTTP 409: revision conflict')
                    entry['current']['sha256']='c'*64
                return catalog
            with patch.object(a,'url_json',side_effect=request):
                self.assertTrue(a.attest_source('https://source.test',{},'entry-a',catalog,expected))
            self.assertEqual(len(posts),4)


if __name__ == '__main__': unittest.main()
