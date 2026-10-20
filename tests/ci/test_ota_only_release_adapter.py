import json
from pathlib import Path
import tempfile
import subprocess
import unittest
from unittest.mock import patch
import test_release_adapter as base_tests


class OtaOnlyReleaseTests(unittest.TestCase):
    def adapter(self, root):
        helper = base_tests.ReleaseAdapterTests()
        context = helper.context(root)
        context['project'] = 'codex-mobile-ios-ota-production'
        context['config']['environment'] = 'ota-production'
        context['config']['options']['kind'] = 'mobile-ota'
        context['config']['phases'] = ['main', 'iosbuild', 'sign', 'ota', 'ipa', 'verify']
        return helper.load().Adapter(context)

    def test_ota_reserves_a_version_and_checks_signing_like_a_mobile_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.adapter(Path(tmp)); a.work.mkdir()
            (a.work / 'mobile-version-floor.json').write_text('{"version":"0.2.122"}')
            with patch.object(a, 'git', return_value='source-tree'), patch.object(a, 'ios_config', return_value={'baseUrl':'https://test/ota','caFile':'test-ca'}), patch.object(a, 'url_json', return_value={'version':'0.2.180'}), patch.object(a, 'gh_json', return_value=[{'tag_name':'v0.2.178'}]), patch.object(a, 'signing_preflight') as signing, patch.object(a, 'merged_checks'), patch.object(a, 'freeze_manifest'):
                result = a.prepare()['result']
                self.assertEqual((result['version'], result['buildNumber']), ('0.2.181', '2181'))
                signing.assert_called_once()

    def test_ota_rejects_other_distribution_phases_before_io(self):
        for phase in ['build', 'apk', 'source', 'gateway']:
            for entry in ['check_phase', 'execute_phase', 'run_phase']:
                with self.subTest(phase=phase, entry=entry), tempfile.TemporaryDirectory() as tmp:
                    a = self.adapter(Path(tmp))
                    with patch.object(a, 'command', side_effect=AssertionError('不应执行外部命令')), patch.object(a, 'gh_json', side_effect=AssertionError('不应访问GitHub')), patch.object(a, 'url_json', side_effect=AssertionError('不应访问发布渠道')):
                        with self.assertRaisesRegex(ValueError, 'OTA'):
                            getattr(a, entry)(phase)

    def test_ota_verification_requires_only_authorized_channels_and_records_scope(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.adapter(Path(tmp)); calls = []
            def checked(phase):
                calls.append(phase)
                return {'done':True,'result':{'version':'0.2.164','signed':True,'sourceCommit':'b'*40}}
            with patch.object(a, 'development_check', return_value={'done':True,'result':{'runId':123}}), patch.object(a, 'main_check', side_effect=lambda:checked('main')), patch.object(a, 'iosbuild_check', side_effect=lambda:checked('iosbuild')), patch.object(a, 'sign_check', side_effect=lambda:checked('sign')), patch.object(a, 'ota_check', side_effect=lambda:checked('ota')), patch.object(a, 'lan_check', side_effect=checked), patch.object(a, 'prior_ota_history', return_value=[]), patch.object(a, 'build_check', side_effect=AssertionError('不能要求双端CI')), patch.object(a, 'source_check', side_effect=AssertionError('不能更新软件源')):
                result = a.check_phase('verify')
            self.assertTrue(result['done'])
            self.assertEqual(calls, ['main','iosbuild','sign','ota','ipa'])
            self.assertEqual(result['result']['distribution'], 'ota-only')
            receipt = json.loads((a.root/'ota-release.json').read_text())
            self.assertEqual(receipt['sourceCommit'], 'b'*40)
            self.assertFalse(receipt['githubReleasePublished'])
            self.assertFalse(receipt['apkPublished'])
            self.assertFalse(receipt['softwareSourceUpdated'])

    def test_ota_does_not_complete_when_development_ci_or_channel_is_pending(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.adapter(Path(tmp))
            with patch.object(a, 'development_check', return_value={'done':False}), patch.object(a, 'main_check', side_effect=AssertionError('等待CI')):
                self.assertEqual(a.check_phase('verify'), {'done':False,'result':{'missing':'development'}})
            with patch.object(a, 'development_check', return_value={'done':True,'result':{}}), patch.object(a, 'main_check', return_value={'done':False}):
                self.assertEqual(a.check_phase('verify'), {'done':False,'result':{'missing':'main'}})
            self.assertFalse((a.root/'ota-release.json').exists())

    def test_ota_project_cannot_be_reconfigured_as_full_release(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.adapter(Path(tmp))
            for field, value in [('branch','other'), ('kind','mobile'), ('phases',['main','build','iosbuild','sign','ota','apk','ipa','source','verify'])]:
                context = json.loads(json.dumps(a.context))
                if field == 'kind': context['config']['options'][field] = value
                else: context['config'][field] = value
                with self.subTest(field=field), self.assertRaisesRegex(ValueError, 'OTA'):
                    base_tests.ReleaseAdapterTests().load().Adapter(context)

    def test_prior_standalone_receipt_is_bound_to_its_real_ancestor(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.adapter(Path(tmp)); a.work.mkdir()
            def git(*args):
                return subprocess.check_output(['git',*args],cwd=a.work,text=True,stderr=subprocess.DEVNULL).strip()
            git('init','-q');git('config','user.email','test@example.com');git('config','user.name','Test')
            (a.work/'source.txt').write_text('source');git('add','.');git('commit','-qm','source')
            source = git('rev-parse','HEAD')
            directory = a.work/'docs/evidence';directory.mkdir(parents=True)
            receipt = {'version':'0.2.163','sourceCommit':source,'size':7,'sha256':'c'*64,'signed':True,'distribution':'ota-only'}
            (directory/'prior.json').write_text(json.dumps(receipt))
            (a.work/'release').mkdir()
            index = a.work/'release/standalone-ota-history.json'
            index.write_text(json.dumps({'schemaVersion':1,'receipts':['docs/evidence/prior.json']}))
            git('add','.');git('commit','-qm','freeze')
            a.context['frozen']['sha']=git('rev-parse','HEAD')
            result=a.prior_ota_history()
            self.assertEqual(result[0]['sourceCommit'],source)
            self.assertEqual(result[0]['sha256'],'c'*64)
            self.assertTrue(result[0]['sourceIncluded'])
            self.assertNotIn('batchId',result[0])
            # 冻结后即使工作区记录被改写，读取的仍是冻结提交中的原凭证。
            (directory/'prior.json').write_text('{}')
            self.assertEqual(a.prior_ota_history(),result)

    def test_prior_receipt_from_other_history_cannot_be_claimed_integrated(self):
        with tempfile.TemporaryDirectory() as tmp:
            a=self.adapter(Path(tmp));a.work.mkdir();(a.work/'release').mkdir()
            (a.work/'release/standalone-ota-history.json').write_text('{}')
            index=json.dumps({'schemaVersion':1,'receipts':['docs/evidence/prior.json']})
            receipt=json.dumps({'version':'0.2.163','sourceCommit':'a'*40,'size':7,'sha256':'c'*64,'signed':True,'distribution':'ota-only'})
            def git(*args):
                if args[0]=='show':return index if args[1].endswith('standalone-ota-history.json') else receipt
                raise RuntimeError('not an ancestor')
            with patch.object(a,'git',side_effect=git),self.assertRaisesRegex(RuntimeError,'ancestor'):
                a.prior_ota_history()

    def test_missing_or_empty_history_index_is_not_silently_accepted(self):
        with tempfile.TemporaryDirectory() as tmp:
            a=self.adapter(Path(tmp))
            with self.assertRaisesRegex(ValueError,'历史索引'):
                a.prior_ota_history()
            (a.work/'release').mkdir(parents=True)
            (a.work/'release/standalone-ota-history.json').write_text('{}')
            with patch.object(a,'git',return_value='{"schemaVersion":1,"receipts":[]}'), self.assertRaisesRegex(ValueError,'历史索引'):
                a.prior_ota_history()

    def test_repository_history_preserves_both_original_standalone_deliveries(self):
        root=Path(__file__).resolve().parents[2]
        index=json.loads((root/'release/standalone-ota-history.json').read_text())
        receipts=[json.loads((root/path).read_text()) for path in index['receipts']]
        self.assertEqual({r['version']:r['sourceCommit'] for r in receipts}, {
            '0.2.179':'cb6e33d7255ee8d1c1485e8af24bb7c332ef8072',
            '0.2.180':'e568d72a41a9de0aa3cd2209a547456bf207cd62'})
