import concurrent.futures
import importlib.util
import json
import plistlib
from pathlib import Path
import subprocess
import sys
import tempfile
import zipfile
import unittest
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


if __name__ == '__main__': unittest.main()
