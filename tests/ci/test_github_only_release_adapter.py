import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import test_unsigned_release_adapter as unsigned_tests


PHASES = ['main', 'build', 'source', 'verify']
POLICY = {'schemaVersion':1, 'iosDistribution':'unsigned-only', 'androidDistribution':'github-only'}


class GithubOnlyReleaseTests(unittest.TestCase):
    def context(self, root):
        context = unsigned_tests.UnsignedReleaseTests().context(root)
        context['project'] = 'codex-mobile-github-only'
        context['config'].update(target='codex-mobile-github-only', environment='github-only', phases=PHASES.copy())
        context['config']['options']['kind'] = 'mobile-github-only'
        (Path(context['workspace']) / 'release/distribution-policy.json').write_text(json.dumps(POLICY))
        return context

    def adapter(self, root):
        return unsigned_tests.a_module().Adapter(self.context(root))

    def test_prepare_works_with_disabled_lan_without_signing_or_https_and_keeps_failed_reservation(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.adapter(Path(tmp))
            (a.work / 'mobile-version-floor.json').write_text('{"version":"0.3.36"}')
            prior = a.root.parent / 'old-037-failed' / 'version.json'
            prior.parent.mkdir()
            prior.write_text('{"version":"0.3.37"}')
            with patch.object(a, 'git', return_value='source-tree'), patch.object(a, 'url_json', side_effect=AssertionError('不得读取已关闭LAN或HTTPS')), patch.object(a, 'ios_config', side_effect=AssertionError('不得读取签名配置')), patch.object(a, 'signing_preflight', side_effect=AssertionError('不得验签')), patch.object(a, 'gh_json', return_value=[{'tag_name':'v0.3.36'}]), patch.object(a, 'merged_checks'), patch.object(a, 'freeze_manifest'):
                result = a.prepare()['result']
            self.assertEqual((result['version'], result['buildNumber']), ('0.3.38', '3038'))
            self.assertTrue(a.mobile)
            self.assertTrue(a.unsigned_only)
            self.assertTrue(a.github_only)

    def test_prepare_reads_all_github_release_pages_and_repository_floor(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.adapter(Path(tmp))
            (a.work / 'mobile-version-floor.json').write_text('{"version":"0.3.38"}')
            pages = [[{'tag_name':'v0.3.36'}] * 100, [{'tag_name':'unsigned-ipa-0.3.40-123-1'}]]
            with patch.object(a, 'git', return_value='source-tree'), patch.object(a, 'url_json', side_effect=AssertionError('不得访问LAN')), patch.object(a, 'gh_json', side_effect=pages), patch.object(a, 'merged_checks'), patch.object(a, 'freeze_manifest'):
                self.assertEqual(a.prepare()['result']['version'], '0.3.41')
        with tempfile.TemporaryDirectory() as tmp:
            a = self.adapter(Path(tmp))
            (a.work / 'mobile-version-floor.json').write_text('{"version":"0.3.50"}')
            with patch.object(a, 'git', return_value='source-tree'), patch.object(a, 'url_json', side_effect=AssertionError('不得访问LAN')), patch.object(a, 'gh_json', return_value=[]), patch.object(a, 'merged_checks'), patch.object(a, 'freeze_manifest'):
                self.assertEqual(a.prepare()['result']['version'], '0.3.51')

    def test_new_policy_blocks_all_legacy_client_kinds_and_projects(self):
        for kind, project, target, environment, phases in [
                ('mobile', 'codex-mobile-lan-production', 'vip.loock.codexmobile', 'lan-production', ['main','build','iosbuild','sign','ota','apk','ipa','source','verify']),
                ('mobile-ota', 'codex-mobile-ios-ota-production', 'vip.loock.codexmobile', 'ota-production', ['main','iosbuild','sign','ota','ipa','verify']),
                ('mobile-unsigned', 'codex-mobile-github-release', 'codex-mobile-github-release', 'github-release', unsigned_tests.PHASES)]:
            for configured_kind in [kind, 'gateway']:
                with self.subTest(kind=configured_kind, project=project), tempfile.TemporaryDirectory() as tmp:
                    context = self.context(Path(tmp))
                    context['project'] = project
                    context['config'].update(target=target, environment=environment, phases=phases)
                    context['config']['options']['kind'] = configured_kind
                    with self.assertRaisesRegex(ValueError, 'github-only'):
                        unsigned_tests.a_module().Adapter(context)

    def test_each_phase_entry_rejects_lan_signing_ota_and_gateway_before_io(self):
        for phase in ['apk','ipa','iosbuild','sign','ota','gateway','unknown']:
            for entry in ['check_phase','execute_phase','run_phase']:
                with self.subTest(phase=phase, entry=entry), tempfile.TemporaryDirectory() as tmp:
                    a = self.adapter(Path(tmp))
                    with patch.object(a, 'command', side_effect=AssertionError('不应执行命令')), patch.object(a, 'url_json', side_effect=AssertionError('不应访问渠道')), patch.object(a, 'gh_json', side_effect=AssertionError('不应查询GitHub')), self.assertRaisesRegex(ValueError, 'github-only'):
                        getattr(a, entry)(phase)

    def test_run_authorization_cannot_be_bypassed_by_completed_checker(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.adapter(Path(tmp))
            with patch.object(a, 'check_phase', return_value={'done':True}), self.assertRaisesRegex(ValueError, 'github-only'):
                a.run_phase('apk')

    def test_new_project_identity_and_exact_phase_order_are_mandatory(self):
        for field, value in [('project','codex-mobile-github-release'), ('target','codex-mobile-github-release'),
                             ('environment','github-release'), ('branch','other'), ('scope','other'),
                             ('phases',PHASES + ['apk']), ('phases',PHASES[:-1]), ('phases',list(reversed(PHASES))),
                             ('kind','mobile-unsigned')]:
            with self.subTest(field=field, value=value), tempfile.TemporaryDirectory() as tmp:
                context = self.context(Path(tmp))
                if field == 'kind': context['config']['options'][field] = value
                else: (context if field in ('project','scope') else context['config'])[field] = value
                with self.assertRaisesRegex(ValueError, 'github-only'):
                    unsigned_tests.a_module().Adapter(context)

    def test_old_ios_only_policy_keeps_previous_unsigned_lan_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = unsigned_tests.UnsignedReleaseTests().adapter(Path(tmp))
            with patch.object(a, 'lan_check', return_value={'done':True,'result':{'version':a.version}}):
                self.assertTrue(a.check_phase('apk')['done'])

    def test_gateway_ignores_new_client_policy(self):
        with tempfile.TemporaryDirectory() as tmp:
            context = self.context(Path(tmp))
            context.update(project='codex-mobile-gateway-production')
            context['config'].update(target='codex-mobile-gateway', environment='production', phases=['main','gateway','verify'])
            context['config']['options']['kind'] = 'gateway'
            self.assertFalse(unsigned_tests.a_module().Adapter(context).mobile)

    def verification(self, a, **kwargs):
        stack, artifacts = unsigned_tests.UnsignedReleaseTests().verification(a, **kwargs)
        stack.enter_context(patch.object(a, 'lan_check', side_effect=AssertionError('不应读取LAN')))
        return stack, artifacts

    def test_verify_downloads_both_github_assets_and_records_no_lan_publication(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.adapter(Path(tmp))
            stack, artifacts = self.verification(a)
            with stack:
                result = a.check_phase('verify')
            self.assertTrue(result['done'])
            self.assertEqual(result['result']['distribution'], 'github-only')
            self.assertEqual(set(result['result']['channels']), {'development','main','build','source'})
            receipt = json.loads((a.root / 'github-release.json').read_text())
            for evidence in [result['result'], receipt]:
                self.assertFalse(evidence['lanApkPublished'])
                self.assertFalse(evidence['signedIpaPublished'])
                self.assertFalse(evidence['otaPublished'])
                self.assertFalse(evidence['fixedIpaPublished'])
            self.assertEqual(receipt['distribution'], 'github-only')
            self.assertEqual(receipt['sourceCommit'], a.frozen_sha)
            self.assertTrue(receipt['githubReleasePublished'])
            self.assertTrue(receipt['softwareSourceUpdated'])
            for item in artifacts.values():
                self.assertTrue((a.root / ('verified-github-' + Path(item['path']).name)).is_file())
            for name in ['ota-release.json','unsigned-release.json','verified-lan.apk','verified-lan.ipa']:
                self.assertFalse((a.root / name).exists())

    def test_verify_waits_for_each_required_step_without_receipt(self):
        for phase in ['development','main','build','source']:
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as tmp:
                a = self.adapter(Path(tmp))
                stack, _ = self.verification(a, missing=phase)
                with stack:
                    self.assertEqual(a.check_phase('verify'), {'done':False,'result':{'missing':phase}})
                self.assertFalse((a.root / 'github-release.json').exists())

    def test_verify_rejects_corrupt_github_packages_without_receipt(self):
        for platform in ['android','ios']:
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as tmp:
                a = self.adapter(Path(tmp))
                stack, _ = self.verification(a, corrupt=platform)
                with stack, self.assertRaisesRegex(ValueError, 'GET.*SHA-256'):
                    a.check_phase('verify')
                self.assertFalse((a.root / 'github-release.json').exists())

    def test_software_source_still_matches_existing_bundle_id(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.adapter(Path(tmp))
            item = {'downloadUrl':'https://github.test/app-unsigned.ipa','size':3,'sha256':'c'*64}
            feed = {'apps':[{'appID':'existing-entry','bundleIdentifier':'vip.loock.codexmobile',
                            'downloadURL':item['downloadUrl'],'version':a.version,'buildVersion':a.build_number,
                            'size':3,'sha256':'c'*64,'developerName':'alice-old, alice'}]}
            a.options['source_url'] = 'https://source.test/feed.json'
            with patch.object(a, 'build_check', return_value={'done':True,'result':{'artifacts':{'ios':item}}}), patch.object(a, 'url_json', return_value=feed), patch.object(a, 'gh_json', return_value={'login':'alice'}):
                self.assertTrue(a.source_check()['done'])

    def test_repository_policy_and_github_only_template_agree(self):
        root = Path(__file__).resolve().parents[2]
        self.assertEqual(json.loads((root / 'release/distribution-policy.json').read_text()), POLICY)
        path = root / 'release/coordinator.github-only.example.json'
        self.assertTrue(path.is_file(), '缺少GitHub-only模板')
        template = json.loads(path.read_text())
        self.assertEqual(template['id'], 'codex-mobile-github-only')
        self.assertEqual(template['target'], 'codex-mobile-github-only')
        self.assertEqual(template['environment'], 'github-only')
        self.assertEqual(template['options']['kind'], 'mobile-github-only')
        self.assertEqual(template['phases'], PHASES)
        self.assertNotIn('ios_config', template['options'])
        self.assertNotIn('lan_publisher', template['options'])
