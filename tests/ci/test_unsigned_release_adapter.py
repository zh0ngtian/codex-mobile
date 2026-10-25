from contextlib import ExitStack
import hashlib
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

import test_release_adapter as base_tests


PHASES = ['main', 'build', 'apk', 'source', 'verify']
POLICY = {'schemaVersion': 1, 'iosDistribution': 'unsigned-only'}


class UnsignedReleaseTests(unittest.TestCase):
    def context(self, root, *, policy=True):
        context = base_tests.ReleaseAdapterTests().context(root)
        context['project'] = 'codex-mobile-github-release'
        context['config'].update(target='codex-mobile-github-release', environment='github-release', phases=PHASES.copy())
        context['config']['options']['kind'] = 'mobile-unsigned'
        work = Path(context['workspace'])
        (work / 'release').mkdir(parents=True)
        if policy:
            (work / 'release/distribution-policy.json').write_text(json.dumps(POLICY))
        return context

    def adapter(self, root):
        return base_tests.ReleaseAdapterTests().load().Adapter(self.context(root))

    def test_prepare_needs_no_signing_material_or_https_ota_and_keeps_all_version_floors(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.adapter(Path(tmp))
            (a.work / 'mobile-version-floor.json').write_text('{"version":"0.3.10"}')
            prior = a.root.parent / 'old-failed' / 'version.json'
            prior.parent.mkdir()
            prior.write_text('{"version":"0.3.42"}')
            pages = [[{'tag_name': 'v0.3.40'}] * 100, [{'tag_name': 'unsigned-ipa-0.3.44-123-1'}]]
            channels = {a_module().LAN + '/latest.json': {'version': '0.3.41'},
                        a_module().LAN + '/latest-ios.json': {'version': '0.3.43'}}
            with patch.object(a, 'git', return_value='source-tree'), patch.object(a, 'ios_config', side_effect=AssertionError('不应读取签名配置')), patch.object(a, 'signing_preflight', side_effect=AssertionError('不应验签')), patch.object(a, 'url_json', side_effect=lambda url: channels[url]), patch.object(a, 'gh_json', side_effect=pages), patch.object(a, 'merged_checks') as checks, patch.object(a, 'freeze_manifest'):
                prepared = a.prepare()['result']
            self.assertEqual((prepared['version'], prepared['buildNumber']), ('0.3.45', '3045'))
            self.assertEqual(prepared['localValidation'], 'passed')
            checks.assert_called_once()
            self.assertTrue(a.mobile)
            self.assertTrue(a.unsigned_only)
            self.assertFalse((a.root / 'signing-preflight.json').exists())

    def test_retained_failed_reservation_alone_sets_next_unsigned_version(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.adapter(Path(tmp))
            (a.work / 'mobile-version-floor.json').write_text('{"version":"0.3.36"}')
            prior = a.root.parent / 'old-failed' / 'version.json'
            prior.parent.mkdir()
            prior.write_text('{"version":"0.3.50"}')
            with patch.object(a, 'git', return_value='source-tree'), patch.object(a, 'url_json', return_value={'version':'0.3.36'}), patch.object(a, 'gh_json', return_value=[]), patch.object(a, 'merged_checks'), patch.object(a, 'freeze_manifest'):
                self.assertEqual(a.prepare()['result']['version'], '0.3.51')

    def test_each_public_phase_entry_rejects_unapproved_steps_before_io(self):
        for phase in ['iosbuild', 'sign', 'ota', 'ipa', 'gateway', 'unknown']:
            for entry in ['check_phase', 'execute_phase', 'run_phase']:
                with self.subTest(phase=phase, entry=entry), tempfile.TemporaryDirectory() as tmp:
                    a = self.adapter(Path(tmp))
                    with patch.object(a, 'command', side_effect=AssertionError('不应执行命令')), patch.object(a, 'gh_json', side_effect=AssertionError('不应查询GitHub')), patch.object(a, 'url_json', side_effect=AssertionError('不应查询渠道')), self.assertRaisesRegex(ValueError, 'unsigned-only'):
                        getattr(a, entry)(phase)

    def test_run_rejects_unapproved_step_even_if_checker_is_replaced(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.adapter(Path(tmp))
            with patch.object(a, 'check_phase', return_value={'done':True}), self.assertRaisesRegex(ValueError, 'unsigned-only'):
                a.run_phase('sign')

    def test_unsigned_identity_and_exact_phase_contract_cannot_be_reconfigured(self):
        for field, value in [('project','codex-mobile-lan-production'), ('target','vip.loock.codexmobile'),
                             ('environment','lan-production'), ('branch','other'), ('scope','other'),
                             ('phases',PHASES + ['sign']), ('phases',PHASES[:-1]), ('phases',list(reversed(PHASES)))]:
            with self.subTest(field=field, value=value), tempfile.TemporaryDirectory() as tmp:
                context = self.context(Path(tmp))
                (context if field in ('project','scope') else context['config'])[field] = value
                with self.assertRaisesRegex(ValueError, 'unsigned-only'):
                    a_module().Adapter(context)

    def test_new_project_cannot_be_reconfigured_to_another_kind(self):
        for kind in ['mobile', 'mobile-ota', 'gateway']:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                context = self.context(Path(tmp), policy=False)
                context['config']['options']['kind'] = kind
                with self.assertRaisesRegex(ValueError, 'unsigned-only'):
                    a_module().Adapter(context)

    def test_unsigned_policy_blocks_legacy_mobile_and_ota_templates(self):
        for kind in ['mobile', 'mobile-ota']:
            with self.subTest(kind=kind), tempfile.TemporaryDirectory() as tmp:
                root = Path(tmp)
                self.context(root)
                context = base_tests.ReleaseAdapterTests().context(root)
                if kind == 'mobile-ota':
                    context.update(project='codex-mobile-ios-ota-production')
                    context['config'].update(environment='ota-production', phases=['main','iosbuild','sign','ota','ipa','verify'])
                    context['config']['options']['kind'] = kind
                with self.assertRaisesRegex(ValueError, 'unsigned-only'):
                    a_module().Adapter(context)

    def test_malformed_or_unsupported_policy_fails_closed(self):
        for policy in [{}, {'schemaVersion':2,'iosDistribution':'unsigned-only'}, {'schemaVersion':1,'iosDistribution':'signed'}, None]:
            with self.subTest(policy=policy), tempfile.TemporaryDirectory() as tmp:
                context = self.context(Path(tmp))
                path = Path(context['workspace']) / 'release/distribution-policy.json'
                path.write_text(json.dumps(policy))
                with self.assertRaisesRegex(ValueError, '分发策略'):
                    a_module().Adapter(context)

    def test_legacy_workspaces_without_policy_keep_original_mobile_behavior(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = a_module().Adapter(base_tests.ReleaseAdapterTests().context(Path(tmp)))
            self.assertTrue(a.mobile)
            self.assertFalse(a.unsigned_only)

    def test_policy_does_not_change_gateway_contract(self):
        with tempfile.TemporaryDirectory() as tmp:
            context = self.context(Path(tmp))
            context.update(project='codex-mobile-gateway-production')
            context['config'].update(target='codex-mobile-gateway', environment='production', phases=['main','gateway','verify'])
            context['config']['options']['kind'] = 'gateway'
            a = a_module().Adapter(context)
            self.assertFalse(a.mobile)

    def test_gateway_does_not_read_client_distribution_policy(self):
        with tempfile.TemporaryDirectory() as tmp:
            context = self.context(Path(tmp))
            context.update(project='codex-mobile-gateway-production')
            context['config'].update(target='codex-mobile-gateway', environment='production', phases=['main','gateway','verify'])
            context['config']['options']['kind'] = 'gateway'
            (Path(context['workspace']) / 'release/distribution-policy.json').write_text('{')
            self.assertFalse(a_module().Adapter(context).mobile)

    def test_source_uses_existing_app_bundle_identity_for_new_release_project(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.adapter(Path(tmp))
            unsigned = {'downloadUrl':'https://github.test/app-unsigned.ipa','size':3,'sha256':'c'*64}
            feed = {'apps':[{'appID':'existing-entry','bundleIdentifier':'vip.loock.codexmobile',
                            'downloadURL':unsigned['downloadUrl'],'version':a.version,'buildVersion':a.build_number,
                            'size':3,'sha256':'c'*64,'developerName':'alice-old, alice'}]}
            a.options['source_url'] = 'https://source.test/feed.json'
            with patch.object(a, 'build_check', return_value={'done':True,'result':{'artifacts':{'ios':unsigned}}}), patch.object(a, 'url_json', return_value=feed), patch.object(a, 'gh_json', return_value={'login':'alice'}):
                result = a.source_check()
            self.assertTrue(result['done'])
            self.assertEqual(result['result']['appId'], 'existing-entry')

    def verification(self, a, *, missing=None, corrupt=None):
        payloads = {'android':b'github-apk', 'ios':b'github-unsigned-ipa'}
        artifacts = {platform:{'path':str(a.root / ('app.apk' if platform == 'android' else 'app-unsigned.ipa')),
                               'downloadUrl':'https://github.test/' + platform, 'size':len(data),
                               'sha256':hashlib.sha256(data).hexdigest()} for platform, data in payloads.items()}
        results = {'development':{'runId':10}, 'main':{'sourceCommit':a.frozen_sha},
                   'build':{'artifacts':artifacts, 'releaseUrl':'https://github.test/releases/v' + a.version},
                   'apk':{'version':a.version}, 'source':{'version':a.version,'signed':False}}
        stack = ExitStack()
        for phase, method in [('development','development_check'), ('main','main_check'), ('build','build_check'), ('apk','lan_check'), ('source','source_check')]:
            stack.enter_context(patch.object(a, method, return_value={'done':phase != missing, 'result':results[phase]}))
        for method in ['ios_config','iosbuild_check','sign_check','ota_check','prior_ota_history']:
            stack.enter_context(patch.object(a, method, side_effect=AssertionError('unsigned-only 不得进入旧签名链路')))
        # 仅替换网络边界，HEAD、完整GET及散列比较仍运行真实 download_verified。
        stack.enter_context(patch.object(a, 'request', side_effect=lambda url, method, **kwargs: 'content-length: ' + str(len(payloads[url.rsplit('/',1)[-1]])) + '\r\n'))
        def download(args, **kwargs):
            data = payloads[args[-1].rsplit('/',1)[-1]]
            Path(args[args.index('--output')+1]).write_bytes(b'x' * len(data) if corrupt == args[-1].rsplit('/',1)[-1] else data)
            return ''
        stack.enter_context(patch.object(a, 'command', side_effect=download))
        return stack, artifacts

    def test_verify_records_only_unsigned_release_channels_and_downloads_both_github_assets(self):
        with tempfile.TemporaryDirectory() as tmp:
            a = self.adapter(Path(tmp))
            stack, artifacts = self.verification(a)
            with stack:
                result = a.check_phase('verify')
            self.assertTrue(result['done'])
            self.assertEqual(result['result']['distribution'], 'unsigned-only')
            self.assertEqual(set(result['result']['channels']), {'development','main','build','apk','source'})
            receipt = json.loads((a.root / 'unsigned-release.json').read_text())
            self.assertEqual(receipt['distribution'], 'unsigned-only')
            self.assertEqual(receipt['sourceCommit'], a.frozen_sha)
            self.assertTrue(receipt['githubReleasePublished'])
            self.assertTrue(receipt['apkPublished'])
            self.assertTrue(receipt['softwareSourceUpdated'])
            self.assertFalse(receipt['signedIpaPublished'])
            self.assertFalse(receipt['otaPublished'])
            self.assertFalse(receipt['fixedIpaPublished'])
            for item in artifacts.values():
                self.assertTrue((a.root / ('verified-github-' + Path(item['path']).name)).is_file())
            self.assertFalse((a.root / 'ota-release.json').exists())
            self.assertFalse((a.root / 'verified-lan.ipa').exists())

    def test_verify_waits_for_each_required_step_without_emitting_success_receipt(self):
        for phase in ['development','main','build','apk','source']:
            with self.subTest(phase=phase), tempfile.TemporaryDirectory() as tmp:
                a = self.adapter(Path(tmp))
                stack, _ = self.verification(a, missing=phase)
                with stack:
                    self.assertEqual(a.check_phase('verify'), {'done':False,'result':{'missing':phase}})
                self.assertFalse((a.root / 'unsigned-release.json').exists())

    def test_verify_rejects_corrupt_github_apk_or_unsigned_ipa_without_success_receipt(self):
        for platform in ['android','ios']:
            with self.subTest(platform=platform), tempfile.TemporaryDirectory() as tmp:
                a = self.adapter(Path(tmp))
                stack, _ = self.verification(a, corrupt=platform)
                with stack, self.assertRaisesRegex(ValueError, 'GET.*SHA-256'):
                    a.check_phase('verify')
                self.assertFalse((a.root / 'unsigned-release.json').exists())

    def test_repository_policy_and_new_template_agree(self):
        root = Path(__file__).resolve().parents[2]
        self.assertEqual(json.loads((root / 'release/distribution-policy.json').read_text()), POLICY)
        template = json.loads((root / 'release/coordinator.unsigned.example.json').read_text())
        self.assertEqual(template['id'], 'codex-mobile-github-release')
        self.assertEqual(template['options']['kind'], 'mobile-unsigned')
        self.assertEqual(template['phases'], PHASES)
        self.assertNotIn('ios_config', template['options'])


def a_module():
    return base_tests.ReleaseAdapterTests().load()
