"""冻结批次只读故障协议、等待预算与部分下载恢复；不访问生产状态。"""
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
from types import SimpleNamespace
import unittest
from unittest.mock import patch

import test_release_adapter as fixtures


class ReleaseReadRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.fixture = fixtures.ReleaseAdapterTests()
        self.m = self.fixture.load()
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.base = Path(self.temporary.name)
        self.context = self.fixture.context(self.base)
        self.a = self.m.Adapter(self.context)

    def reply(self, code=1, error='Get API: EOF', output=''):
        return SimpleNamespace(returncode=code, stderr=error, stdout=output)

    def test_github_network_exhaustion_is_typed_and_bounded(self):
        for error in ['EOF', 'dial tcp: connection reset by peer', 'Temporary failure in name resolution', 'HTTP 408', 'HTTP 429', 'HTTP 501', 'HTTP 503']:
            with self.subTest(error=error), patch.object(self.m.subprocess, 'run', return_value=self.reply(error=error)) as run, patch.object(self.m.time, 'sleep'):
                with self.assertRaises(self.m.TransientReadError): self.a.gh_json('test/read')
                self.assertEqual(run.call_count, 4)

    def test_github_timeout_and_incomplete_json_are_typed(self):
        for failure in [subprocess.TimeoutExpired('gh', 45), self.reply(0, '', '{"workflow_runs":')]:
            with self.subTest(failure=type(failure).__name__), patch.object(self.m.subprocess, 'run', side_effect=failure if isinstance(failure, Exception) else None, return_value=failure) as run, patch.object(self.m.time, 'sleep'):
                with self.assertRaises(self.m.TransientReadError): self.a.gh_json('test/read')
                self.assertEqual(run.call_count, 4)

    def test_authentication_and_invalid_json_are_permanent(self):
        for reply in [self.reply(error='HTTP 401: unauthorized EOF'), self.reply(error='HTTP 403: forbidden'), self.reply(error='x509: certificate signed by unknown authority EOF'), self.reply(0, '', '<html>login</html>')]:
            with self.subTest(error=reply.stderr), patch.object(self.m.subprocess, 'run', return_value=reply) as run, patch.object(self.m.time, 'sleep'):
                with self.assertRaises(RuntimeError) as caught: self.a.gh_json('test/read')
                self.assertNotIsInstance(caught.exception, self.m.TransientReadError)
                self.assertEqual(run.call_count, 1)

    def test_http_transport_and_transient_status_exhaustion_are_typed(self):
        for reply in [self.reply(6, 'Could not resolve host'), self.reply(28, 'Operation timed out'), self.reply(56, 'Recv failure: Connection reset'), self.reply(0, '', 'busy\n429'), self.reply(0, '', 'busy\n507')]:
            for method in ['GET', 'HEAD']:
                with self.subTest(code=reply.returncode, method=method), patch.object(self.m.subprocess, 'run', return_value=reply) as run, patch.object(self.m.time, 'sleep'):
                    with self.assertRaises(self.m.TransientReadError): self.a.request('https://read.test/?token=PRIVATE', method)
                    self.assertEqual(run.call_count, 4)

    def test_http_local_tls_and_authorization_failures_are_not_retryable(self):
        for reply in [self.reply(23, 'Failed writing received data'), self.reply(60, 'SSL certificate problem'), self.reply(3, 'URL rejected'), self.reply(56, 'EOF', '\n403'), self.reply(0, '', 'denied\n401'), self.reply(0, '', 'denied\n403')]:
            with self.subTest(code=reply.returncode, output=reply.stdout), patch.object(self.m.subprocess, 'run', return_value=reply) as run, patch.object(self.m.time, 'sleep'):
                with self.assertRaises(RuntimeError) as caught: self.a.request('https://read.test')
                self.assertNotIsInstance(caught.exception, self.m.TransientReadError)
                self.assertEqual(run.call_count, 1)

    def test_post_never_retries_or_becomes_retryable(self):
        for reply in [self.reply(56, 'connection EOF'), self.reply(0, '', 'busy\n503'), self.reply(0, '', 'missing\n404')]:
            with self.subTest(code=reply.returncode), patch.object(self.m.subprocess, 'run', return_value=reply) as run, patch.object(self.m.time, 'sleep'):
                with self.assertRaises(RuntimeError) as caught: self.a.request('https://write.test', 'POST', data={})
                self.assertNotIsInstance(caught.exception, self.m.TransientReadError)
                self.assertEqual(run.call_count, 1)

    def test_readonly_command_network_errors_are_typed_but_writes_are_not(self):
        for args in [['gh', 'run', 'download', '123'], ['git', 'ls-remote', 'origin'], ['git', 'fetch', 'origin'], ['curl', '-fsSL', 'https://read.test']]:
            with self.subTest(args=args), patch.object(self.m.subprocess, 'run', return_value=self.reply(56, 'connection reset by peer')):
                with self.assertRaises(self.m.TransientReadError): self.a.command(args, read_only=True)
        with patch.object(self.m.subprocess, 'run', return_value=self.reply(1, 'connection reset by peer')):
            with self.assertRaises(RuntimeError) as caught: self.a.command(['git', 'push', 'origin', 'main'])
            self.assertNotIsInstance(caught.exception, self.m.TransientReadError)

    def test_readonly_download_local_write_and_tls_errors_are_permanent(self):
        for code in [23, 60]:
            with self.subTest(code=code), patch.object(self.m.subprocess, 'run', return_value=self.reply(code, 'connection EOF')):
                with self.assertRaises(RuntimeError) as caught: self.a.command(['curl', '-fsSL', 'https://read.test'], read_only=True)
                self.assertNotIsInstance(caught.exception, self.m.TransientReadError)

    def test_main_remote_queries_are_explicitly_readonly(self):
        calls = []
        def command(args, **kwargs):
            calls.append((args, kwargs))
            return 'c' * 40 + '\trefs/heads/main' if args[1] == 'ls-remote' else ''
        with patch.object(self.a, 'command', side_effect=command), patch.object(self.m.subprocess, 'run', return_value=self.reply(0, '', '')):
            self.a.main_check()
        self.assertEqual([call[0][1] for call in calls], ['ls-remote', 'fetch'])
        self.assertTrue(all(call[1].get('read_only') for call in calls))

    def test_cli_check_and_run_emit_only_exact_retryable_protocol(self):
        context = self.base / 'context.json'; context.write_text(json.dumps(self.context))
        for action in ['check', 'run']:
            program = '''import sys
sys.path.insert(0, sys.argv[1])
import codex_mobile_release_adapter as m
m.Adapter.assert_frozen=lambda self: None
def fail(*args): raise m.TransientReadError('EOF https://read.test/?token=PRIVATE_TOKEN -----BEGIN PRIVATE KEY-----\\nPRIVATE_KEY\\n-----END PRIVATE KEY-----')
m.Adapter.check_phase=fail
m.Adapter.run_phase=fail
sys.argv=['adapter',sys.argv[2],'build','--context',sys.argv[3]]
m.main()
'''
            result = subprocess.run([sys.executable, '-B', '-c', program, str(fixtures.ROOT / 'scripts'), action, str(context)], text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            payload = json.loads(result.stdout)
            self.assertEqual(set(payload), {'done', 'retryable'})
            self.assertIs(payload['done'], False)
            self.assertEqual(set(payload['retryable']), {'kind', 'reason'})
            self.assertEqual(payload['retryable']['kind'], 'transient-read')
            self.assertTrue(payload['retryable']['reason'].strip())
            self.assertEqual(len(result.stdout.splitlines()), 1)
            self.assertNotIn('PRIVATE_TOKEN', result.stdout + result.stderr)
            self.assertNotIn('PRIVATE_KEY', result.stdout + result.stderr)

    def test_prepare_remains_nonzero_and_no_retryable_stdout(self):
        with patch.object(self.m.Adapter, 'prepare', side_effect=self.m.TransientReadError('EOF')), patch.object(sys, 'argv', ['adapter', 'run', 'prepare', '--context', str(self.base / 'context.json')]), patch.object(self.m, 'read_json', return_value=self.context), patch('sys.stdout', new_callable=io.StringIO) as output:
            with self.assertRaises(self.m.TransientReadError): self.m.main()
        self.assertEqual(output.getvalue(), '')

    def test_ci_failure_and_integrity_mismatch_remain_permanent(self):
        for status in ['failure', 'cancelled', 'timed_out']:
            with self.subTest(status=status), patch.object(self.a, 'ci_run', return_value={'id':123, 'status':'completed', 'conclusion':status, 'run_attempt':1}):
                with self.assertRaises(ValueError): self.a.run_build()
        self.a.progress('build', runId=123, attempt=1)
        bad = self.seed(self.a.root / 'ci-partials/android', 'android'); Path(bad['path']).write_bytes(b'changed')
        with patch.object(self.a, 'ci_run', return_value=self.completed()), patch.object(self.a, 'command') as download:
            with self.assertRaisesRegex(ValueError, '损坏|散列'): self.a.run_build()
            download.assert_not_called()

    def test_wait_deadline_survives_new_adapter_and_still_queries_after_expiry(self):
        with patch.object(self.m.time, 'time', return_value=1000), patch.object(self.a, 'ci_run', side_effect=self.m.TransientReadError('EOF')):
            with self.assertRaises(self.m.TransientReadError): self.a.run_build()
        operation = self.a.read_progress()['operations']['build']
        self.assertEqual(operation['waitStartedAt'], 1000)
        self.assertEqual(operation['waitDeadlineAt'], 4600)
        resumed = self.m.Adapter(self.context)
        with patch.object(self.m.time, 'time', return_value=5000), patch.object(resumed, 'ci_run', return_value={'id':123,'status':'in_progress','run_attempt':1}) as query:
            with self.assertRaises(TimeoutError): resumed.run_build()
            query.assert_called_once()
        with patch.object(self.m.time, 'time', return_value=5000), patch.object(resumed, 'ci_run', return_value=self.completed()) as query, patch.object(resumed, 'build_artifacts', return_value={'verified':True}):
            resumed.run_build(); query.assert_called_once()
        self.assertEqual(resumed.read_progress()['operations']['build']['waitDeadlineAt'], 4600)

    def test_existing_partial_is_reused_across_transient_download_and_restart(self):
        self.a.progress('build', runId=123, attempt=1)
        self.seed(self.a.root / 'ci-partials/android', 'android')
        with patch.object(self.a, 'ci_run', return_value=self.completed()), patch.object(self.a, 'command', side_effect=self.m.TransientReadError('EOF')):
            with self.assertRaises(self.m.TransientReadError): self.a.run_build()
        resumed = self.m.Adapter(self.context); downloads = []
        def download(args, **kwargs):
            self.assertIs(kwargs.get('read_only'), True)
            platform = args[args.index('--name') + 1].removeprefix('codex-mobile-'); downloads.append(platform)
            self.seed(Path(args[args.index('--dir') + 1]), platform)
        with patch.object(resumed, 'ci_run', return_value=self.completed()), patch.object(resumed, 'command', side_effect=download): resumed.run_build()
        self.assertEqual(downloads, ['ios'])
        self.assertIsNotNone(resumed.build_artifacts())
        self.assertEqual(resumed.read_progress()['operations']['build']['runId'], 123)
        self.assertEqual(resumed.read_progress()['operations']['build']['attempt'], 1)

    def test_recorded_run_attempt_cannot_be_replaced(self):
        self.a.progress('build', runId=123, attempt=1)
        run = {**self.completed(), 'head_sha':self.a.frozen_sha, 'run_attempt':2}
        with patch.object(self.a, 'gh_json', return_value={'workflow_runs':[run]}):
            with self.assertRaisesRegex(ValueError, 'attempt|运行'): self.a.ci_run()

    def test_download_verified_network_failure_is_typed_and_integrity_failure_is_not(self):
        expected = {'size':3, 'sha256':'c'*64}
        output = self.a.root / 'verified.ipa'
        with patch.object(self.a, 'request', return_value='content-length: 3'), patch.object(self.m.subprocess, 'run', return_value=self.reply(56, 'EOF')):
            with self.assertRaises(self.m.TransientReadError): self.a.download_verified('https://read.test/?token=PRIVATE', expected, output)
        self.assertFalse(output.exists())
        def damaged(args, **kwargs):
            self.assertIs(kwargs.get('read_only'), True)
            Path(args[args.index('--output')+1]).write_bytes(b'bad')
        with patch.object(self.a, 'request', return_value='content-length: 3'), patch.object(self.a, 'command', side_effect=damaged):
            with self.assertRaisesRegex(ValueError, 'SHA-256'): self.a.download_verified('https://read.test', expected, output)
        self.assertFalse(output.exists())

    def test_interrupted_candidate_with_wrong_source_is_not_silently_redownloaded(self):
        self.a.progress('build', runId=123, attempt=1)
        folder = self.a.root / 'download-android-existing'
        self.seed(folder, 'android')
        receipt = self.m.read_json(folder / 'android-build.json'); receipt['sourceCommit'] = 'a'*40
        self.m.atomic_json(folder / 'android-build.json', receipt)
        self.m.atomic_json(self.a.root / 'download-android.json', {'candidate':str(folder),'runId':123,'attempt':1})
        with patch.object(self.a, 'ci_run', return_value=self.completed()), patch.object(self.a, 'command') as download:
            with self.assertRaisesRegex(ValueError, 'sourceCommit'): self.a.run_build()
            download.assert_not_called()

    def test_http_incomplete_json_is_typed_only_for_reads(self):
        for method, count in [('GET', 4), ('POST', 1)]:
            with self.subTest(method=method), patch.object(self.a, 'request', return_value='{"partial":') as request, patch.object(self.m.time, 'sleep'):
                with self.assertRaises(RuntimeError) as caught: self.a.url_json('https://read.test', method=method)
                self.assertEqual(isinstance(caught.exception, self.m.TransientReadError), method == 'GET')
                self.assertEqual(request.call_count, count)

    def test_readonly_marker_cannot_authorize_network_write_commands(self):
        for args in [['git','push','origin','main'], ['gh','api','--method','POST','test'], ['curl','--request','POST','https://write.test'], ['curl','-dsecret','https://write.test']]:
            with self.subTest(args=args), patch.object(self.m.subprocess, 'run') as run:
                with self.assertRaises(ValueError): self.a.command(args, read_only=True)
                run.assert_not_called()

    def test_build_check_persists_budget_before_network_query(self):
        with patch.object(self.m.time, 'time', return_value=2000), patch.object(self.a, 'ci_run', side_effect=self.m.TransientReadError('EOF')):
            with self.assertRaises(self.m.TransientReadError): self.a.build_check()
        self.assertEqual(self.a.read_progress()['operations']['build']['waitDeadlineAt'], 5600)

    def test_write_failure_is_not_reclassified_by_failed_read_reconciliation(self):
        with patch.object(self.a, 'check_phase', side_effect=[{'done':False}, self.m.TransientReadError('EOF')]), patch.object(self.a, 'execute_phase', side_effect=RuntimeError('publication response lost')):
            with self.assertRaises(RuntimeError) as caught: self.a.run_phase('ipa')
        self.assertNotIsInstance(caught.exception, self.m.TransientReadError)
        self.assertEqual(str(caught.exception), 'publication response lost')

    def test_interrupted_candidate_payload_truncation_redownloads_only_missing_platform(self):
        for state in [None, 'interrupted']:
            with self.subTest(state=state), tempfile.TemporaryDirectory() as temporary:
                adapter = self.m.Adapter(self.fixture.context(Path(temporary)))
                adapter.progress('build', runId=123, attempt=1)
                self.seed(adapter.root / 'ci-partials/android', 'android')
                candidate = adapter.root / 'download-ios-interrupted'
                item = self.seed(candidate, 'ios'); Path(item['path']).write_bytes(b'i')
                intent = {'candidate':str(candidate),'runId':123,'attempt':1}
                if state: intent['downloadState'] = state
                self.m.atomic_json(adapter.root / 'download-ios.json', intent)
                downloads = []
                def download(args, **kwargs):
                    platform = args[args.index('--name')+1].removeprefix('codex-mobile-'); downloads.append(platform)
                    self.seed(Path(args[args.index('--dir')+1]), platform)
                with patch.object(adapter, 'ci_run', return_value=self.completed()), patch.object(adapter, 'command', side_effect=download): adapter.run_build()
                self.assertEqual(downloads, ['ios']); self.assertIsNotNone(adapter.build_artifacts())
                self.assertEqual(Path(item['path']).read_bytes(), b'i', '中断候选保留诊断，不覆盖原半包')

    def test_successfully_returned_download_integrity_error_is_permanent_on_restart(self):
        self.a.progress('build', runId=123, attempt=1)
        self.seed(self.a.root / 'ci-partials/android', 'android')
        def download(args, **kwargs):
            candidate = Path(args[args.index('--dir')+1]); item = self.seed(candidate, 'ios')
            Path(item['path']).write_bytes(b'i')
        with patch.object(self.a, 'ci_run', return_value=self.completed()), patch.object(self.a, 'command', side_effect=download):
            with self.assertRaisesRegex(ValueError, '损坏|散列'): self.a.run_build()
        self.assertEqual(self.m.read_json(self.a.root / 'download-ios.json')['downloadState'], 'downloaded')
        resumed = self.m.Adapter(self.context)
        with patch.object(resumed, 'ci_run', return_value=self.completed()), patch.object(resumed, 'command') as second_download:
            with self.assertRaisesRegex(ValueError, '损坏|散列'): resumed.run_build()
            second_download.assert_not_called()

    def test_readonly_subprocess_timeout_is_bounded_and_writes_keep_original_semantics(self):
        for args in [['gh','run','download','123'], ['git','fetch','origin']]:
            with self.subTest(args=args), patch.object(self.m.subprocess, 'run', side_effect=subprocess.TimeoutExpired(args, 180)) as run:
                with self.assertRaises(self.m.TransientReadError): self.a.command(args, read_only=True)
                self.assertEqual(run.call_args.kwargs['timeout'], 180)
        with patch.object(self.m.subprocess, 'run', side_effect=subprocess.TimeoutExpired('git push', 9)) as run:
            with self.assertRaises(subprocess.TimeoutExpired): self.a.command(['git','push','origin','main'])
            self.assertNotIn('timeout', run.call_args.kwargs)

    def test_normal_command_stderr_keeps_complete_multiline_sanitized_diagnostics(self):
        diagnostic = ('compiler diagnostic details\n' * 80) + 'https://read.test/?token=PRIVATE\n'
        with patch.object(self.m.subprocess, 'run', return_value=self.reply(0, diagnostic, 'ok')), patch('sys.stderr', new_callable=io.StringIO) as stderr:
            self.assertEqual(self.a.command(['compiler']), 'ok')
        self.assertEqual(stderr.getvalue().count('compiler diagnostic details\n'), 80)
        self.assertNotIn('PRIVATE', stderr.getvalue())

    def test_protocol_reason_redacts_authorization_headers_and_private_json_values(self):
        for secret in ['Authorization: Bearer AUTH_PRIVATE', '{"token": "JSON_PRIVATE"}', 'Cookie: session=COOKIE_PRIVATE']:
            with self.subTest(secret=secret):
                reason = str(self.m.TransientReadError('EOF ' + secret))
                for value in ['AUTH_PRIVATE', 'JSON_PRIVATE', 'COOKIE_PRIVATE']: self.assertNotIn(value, reason)
                self.assertTrue(reason.strip())

    def completed(self): return {'id':123,'status':'completed','conclusion':'success','run_attempt':1}

    def seed(self, folder, platform):
        folder.mkdir(parents=True, exist_ok=True)
        name = 'CodexMobile-v0.2.164' + ('.apk' if platform == 'android' else '-unsigned.ipa')
        path = folder / name; path.write_bytes(platform.encode())
        value = {'sourceCommit':self.a.frozen_sha,'batchId':'batch-test','version':'0.2.164','buildNumber':'2164','platform':platform,'sha256':self.m.sha256(path),'size':path.stat().st_size,'runId':'123','runAttempt':'1','tasks':[{'id':'task-a','sha':'a'*40}]}
        self.m.atomic_json(folder / (platform + '-build.json'), value)
        return {**value, 'path':str(path)}


if __name__ == '__main__': unittest.main()
