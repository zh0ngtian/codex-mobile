"""用临时部署目录和受控 launchctl/HTTP 替身验证网关恢复。"""
import hashlib
import importlib.util
import io
import json
import pathlib
import shutil
import sys
import tempfile
import types
import unittest
from unittest.mock import patch

ROOT = pathlib.Path(__file__).resolve().parents[2]
MODULE = ROOT / 'scripts/release_coordination/gateway.py'


def load_gateway():
    # 独立组件先于共享状态模块开发；整合后优先使用真实共享实现。
    sys.path.insert(0, str(ROOT / 'scripts'))
    helper = ROOT / 'scripts/release_coordination/state.py'
    if not helper.exists():
        state = types.ModuleType('release_coordination.state')
        def atomic_json(path, data):
            path = pathlib.Path(path)
            path.parent.mkdir(parents=True, exist_ok=True)
            temporary = path.with_suffix('.tmp')
            temporary.write_text(json.dumps(data))
            temporary.replace(path)
        state.atomic_json = atomic_json
        state.read_json = lambda path: json.loads(pathlib.Path(path).read_text())
        state.sha256 = lambda path: hashlib.sha256(pathlib.Path(path).read_bytes()).hexdigest()
        sys.modules['release_coordination.state'] = state
    spec = importlib.util.spec_from_file_location('release_coordination.gateway', MODULE)
    module = importlib.util.module_from_spec(spec)
    sys.modules[spec.name] = module
    spec.loader.exec_module(module)
    return module


def put(path, content):
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content)


class Adapter:
    def __init__(self, root):
        self.context = {'id': 'batch-1', 'frozen': {'sha': 'a' * 40}}
        self.root = root / 'batch'
        self.root.mkdir()
        self.work = root / 'frozen'
        self.options = {'gateway_root': str(root / 'live'), 'gateway_label': 'test.codex-gateway',
                        'gateway_health_attempts': 1}
        self.live = pathlib.Path(self.options['gateway_root'])
        self.package = self.live / 'node_modules/codex-mobile'
        manifest = json.dumps({'name': 'codex-mobile', 'version': '0.2.0', 'dependencies': {'ws': '^8'}})
        put(self.package / 'package.json', manifest)
        put(self.package / 'dist/index.html', 'existing frontend')
        put(self.package / 'npm-dist/server/index.js', 'old server')
        put(self.package / 'bin/codex-mobile.mjs', 'old entry')
        put(self.package / 'node_modules/nested/index.js', 'nested dependency')
        put(self.live / 'node_modules/ws/index.js', 'keep dependency')
        put(self.live / 'start.py', 'existing start script')
        put(self.live / 'gateway-env.json', json.dumps({'PORT': '19876', 'CODEX_MOBILE_TOKEN': 'private token',
                                                     'CODEX_APP_SERVER_MODE': 'managed'}))
        put(self.work / 'package.json', manifest)
        put(self.work / 'package-lock.json', '{"lockfileVersion": 3}')
        put(self.work / 'tsconfig.npm.json', '{"include": ["server/**/*.ts"]}')
        put(self.work / 'server/index.ts', 'frozen server source')
        put(self.work / 'bin/codex-mobile.mjs', 'new entry')
        put(self.work / 'bin/access-url.mjs', 'new helper')
        self.pid = 100
        self.calls = []
        self.events = []
        self.loss = False
        self.loss_before_restart = False
        self.fail_before_restart = False
        self.bad_command = False
        self.drift_on_install = False
        self.listener_matches = True
        self.dirty_work = False
        self.query_error = False
        self.build_response_loss = False
        self.build_exit_code = 0
        self.http_payload = {'mode': 'managed', 'upstreamUrl': 'ws://127.0.0.1:18765'}
        self.requests = []
        self.proxy_handlers = []

    def command(self, args, cwd=None, input=None):
        self.calls.append(list(args))
        if len(args) > 2 and args[1] == '-c':
            with patch.object(sys, 'argv', ['-c', *args[3:]]):
                exec(args[2], {})
            if self.build_response_loss:
                raise RuntimeError('build response lost after child checkpoint')
            return ''
        if args[:2] == ['git', 'status']:
            return ' M server/index.ts\n' if self.dirty_work else ''
        if args[:2] == ['git', 'rev-parse']:
            return self.context['frozen']['sha'] + '\n'
        if args == ['npm', 'run', 'build:server']:
            put(self.work / 'npm-dist/server/index.js', 'new server')
            return ''
        if args[:2] == ['launchctl', 'print']:
            if self.query_error:
                raise RuntimeError('launchd query unavailable')
            return f'gui/501/test.codex-gateway = {{\n state = running\n pid = {self.pid}\n}}'
        if args[:2] == ['launchctl', 'kickstart']:
            record = json.loads((self.root / 'gateway-progress.json').read_text())
            assert record['restart']['oldPid'] == self.pid
            assert record['restart']['intent'] is True
            if self.loss_before_restart:
                raise RuntimeError('restart request not performed')
            self.pid += 1
            if self.loss:
                raise RuntimeError('restart response lost')
            return ''
        if args[0] == 'lsof':
            return str(self.pid) if self.listener_matches else ''
        if args[0] == 'ps':
            entry = self.package / 'bin/codex-mobile.mjs'
            return f'/opt/homebrew/bin/node {entry} start\n' if not self.bad_command else 'node /other/service.js\n'
        raise AssertionError(f'unexpected external command: {args}')

    def build(self, args, cwd=None, stdout=None, stderr=None):
        self.calls.append(list(args))
        if args != ['npm', 'run', 'build:server']:
            raise AssertionError(f'unexpected build: {args}')
        put(self.work / 'npm-dist/server/index.js', 'new server')
        if self.options.get('gateway_desktop_meter'):
            put(self.work / 'npm-dist/server/desktop-model-upload.js', 'export const runDesktopModelUpload = () => 0;')
        stdout.write(b'> codex-mobile build:server\n> tsc -p tsconfig.npm.json\n')
        return types.SimpleNamespace(returncode=self.build_exit_code)

    def progress(self, phase, **fields):
        self.events.append((phase, fields))
        if phase == 'gateway_installed' and self.drift_on_install:
            self.pid += 1
        if phase == 'gateway_installed' and self.fail_before_restart:
            raise RuntimeError('interrupted after install')

    def read_progress(self):
        return {}

    def build_opener(self, *handlers):
        self.proxy_handlers.extend(handlers)
        return types.SimpleNamespace(open=self.urlopen)

    def urlopen(self, request, timeout=None):
        self.requests.append(request)
        return io.BytesIO(json.dumps(self.http_payload).encode())

    def count(self, prefix):
        return sum(call[:len(prefix)] == prefix for call in self.calls)


class GatewayTests(unittest.TestCase):
    def setUp(self):
        self.assertTrue(MODULE.exists(), '缺少可恢复的网关发布阶段')
        self.module = load_gateway()
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.adapter = Adapter(pathlib.Path(self.temporary.name))
        self.http = patch.object(self.module.urllib.request, 'urlopen', self.adapter.urlopen)
        self.http.start()
        self.addCleanup(self.http.stop)
        opener = patch.object(self.module.urllib.request, 'build_opener', self.adapter.build_opener)
        opener.start()
        self.addCleanup(opener.stop)
        self.gateway = self.module.Gateway(self.adapter)
        diagnostics = patch.object(self.module.sys, 'stderr', io.StringIO())
        diagnostics.start()
        self.addCleanup(diagnostics.stop)
        if hasattr(self.module, 'subprocess'):
            builder = patch.object(self.module.subprocess, 'run', self.adapter.build)
            builder.start()
            self.addCleanup(builder.stop)

    def test_opted_in_desktop_install_is_receipted_without_restarting_desktop(self):
        path = self.adapter.root / 'desktop-codex'
        original = '#!/node\n// existing desktop adapter\n'
        path.write_text(original); path.chmod(0o700)
        self.adapter.root.chmod(0o700)
        self.adapter.options['gateway_desktop_meter'] = {
            'adapterPath': str(path), 'originalSha256': hashlib.sha256(original.encode()).hexdigest(),
            'nodeExecutable': '/path/to/node', 'codexExecutable': '/path/to/codex',
            'socketPath': str(self.adapter.root / 'codex-home/mobile-model-upload/meter.sock'), 'upstreamUrl': 'ws://127.0.0.1:14550/rpc'}
        put(self.adapter.live / 'gateway-env.json', json.dumps({'CODEX_APP_SERVER_MODE': 'external',
            'CODEX_APP_SERVER_URL': 'ws://127.0.0.1:14550/rpc', 'PORT': '19876', 'CODEX_HOME': str(self.adapter.root / 'codex-home')}))
        self.adapter.http_payload = {'mode': 'external', 'upstreamUrl': 'ws://127.0.0.1:14550/rpc'}
        gateway = self.module.Gateway(self.adapter)
        result = gateway.run()
        self.assertEqual(result['desktopMeter']['activation'], 'requires-user-desktop-restart')
        self.assertTrue(gateway.check()['done'])
        self.assertEqual(path.with_name(path.name + '.pre-model-upload').read_text(), original)
        self.assertIn('runDesktopModelUpload', path.read_text())
        self.assertFalse(any('osascript' in item or 'com.openai.codex' in item for call in self.adapter.calls for item in call))
        path.write_text('drift')
        self.assertFalse(gateway.check()['done'])

    def test_desktop_socket_must_match_gateway_default_source_path(self):
        path = self.adapter.root / 'desktop-codex'; path.write_text('original'); path.chmod(0o700)
        self.adapter.root.chmod(0o700)
        self.adapter.options['gateway_desktop_meter'] = {
            'adapterPath': str(path), 'originalSha256': hashlib.sha256(b'original').hexdigest(),
            'nodeExecutable': '/path/to/node', 'codexExecutable': '/path/to/codex',
            'socketPath': str(self.adapter.root / 'wrong/meter.sock'), 'upstreamUrl': 'ws://127.0.0.1:14550/rpc'}
        put(self.adapter.live / 'gateway-env.json', json.dumps({'CODEX_APP_SERVER_MODE': 'external',
            'CODEX_APP_SERVER_URL': 'ws://127.0.0.1:14550/rpc', 'CODEX_HOME': str(self.adapter.root / 'codex-home')}))
        gateway = self.module.Gateway(self.adapter)
        with self.assertRaisesRegex(RuntimeError, 'socket'):
            gateway.run()
        self.assertEqual(path.read_text(), 'original')

    def test_server_only_deploy_preserves_frontend_dependencies_and_startup(self):
        self.assertFalse(self.gateway.check()['done'])
        self.gateway.run()
        result = self.gateway.check()
        self.assertTrue(result['done'], result)
        self.assertEqual(self.adapter.package.joinpath('dist/index.html').read_text(), 'existing frontend')
        self.assertEqual(self.adapter.package.joinpath('npm-dist/server/index.js').read_text(), 'new server')
        self.assertEqual(self.adapter.package.joinpath('bin/access-url.mjs').read_text(), 'new helper')
        self.assertEqual(self.adapter.package.joinpath('node_modules/nested/index.js').read_text(), 'nested dependency')
        self.assertEqual(self.adapter.live.joinpath('node_modules/ws/index.js').read_text(), 'keep dependency')
        self.assertEqual(self.adapter.live.joinpath('start.py').read_text(), 'existing start script')
        self.assertEqual(self.adapter.count(['npm', 'run', 'build:server']), 1)
        self.assertEqual(self.adapter.count(['launchctl', 'kickstart']), 1)
        receipt = result['result']
        self.assertEqual(receipt['sha'], 'a' * 40)
        self.assertEqual(receipt['batchId'], 'batch-1')
        self.assertEqual(receipt['pid'], 101)
        self.assertIn('frontendDigest', receipt)
        snapshot = self.adapter.root / 'gateway-backup/package'
        self.assertEqual(snapshot.joinpath('npm-dist/server/index.js').read_text(), 'old server')
        # 重复执行既不构建也不重启，完成不能只依赖持久化的 receipt。
        self.gateway.run()
        self.assertEqual(self.adapter.count(['npm', 'run', 'build:server']), 1)
        self.assertEqual(self.adapter.count(['launchctl', 'kickstart']), 1)

    def test_restart_response_loss_reconciles_actual_process_without_second_restart(self):
        self.adapter.loss = True
        try:
            self.gateway.run()
        except RuntimeError:
            pass
        self.adapter.loss = False
        fresh = self.module.Gateway(self.adapter)
        self.assertTrue(fresh.check()['done'])
        fresh.run()
        self.assertEqual(self.adapter.count(['launchctl', 'kickstart']), 1)

    def test_install_completed_without_restart_resumes_only_restart(self):
        self.adapter.fail_before_restart = True
        with self.assertRaisesRegex(RuntimeError, 'interrupted after install'):
            self.gateway.run()
        self.assertFalse(self.gateway.check()['done'])
        self.assertEqual(self.adapter.count(['launchctl', 'kickstart']), 0)
        self.adapter.fail_before_restart = False
        self.module.Gateway(self.adapter).run()
        self.assertTrue(self.gateway.check()['done'])
        self.assertEqual(self.adapter.count(['npm', 'run', 'build:server']), 1)
        self.assertEqual(self.adapter.count(['launchctl', 'kickstart']), 1)

    def test_wrong_sha_marker_is_repaired_and_restarted(self):
        self.gateway.run()
        marker = self.adapter.package / '.codex-mobile-deployment.json'
        data = json.loads(marker.read_text())
        data['sha'] = 'b' * 40
        marker.write_text(json.dumps(data))
        self.assertFalse(self.gateway.check()['done'])
        self.module.Gateway(self.adapter).run()
        self.assertTrue(self.gateway.check()['done'])
        self.assertEqual(self.adapter.count(['npm', 'run', 'build:server']), 1)
        self.assertEqual(self.adapter.count(['launchctl', 'kickstart']), 2)

    def test_server_dist_and_entry_tampering_invalidates_real_deployment(self):
        for relative in ('npm-dist/server/index.js', 'dist/index.html', 'bin/codex-mobile.mjs'):
            with self.subTest(relative=relative):
                self.gateway.run()
                put(self.adapter.package / relative, 'unexpected modification')
                self.assertFalse(self.gateway.check()['done'])
                self.gateway.run()
                self.assertTrue(self.gateway.check()['done'])

    def test_matching_receipt_cannot_hide_wrong_process_or_unhealthy_status(self):
        self.gateway.run()
        self.adapter.bad_command = True
        self.assertFalse(self.gateway.check()['done'])
        self.adapter.bad_command = False
        self.adapter.http_payload = {'mode': 'external', 'upstreamUrl': 'ws://elsewhere:1'}
        self.assertFalse(self.gateway.check()['done'])

    def test_http_auth_uses_private_cookie_without_secret_in_commands_or_receipts(self):
        self.gateway.run()
        request = self.adapter.requests[-1]
        self.assertEqual(request.full_url, 'http://127.0.0.1:19876/api/status')
        self.assertEqual(request.get_header('Cookie'), 'codex_mobile_token=private%20token')
        self.assertNotIn('private token', json.dumps(self.adapter.calls))
        self.assertNotIn('private token', json.dumps(self.adapter.events))
        self.assertNotIn('private token', self.adapter.root.joinpath('gateway-progress.json').read_text())

    def test_pid_changed_during_install_still_requires_post_install_restart(self):
        self.adapter.drift_on_install = True
        self.gateway.run()
        self.assertEqual(self.adapter.count(['launchctl', 'kickstart']), 1)
        self.assertEqual(self.gateway.check()['result']['pid'], 102)

    def test_stale_server_build_files_are_removed_before_frozen_build(self):
        put(self.adapter.work / 'npm-dist/server/deleted-module.js', 'stale prior build')
        self.gateway.run()
        self.assertFalse(self.adapter.package.joinpath('npm-dist/server/deleted-module.js').exists())

    def test_dirty_frozen_source_is_rejected_before_build_or_install(self):
        self.adapter.dirty_work = True
        with self.assertRaisesRegex(RuntimeError, '冻结|worktree'):
            self.gateway.run()
        self.assertEqual(self.adapter.count(['npm', 'run', 'build:server']), 0)
        self.assertEqual(self.adapter.count(['launchctl', 'kickstart']), 0)

    def test_health_endpoint_must_be_owned_by_verified_launchd_process(self):
        self.gateway.run()
        self.adapter.listener_matches = False
        self.assertFalse(self.gateway.check()['done'])

    def test_restart_request_not_performed_can_retry_same_intent(self):
        self.adapter.loss_before_restart = True
        with self.assertRaisesRegex(RuntimeError, 'not performed'):
            self.gateway.run()
        self.assertFalse(self.gateway.check()['done'])
        self.adapter.loss_before_restart = False
        self.module.Gateway(self.adapter).run()
        self.assertTrue(self.gateway.check()['done'])
        self.assertEqual(self.adapter.count(['launchctl', 'kickstart']), 2)
        self.assertEqual(self.adapter.count(['npm', 'run', 'build:server']), 1)

    def test_restarted_process_waiting_for_health_is_not_restarted_again(self):
        self.adapter.http_payload = {'mode': 'wrong', 'upstreamUrl': 'invalid'}
        with self.assertRaisesRegex(RuntimeError, '验收'):
            self.gateway.run()
        self.adapter.http_payload = {'mode': 'managed', 'upstreamUrl': 'ws://127.0.0.1:18765'}
        self.module.Gateway(self.adapter).run()
        self.assertEqual(self.adapter.count(['launchctl', 'kickstart']), 1)
        self.assertTrue(self.gateway.check()['done'])

    def test_existing_dependency_declaration_change_stops_before_build(self):
        manifest = json.loads(self.adapter.work.joinpath('package.json').read_text())
        manifest['dependencies']['new-module'] = '^1'
        put(self.adapter.work / 'package.json', json.dumps(manifest))
        with self.assertRaisesRegex(RuntimeError, '依赖'):
            self.gateway.run()
        self.assertEqual(self.adapter.count(['npm', 'run', 'build:server']), 0)
        self.assertEqual(self.adapter.count(['launchctl', 'kickstart']), 0)

    def test_completed_install_reconciles_without_remaining_build_stage(self):
        self.gateway.run()
        shutil.rmtree(self.adapter.root / 'gateway-stage')
        self.adapter.root.joinpath('gateway-package.tgz').unlink()
        self.module.Gateway(self.adapter).run()
        self.assertTrue(self.gateway.check()['done'])
        self.assertEqual(self.adapter.count(['npm', 'run', 'build:server']), 1)
        self.assertEqual(self.adapter.count(['launchctl', 'kickstart']), 1)

    def test_unobservable_launchd_state_does_not_trigger_duplicate_restart(self):
        self.gateway.run()
        self.adapter.query_error = True
        self.assertFalse(self.gateway.check()['done'])
        with self.assertRaisesRegex(RuntimeError, 'launchd|网关'):
            self.module.Gateway(self.adapter).run()
        self.assertEqual(self.adapter.count(['launchctl', 'kickstart']), 1)
        self.adapter.query_error = False
        self.assertTrue(self.gateway.check()['done'])

    def test_successful_build_survives_backup_failure_without_rebuilding(self):
        with patch.object(self.module.shutil, 'copytree', side_effect=RuntimeError('backup interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'backup interrupted'):
                self.gateway._prepare()
        self.assertTrue(self.adapter.root.joinpath('gateway-build.json').exists())
        self.module.Gateway(self.adapter)._prepare()
        self.assertEqual(self.adapter.count(['npm', 'run', 'build:server']), 1)

    def test_successful_build_survives_pack_failure_without_rebuilding(self):
        with patch.object(self.module.tarfile, 'open', side_effect=RuntimeError('pack interrupted')):
            with self.assertRaisesRegex(RuntimeError, 'pack interrupted'):
                self.gateway._prepare()
        self.assertTrue(self.adapter.root.joinpath('gateway-build.json').exists())
        self.module.Gateway(self.adapter)._prepare()
        self.assertEqual(self.adapter.count(['npm', 'run', 'build:server']), 1)

    def test_child_completed_build_checkpoint_survives_lost_adapter_response(self):
        self.adapter.build_response_loss = True
        with self.assertRaisesRegex(RuntimeError, 'build response lost'):
            self.gateway._prepare()
        checkpoint = json.loads(self.adapter.root.joinpath('gateway-build.json').read_text())
        self.assertEqual(checkpoint['status'], 'success')
        self.assertEqual(checkpoint['exitCode'], 0)
        self.assertEqual(checkpoint['identity']['sha'], 'a' * 40)
        self.assertIn('sourceFingerprint', checkpoint)
        self.assertIn('serverDigest', checkpoint)
        self.assertIn('logSha256', checkpoint)
        self.adapter.build_response_loss = False
        self.module.Gateway(self.adapter)._prepare()
        self.assertEqual(self.adapter.count(['npm', 'run', 'build:server']), 1)

    def test_successful_build_checkpoint_rejects_fingerprint_output_or_log_tampering(self):
        for mutation in ('fingerprint', 'output', 'log'):
            with self.subTest(mutation=mutation):
                with patch.object(self.module.tarfile, 'open', side_effect=RuntimeError('pack interrupted')):
                    with self.assertRaises(RuntimeError):
                        self.gateway._prepare()
                checkpoint = self.adapter.root / 'gateway-build.json'
                self.assertTrue(checkpoint.exists())
                original_checkpoint = checkpoint.read_text()
                if mutation == 'fingerprint':
                    record = json.loads(original_checkpoint)
                    record['sourceFingerprint'] = 'wrong fingerprint'
                    checkpoint.write_text(json.dumps(record))
                elif mutation == 'output':
                    put(self.adapter.work / 'npm-dist/server/index.js', 'tampered compiler output')
                else:
                    put(self.adapter.root / 'gateway-build.log', 'tampered build log')
                with self.assertRaisesRegex(RuntimeError, '构建|checkpoint|摘要|指纹'):
                    self.module.Gateway(self.adapter)._prepare()
                self.assertEqual(self.adapter.count(['npm', 'run', 'build:server']), 1)
                checkpoint.write_text(original_checkpoint)
                put(self.adapter.work / 'npm-dist/server/index.js', 'new server')
                put(self.adapter.root / 'gateway-build.log', '> codex-mobile build:server\n> tsc -p tsconfig.npm.json\n')

    def test_unfinished_wrong_source_checkpoint_clears_output_and_builds(self):
        put(self.adapter.root / 'gateway-build.json', json.dumps({'status': 'running', 'sourceFingerprint': 'wrong'}))
        put(self.adapter.work / 'npm-dist/server/stale.js', 'incomplete output')
        self.gateway._prepare()
        self.assertFalse(self.adapter.work.joinpath('npm-dist/server/stale.js').exists())
        checkpoint = json.loads(self.adapter.root.joinpath('gateway-build.json').read_text())
        self.assertEqual(checkpoint['status'], 'success')
        self.assertEqual(self.adapter.count(['npm', 'run', 'build:server']), 1)

    def test_failed_compiler_checkpoint_rebuilds_cleanly_and_preserves_log(self):
        self.adapter.build_exit_code = 2
        with self.assertRaisesRegex(RuntimeError, '构建失败'):
            self.gateway._prepare()
        checkpoint = json.loads(self.adapter.root.joinpath('gateway-build.json').read_text())
        self.assertEqual(checkpoint['status'], 'failed')
        self.assertEqual(checkpoint['exitCode'], 2)
        self.assertIn('tsc -p tsconfig.npm.json', self.adapter.root.joinpath('gateway-build.log').read_text())
        put(self.adapter.work / 'npm-dist/server/stale.js', 'partial compile output')
        self.adapter.build_exit_code = 0
        self.module.Gateway(self.adapter)._prepare()
        self.assertFalse(self.adapter.work.joinpath('npm-dist/server/stale.js').exists())
        self.assertEqual(self.adapter.count(['npm', 'run', 'build:server']), 2)

    def test_output_modified_between_build_and_snapshot_is_not_packaged(self):
        real_copy = self.module.shutil.copytree
        def mutate_then_copy(source, destination, *args, **kwargs):
            if pathlib.Path(source).resolve() == self.adapter.package.resolve():
                put(self.adapter.work / 'npm-dist/server/index.js', 'wrong output after successful build')
            return real_copy(source, destination, *args, **kwargs)
        with patch.object(self.module.shutil, 'copytree', side_effect=mutate_then_copy):
            with self.assertRaisesRegex(RuntimeError, '构建|摘要|指纹'):
                self.gateway._prepare()
        self.assertFalse(self.adapter.root.joinpath('gateway-progress.json').exists())
        self.assertEqual(self.adapter.count(['npm', 'run', 'build:server']), 1)

    def test_health_probe_uses_configured_lan_host_and_preserves_private_auth(self):
        environment = json.loads(self.adapter.live.joinpath('gateway-env.json').read_text())
        environment.update(HOST='192.168.123.79', CODEX_APP_SERVER_MODE='external',
                           CODEX_APP_SERVER_URL='ws://127.0.0.1:14550')
        put(self.adapter.live / 'gateway-env.json', json.dumps(environment))
        self.adapter.http_payload = {'mode': 'external', 'upstreamUrl': 'ws://127.0.0.1:14550'}
        self.gateway.run()
        request = self.adapter.requests[-1]
        self.assertEqual(request.full_url, 'http://192.168.123.79:19876/api/status')
        self.assertEqual(request.get_header('Cookie'), 'codex_mobile_token=private%20token')
        self.assertNotIn('private token', request.full_url)
        self.assertNotIn('private token', json.dumps(self.adapter.calls))
        self.assertNotIn('private token', json.dumps(self.adapter.events))
        self.assertNotIn('private token', self.adapter.root.joinpath('gateway-progress.json').read_text())
        self.assertTrue(self.gateway.check()['done'])

    def test_health_probe_maps_wildcards_and_formats_ipv6_and_hostname(self):
        environment = json.loads(self.adapter.live.joinpath('gateway-env.json').read_text())
        for configured, authority in (('', '127.0.0.1'), ('0.0.0.0', '127.0.0.1'),
                                      ('::', '[::1]'), ('::1', '[::1]'),
                                      ('2001:db8::79', '[2001:db8::79]'), ('gateway.local', 'gateway.local')):
            with self.subTest(host=configured):
                environment['HOST'] = configured
                put(self.adapter.live / 'gateway-env.json', json.dumps(environment))
                self.assertTrue(self.gateway._healthy(self.adapter.pid))
                self.assertEqual(self.adapter.requests[-1].full_url, f'http://{authority}:19876/api/status')
                self.assertIn(['lsof', '-nP', '-a', '-p', str(self.adapter.pid),
                               '-iTCP:19876', '-sTCP:LISTEN', '-t'], self.adapter.calls)

    def test_health_probe_disables_environment_proxies(self):
        with patch.dict(self.module.os.environ, {'HTTP_PROXY': 'http://external.proxy:8888',
                                                'http_proxy': 'http://external.proxy:8888'}):
            self.assertTrue(self.gateway._healthy(self.adapter.pid))
        self.assertEqual(len(self.adapter.proxy_handlers), 1)
        self.assertIsInstance(self.adapter.proxy_handlers[0], self.module.urllib.request.ProxyHandler)
        self.assertEqual(self.adapter.proxy_handlers[0].proxies, {})

    def test_tampered_persistent_stage_is_not_used_as_build_source(self):
        self.adapter.fail_before_restart = True
        with self.assertRaises(RuntimeError):
            self.gateway.run()
        put(self.adapter.root / 'gateway-stage/package/npm-dist/server/index.js', 'wrong build')
        self.adapter.fail_before_restart = False
        with self.assertRaisesRegex(RuntimeError, 'stage|阶段|暂存'):
            self.module.Gateway(self.adapter).run()
        self.assertEqual(self.adapter.count(['launchctl', 'kickstart']), 0)


if __name__ == '__main__':
    unittest.main()
