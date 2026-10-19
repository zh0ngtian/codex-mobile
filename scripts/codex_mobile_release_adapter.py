#!/usr/bin/env python3
"""Codex Mobile 的真实阶段适配器；复用发布主机上的 releasectl 服务。"""
import argparse
import contextlib
from email.utils import parsedate_to_datetime
import hashlib
import importlib.util
import json
import math
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import time
import uuid
from urllib.parse import quote
import zipfile

from release_coordination.state import atomic_json, read_json, sha256, reserve_version, version_code

LAN = 'http://192.168.123.79:8765/channels/codex-mobile'


def sanitized_diagnostic(message, *, compact=False):
    text = re.sub(r'-----BEGIN [^-]*PRIVATE KEY-----.*?(?:-----END [^-]*PRIVATE KEY-----|$)', '[已脱敏私钥]', str(message), flags=re.S)
    text = re.sub(r'https?://[^\s<>\"\']+', '[已脱敏地址]', text, flags=re.I)
    text = re.sub(r'(?i)\bBearer\s+\S+', 'Bearer [已脱敏]', text)
    text = re.sub(r'''(?im)\b(?:authorization|cookie)["']?\s*[:=][^\r\n]*''', '[已脱敏凭据]', text)
    text = re.sub(r'''(?i)\b(?:token|password|secret)["']?\s*[:=]\s*(?:"[^"]*"|'[^']*'|[^\s,;]+)''', '[已脱敏凭据]', text)
    return re.sub(r'\s+', ' ', text).strip()[:512] if compact else text


class TransientReadError(RuntimeError):
    """只能证明只读核对暂时不可用，不能证明任何外部写入未发生。"""
    def __init__(self, reason):
        super().__init__(sanitized_diagnostic(reason, compact=True) or '只读网络核对暂时失败，请稍后重试')


class Adapter:
    def __init__(self, context):
        self.context = context
        self.config = context['config']; self.options = self.config['options']
        self.work = Path(context['workspace'])
        self.progress_path = Path(context['progressPath'])
        self.root = self.progress_path.parent.parent / 'artifacts' / 'codex-mobile' / context['id']
        self.root.mkdir(parents=True, exist_ok=True, mode=0o700)
        self.repo = self.options['github_repository']
        self.ota_only = self.options['kind'] == 'mobile-ota'
        self.mobile = self.options['kind'] in ('mobile', 'mobile-ota')
        self.ota_phases = ['main', 'iosbuild', 'sign', 'ota', 'ipa', 'verify']
        if self.ota_only or context['project'] == 'codex-mobile-ios-ota-production':
            if not (self.ota_only and context['project'] == 'codex-mobile-ios-ota-production'
                    and self.config['target'] == 'vip.loock.codexmobile'
                    and self.config['environment'] == 'ota-production'
                    and self.config.get('branch') == 'main'
                    and context['scope'] == 'codex-mobile-main-production'
                    and self.config.get('phases') == self.ota_phases):
                raise ValueError('OTA-only 项目、身份、环境、作用域或发布阶段不匹配')
        self._ios_config = None

    @staticmethod
    def network_read_command(args):
        args = [str(arg) for arg in args]
        executable = Path(args[0]).name
        if executable == 'git': return len(args) > 1 and args[1] in ('ls-remote', 'fetch')
        if executable == 'gh': return args[1:3] == ['run', 'download']
        if executable != 'curl': return False
        for index, argument in enumerate(args[1:], 1):
            if argument.startswith(('--data', '--form', '--upload-file', '--json', '--config', '-d', '-F', '-T', '-K')) or argument == '--next':
                return False
            if argument in ('--request', '-X') and (index + 1 >= len(args) or args[index + 1] not in ('GET', 'HEAD')):
                return False
            if argument.startswith('--request=') and argument.split('=', 1)[1] not in ('GET', 'HEAD'): return False
            if argument.startswith('-X') and argument != '-X' and argument[2:] not in ('GET', 'HEAD'): return False
        return True

    def command(self, args, cwd=None, input=None, *, read_only=False):
        if read_only and not self.network_read_command(args): raise ValueError('只读标记只允许已知网络查询或下载命令')
        try:
            result = subprocess.run([str(arg) for arg in args], cwd=cwd or self.work, input=input,
                                    text=True, capture_output=True, env={**os.environ, 'GIT_TERMINAL_PROMPT': '0'},
                                    **({'timeout': 180} if read_only else {}))
        except subprocess.TimeoutExpired:
            if read_only: raise TransientReadError('只读命令网络超时') from None
            raise
        if result.returncode:
            executable = Path(str(args[0])).name
            if read_only and self.transient_read_error(result.stderr, result.returncode if executable == 'curl' else None):
                raise TransientReadError(executable + ' 只读核对暂时失败（EOF、网络中断或远端繁忙）')
            if result.stderr: print(sanitized_diagnostic(result.stderr), file=sys.stderr, end='')
            raise RuntimeError(f'{executable} exited {result.returncode}')
        if result.stderr: print(sanitized_diagnostic(result.stderr), file=sys.stderr, end='')
        return result.stdout.strip()

    def git(self, *args):
        if args and args[0] in ('ls-remote', 'fetch'):
            return self.command(['git', *args], read_only=True)
        return self.command(['git', *args])

    @staticmethod
    def transient_read_error(message, curl_code=None):
        # 本地写入、证书与鉴权优先于任何模糊的 EOF/connection 字样。
        network_codes = (5, 6, 7, 16, 18, 28, 52, 55, 56, 92, 95)
        if curl_code is not None and curl_code not in (*network_codes, 22): return False
        if re.search(r'HTTP(?:/\d(?:\.\d)?)?\s*[: ]\s*(401|403|404)\b|authentication failed|permission denied|x509:|certificate (?:problem|verify failed|signed by unknown authority|has expired)|SSL certificate|unable to get local issuer|no space left|failed writing|failed to (?:write|save)|invalid configuration', message, re.I):
            return False
        if curl_code in network_codes: return True
        statuses = re.findall(r'(?:HTTP(?:/\d(?:\.\d)?)?\s*[: ]\s*|returned error:\s*)(\d{3})\b', message, re.I)
        if statuses: return any(value in ('408', '429') or value.startswith('5') for value in statuses)
        return bool(re.search(r'\bEOF\b|timed?\s*out|timeout|connection (?:reset|refused|aborted|closed)|empty reply|could not resolve (?:host|proxy)|temporary failure in name resolution|failure when receiving|remote end hung up|early EOF|network is unreachable|no route to host|no such host|context deadline exceeded|unexpected disconnect|closed by remote host|TLS connection was non-properly terminated|curl (?:18|28|52|55|56|92)\b', message, re.I))

    @staticmethod
    def incomplete_json(error):
        document = error.doc.rstrip()
        tail = document[error.pos:]
        return (not document or error.msg.startswith('Unterminated string') or error.pos >= len(document)
                or bool(tail) and any(literal.startswith(tail) for literal in ('true', 'false', 'null')))

    def github_read_cooldown(self):
        not_before = self.read_progress().get('githubReadNotBefore', 0)
        if isinstance(not_before, bool) or not isinstance(not_before, (int, float)) or not math.isfinite(not_before) or not_before < 0:
            raise ValueError('GitHub 读取等待记录无效')
        if time.time() < not_before:
            raise TransientReadError('GitHub 只读限流等待窗口尚未结束')

    def defer_github_rate_limit(self, message):
        now = time.time(); not_before = now + 60
        for hint in re.findall(r"(?im)\bretry[-_]after[\"']?\s*[:=]\s*([^\r\n]+)", message):
            hint = hint.strip().strip('\"\' ,}')
            if hint.isdigit():
                try: candidate = now + int(hint)
                except OverflowError: continue
            else:
                try:
                    date = parsedate_to_datetime(hint)
                    if date.tzinfo is None: continue
                    candidate = date.timestamp()
                except (TypeError, ValueError, OverflowError): continue
            if math.isfinite(candidate): not_before = max(not_before, candidate)
        for reset in re.findall(r"(?i)\b(?:x-ratelimit-reset|reset)[\"']?\s*[:=]\s*[\"']?(\d+)", message):
            try: candidate = float(reset)
            except (ValueError, OverflowError): continue
            if math.isfinite(candidate): not_before = max(not_before, candidate)
        old = self.read_progress()
        atomic_json(self.progress_path, {**old, 'githubReadNotBefore':not_before, 'updatedAt':now})
        raise TransientReadError('GitHub 明确限流，已保存只读等待窗口，请稍后核对')

    def gh_json(self, path, missing=False):
        # 此入口只有 GET；POST 的响应丢失必须由对应阶段独立对账。
        self.github_read_cooldown()
        for attempt in range(4):
            try:
                result = subprocess.run(['gh', 'api', path], cwd=self.work, text=True, capture_output=True, timeout=45)
            except subprocess.TimeoutExpired:
                if attempt == 3: raise TransientReadError('GitHub GET 超时，有限重试已耗尽') from None
                time.sleep(2 ** attempt); continue
            if missing and result.returncode and 'HTTP 404' in result.stderr: return None
            if not result.returncode:
                try: return json.loads(result.stdout)
                except json.JSONDecodeError as error:
                    if not self.incomplete_json(error): raise RuntimeError('GitHub GET 返回无效 JSON') from None
                    message = 'GitHub GET response incomplete EOF'
            else:
                message = result.stderr.strip()
                rate_hint = message + '\n' + result.stdout
                if (re.search(r'HTTP\s*[: ]\s*(403|429)\b', message, re.I)
                        and re.search(r'API rate limit exceeded|secondary rate limit', rate_hint, re.I)):
                    self.defer_github_rate_limit(rate_hint)
            if not self.transient_read_error(message):
                raise RuntimeError('GitHub API 无法核对: ' + sanitized_diagnostic(message))
            if attempt == 3: raise TransientReadError('GitHub GET 暂时失败（EOF、连接中断或远端繁忙），有限重试已耗尽')
            time.sleep(2 ** attempt)

    def request(self, url, method='GET', data=None, headers=None, ca=None):
        # 凭据仅走 stdin，不写进命令参数或诊断。
        config = []
        for key, value in (headers or {}).items():
            if '\n' in value or '\r' in value: raise ValueError('无效 HTTP header')
            config.append('header = ' + json.dumps(key + ': ' + value))
        args = ['curl', '-sS', '-L', '--max-time', '120', '--request', method, '--write-out', '\n%{http_code}', url]
        if ca: args.extend(['--cacert', str(ca)])
        if method == 'HEAD': args.append('--head')
        if headers: args.extend(['--config', '-'])
        if data is not None: args.extend(['--data-binary', json.dumps(data)])
        read_only = method in ('GET', 'HEAD')
        attempts = 4 if read_only else 1
        for attempt in range(attempts):
            try:
                result = subprocess.run(args, text=True, input='\n'.join(config) if headers else None, capture_output=True)
            except subprocess.TimeoutExpired:
                transient = True
                message = 'HTTP 网络超时'
            else:
                if result.returncode:
                    status = result.stdout.rsplit('\n', 1)[-1]
                    permanent_status = bool(re.fullmatch(r'4\d{2}', status)) and status not in ('408', '429')
                    transient = not permanent_status and self.transient_read_error(result.stderr, result.returncode)
                    message = 'HTTP ' + status if permanent_status else 'HTTP 连接失败: curl exited ' + str(result.returncode)
                else:
                    try: body, status = result.stdout.rsplit('\n', 1)
                    except ValueError: body, status = '', ''
                    if status == '404' and read_only: return None
                    if re.fullmatch(r'2\d{2}', status): return body
                    message = 'HTTP ' + status if re.fullmatch(r'\d{3}', status) else 'HTTP 返回状态无效'
                    transient = status in ('408', '429') or bool(re.fullmatch(r'5\d{2}', status))
            if not transient or not read_only: raise RuntimeError(message)
            if attempt == attempts - 1: raise TransientReadError(message + '，只读有限重试已耗尽')
            time.sleep(2 ** attempt)

    def url_json(self, url, **kwargs):
        read_only = kwargs.get('method', 'GET') in ('GET', 'HEAD')
        for attempt in range(4 if read_only else 1):
            body = self.request(url, **kwargs)
            if body is None: return None
            try: return json.loads(body)
            except json.JSONDecodeError as error:
                if not read_only or not self.incomplete_json(error): raise RuntimeError('HTTP 返回无效 JSON') from None
                if attempt == 3: raise TransientReadError('HTTP GET 返回不完整 JSON，有限重试已耗尽') from None
                time.sleep(2 ** attempt)

    def download_verified(self, url, expected, output, ca=None):
        headers = self.request(url, 'HEAD', ca=ca)
        if headers is None: raise ValueError('HEAD 缺少发布产物')
        lengths = re.findall(r'^content-length:\s*(\d+)', headers, re.I | re.M)
        if not lengths or int(lengths[-1]) != expected['size']: raise ValueError('HEAD 文件大小不匹配')
        output = Path(output); output.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
        candidate = output.with_name('.get-' + uuid.uuid4().hex)
        args = ['curl', '-fsSL', '--retry','3','--retry-delay','1','--retry-connrefused', '--max-time', '180', '--output', str(candidate), url]
        if ca: args.extend(['--cacert', str(ca)])
        try:
            self.command(args, read_only=True)
            if candidate.stat().st_size != expected['size'] or sha256(candidate) != expected['sha256']:
                raise ValueError('完整 GET 文件大小或 SHA-256 不匹配')
            os.replace(candidate, output)
        finally: candidate.unlink(missing_ok=True)

    def progress(self, phase, **fields):
        old = self.read_progress(); operations = old.get('operations', {})
        operations[phase] = {**operations.get(phase, {}), **fields, 'updatedAt': time.time()}
        atomic_json(self.progress_path, {**old, **fields, 'phase': phase, 'operations': operations, 'updatedAt': time.time()})

    def read_progress(self): return read_json(self.progress_path) or {}

    @property
    def version(self): return self.context['frozen']['version']
    @property
    def frozen_sha(self): return self.context['frozen']['sha']
    @property
    def build_number(self): return str(self.context['frozen']['buildNumber'])

    def assert_frozen(self):
        if self.git('rev-parse', 'HEAD') != self.frozen_sha: raise ValueError('工作区不在冻结 frozen SHA')
        if self.git('status', '--porcelain'): raise ValueError('冻结工作区被修改')
        path = self.work / '.release-batch.json'; manifest = read_json(path)
        if not manifest or sha256(path) != self.context['frozen']['manifestSha256']: raise ValueError('冻结 manifest 散列改变')
        for key, value in [('batchId', self.context['id']), ('project', self.context['project']),
                           ('scope', self.context['scope']), ('target', self.config['target']), ('environment', self.config['environment'])]:
            if manifest.get(key) != value: raise ValueError('冻结 manifest 不匹配: ' + key)
        if self.git('log', '-1', '--format=%H', '--', '.release-batch.json') != self.frozen_sha:
            raise ValueError('最终 SHA 不是清单引入提交')
        if [{'id':t['id'], 'sha':t['sha']} for t in manifest['tasks']] != self.context['frozen']['tasks']:
            raise ValueError('冻结任务集合改变')
        for task in self.context['tasks']: self.git('merge-base', '--is-ancestor', task['sha'], self.frozen_sha)
        if self.mobile:
            if manifest['prepared']['version'] != self.version or str(manifest['prepared']['buildNumber']) != self.build_number:
                raise ValueError('冻结版本/构建号不匹配')

    def ios_module(self):
        spec = importlib.util.spec_from_file_location('codex_mobile_legacy_release', self.work / 'scripts/release-ios.py')
        module = importlib.util.module_from_spec(spec); spec.loader.exec_module(module)
        return module

    def ios_config(self):
        if self._ios_config is None:
            self._ios_config = self.ios_module().load_config(self.options['ios_config'])
            os.environ['CODEX_MOBILE_OTA_CA_FILE'] = self._ios_config['caFile']
        return self._ios_config

    def signing_preflight(self, cfg, prepared, previous):
        if cfg.get('bundleId') != self.config['target']:
            raise ValueError('本机 Bundle ID 与本批签名身份不一致')
        import ios_sign, ios_ota
        identity=ios_sign.signing_identity(ios_sign.read_profile(cfg['profile']),cfg['bundleId'],cfg['udid'],
                    compatibility_ipa=cfg.get('compatibilityIpa'),compatibility_ipa_sha256=cfg.get('compatibilityIpaSha256'))
        if identity.get('entitlements'):
            identity['keychainAccessGroups']=identity['entitlements']['keychain-access-groups']
        transition=self.ios_module().restore_identity_transition(cfg,identity,previous)
        if transition:identity['identityTransition']=transition
        ios_ota.validate_upgrade({**identity,**prepared},previous)
        atomic_json(self.root/'signing-preflight.json',{'bundleId':identity['bundleId'],'teamId':identity['teamId'],
                       'applicationIdentifier':identity['applicationIdentifier'],'checkedAt':time.time()})

    def merged_checks(self):
        self.command(['npm', 'ci'])
        self.command(['npm', 'run', 'typecheck'])
        self.command(['npm', 'test', '--', 'tests/ci', '--maxWorkers=2', '--testTimeout=60000'])
        self.command([sys.executable, '-B', '-m', 'unittest', 'discover', '-s', 'tests/ci', '-p', 'test_*.py'])

    def prepare(self):
        tree = '\n'.join(line for line in self.git('ls-tree', '-r', 'HEAD').splitlines() if not line.endswith('\t.release-batch.json'))
        fingerprint = hashlib.sha256(json.dumps({'tree':tree, 'tasks':self.context['tasks'],
                              'target':self.config['target'], 'environment':self.config['environment']}, sort_keys=True).encode()).hexdigest()
        if self.mobile:
            cfg = self.ios_config()
            versions = [read_json(self.work / 'mobile-version-floor.json')['version']]
            for name in ('latest.json', 'latest-ios.json'): versions.append(self.url_json(LAN + '/' + name)['version'])
            previous=self.url_json(cfg['baseUrl'] + '/current/latest-ios.json', ca=cfg['caFile'])
            versions.append(previous['version'])
            releases = self.gh_json(f'repos/{self.repo}/releases?per_page=100')
            page=1
            while releases:
                for release in releases:
                    match = re.fullmatch(r'v?(\d+\.\d+\.\d+)|unsigned-ipa-(\d+\.\d+\.\d+)-\d+-\d+', release['tag_name'])
                    if match: versions.append(match[1] or match[2])
                if len(releases) < 100: break
                page += 1; releases = self.gh_json(f'repos/{self.repo}/releases?per_page=100&page={page}')
            # Include retained failed reservations, even if no GitHub Release was created.
            for reservation in self.root.parent.glob('*/version.json'):
                prior = read_json(reservation)
                if prior: versions.append(prior['version'])
            prepared = reserve_version(self.root / 'version.json', versions, fingerprint)
            self.signing_preflight(cfg,prepared,previous)
        else: prepared = {'inputFingerprint':fingerprint}
        passed = read_json(self.root / 'merged-checks.json')
        if not passed or passed.get('inputFingerprint') != fingerprint:
            self.merged_checks(); atomic_json(self.root / 'merged-checks.json', {'inputFingerprint':fingerprint, 'passed':True, 'checkedAt':time.time()})
        prepared={**prepared,'localValidation':'passed'}
        self.freeze_manifest(prepared)
        return {'done':True,'result':prepared}

    def freeze_manifest(self, prepared):
        # Match the coordinator's sanitized manifest bytes; it then freezes this introducing SHA.
        # Committing here preserves the project's Chinese Conventional Commit contract.
        manifest={'schemaVersion':1,'batchId':self.context['id'],'project':self.context['project'],
                  'scope':self.context['scope'],'target':self.config['target'],'environment':self.config['environment'],
                  'tasks':[{'id':t['id'],'sha':t['sha'],'validation':{'checks':[{'name':c['name'],'status':c['status']}
                            for c in t['validation']['checks']]}} for t in self.context['tasks']],
                  'prepared':{k:v for k,v in prepared.items() if k in ('version','buildNumber','bundleIdentifier','localValidation','inputFingerprint')}}
        atomic_json(self.work/'.release-batch.json',manifest,canonical=True)
        self.git('add','.release-batch.json')
        if self.git('status','--porcelain'):
            self.git('commit','-m','ci(发布): 冻结协调批次 '+self.context['id'],
                     '-m','新增功能：\n- 无\n\n主要修改：\n- 固定本批任务、验证结果、发布目标和统一版本\n- 后续 CI 与签名发布仅使用本冻结提交的产物')

    def main_check(self):
        remote = self.git('ls-remote', 'origin', 'refs/heads/' + self.config['branch']).split()[0]
        if remote != self.frozen_sha:
            # A subsequent same-repo batch can be a descendant; its receipt still verifies this batch.
            self.git('fetch', 'origin', self.config['branch'])
            process = subprocess.run(['git','merge-base','--is-ancestor',self.frozen_sha,remote],cwd=self.work,capture_output=True)
            if process.returncode: return {'done':False, 'result':{'remoteSha':remote}}
        return {'done':True, 'result':{'sourceCommit':self.frozen_sha, 'remoteSha':remote, 'branch':self.config['branch']}}

    def ci_run(self):
        rows = self.gh_json(f'repos/{self.repo}/actions/workflows/build-mobile.yml/runs?head_sha={self.frozen_sha}&per_page=100')['workflow_runs']
        matches = [r for r in rows if r['head_sha'] == self.frozen_sha]
        operation = self.read_progress().get('operations', {}).get('build', {})
        recorded = operation.get('runId')
        if recorded:
            matches = [r for r in matches if r['id'] == recorded]
            if not matches: raise ValueError('已记录 CI run 与冻结提交不匹配或丢失')
            if operation.get('attempt') is not None and str(matches[0].get('run_attempt', 1)) != str(operation['attempt']):
                raise ValueError('已记录 CI run/attempt 改变，不能借用重新运行的产物')
        if len(matches) > 1: raise ValueError('同一冻结 SHA 存在重复正式 CI，保留诊断后人工关联修复')
        return matches[0] if matches else None

    def validate_build_receipt(self, receipt, platform):
        if receipt.get('sourceCommit') != self.frozen_sha: raise ValueError('产物来源 sourceCommit 不在冻结 commit')
        if receipt.get('batchId') != self.context['id'] or receipt.get('version') != self.version:
            raise ValueError('产物批次/版本不匹配')
        if str(receipt.get('buildNumber')) != self.build_number: raise ValueError('产物构建号不匹配')
        if receipt.get('platform') != platform: raise ValueError('产物平台不匹配')
        operation=self.read_progress().get('operations',{}).get('build',{})
        if not operation.get('runId') or str(receipt.get('runId'))!=str(operation['runId']) or str(receipt.get('runAttempt'))!=str(operation.get('attempt')):
            raise ValueError('产物不属于本批已记录 CI run/attempt')
        if receipt.get('tasks') != [{'id':t['id'],'sha':t['sha']} for t in self.context['tasks']]:
            raise ValueError('产物回执任务集合与冻结任务不同')
        if not re.fullmatch(r'[0-9a-f]{64}',receipt.get('sha256','')) or receipt.get('size',0) <= 0:
            raise ValueError('产物缺少大小或 SHA-256')
        return receipt

    def platform_artifact(self, folder, platform):
        filename=f'CodexMobile-v{self.version}'+('.apk' if platform=='android' else '-unsigned.ipa')
        receipt=read_json(folder/f'{platform}-build.json')
        if not receipt:return None
        self.validate_build_receipt(receipt,platform)
        path=folder/filename
        if not path.is_file():return None
        if path.stat().st_size!=receipt['size'] or sha256(path)!=receipt['sha256']:
            raise ValueError('CI 产物损坏或来源散列不匹配')
        return {**receipt,'path':str(path)}

    def download_candidate_artifact(self, folder, platform, intent):
        state = (intent or {}).get('downloadState')
        if state not in (None, 'downloading', 'interrupted', 'downloaded'):
            raise ValueError('CI 下载状态未通过确认，保留失败现场')
        receipt = read_json(folder / f'{platform}-build.json')
        if not receipt:
            if state == 'downloaded': raise ValueError('已确认 CI 下载缺少来源回执')
            return None
        # 未确认下载只能放过 payload 截断，不能放过回执来源错误。
        self.validate_build_receipt(receipt, platform)
        filename = f'CodexMobile-v{self.version}' + ('.apk' if platform == 'android' else '-unsigned.ipa')
        path = folder / filename
        if state in (None, 'downloading', 'interrupted') and path.is_file() and path.stat().st_size < receipt['size']:
            return None
        artifact = self.platform_artifact(folder, platform)
        if not artifact and state == 'downloaded': raise ValueError('已确认 CI 下载缺少产物文件')
        return artifact

    def build_artifacts(self, folder=None):
        folder=folder or self.root/'ci-artifacts';result={}
        for platform in ('android','ios'):
            item=self.platform_artifact(folder,platform)
            if not item:return None
            result[platform]=item
        return result

    def build_wait_budget(self):
        operation = self.read_progress().get('operations', {}).get('build', {})
        started = operation.get('waitStartedAt', time.time())
        if isinstance(started, bool) or not isinstance(started, (int, float)) or not math.isfinite(started) or started < 0:
            raise ValueError('CI 等待起点记录无效，不能重新开启计时')
        deadline = operation.get('waitDeadlineAt', started + 3600)
        if (isinstance(deadline, bool) or not isinstance(deadline, (int, float)) or not math.isfinite(deadline)
                or deadline < started or deadline > started + 3600):
            raise ValueError('CI 等待预算记录无效，不能重新开启计时')
        if 'waitStartedAt' not in operation or 'waitDeadlineAt' not in operation:
            self.progress('build', waitStartedAt=started, waitDeadlineAt=deadline)
        return started, deadline

    def build_check(self):
        _, deadline = self.build_wait_budget()
        run = self.ci_run()
        if not run: return {'done':False, 'result':{}}
        self.progress('build',runId=run['id'],attempt=run.get('run_attempt',1),status=run['status'],url=run.get('html_url'))
        if run['status'] != 'completed':
            if time.time() >= deadline: raise TimeoutError('等待正式 CI 超时；远端运行不会被取消')
            return {'done':False,'result':{'runId':run['id']}}
        if run['conclusion'] != 'success': raise ValueError(f'冻结提交 CI run {run["id"]} 失败: {run["conclusion"]}')
        release = self.gh_json(f'repos/{self.repo}/releases/tags/v{self.version}', missing=True)
        if not release: return {'done':False,'result':{'runId':run['id']}}
        commit = self.gh_json(f'repos/{self.repo}/commits/v{self.version}')['sha']
        if commit != self.frozen_sha: raise ValueError('Release tag 来源不是冻结提交')
        artifacts = self.build_artifacts()
        if not artifacts: return {'done':False,'result':{'runId':run['id']}}
        assets = {a['name']:a for a in release['assets']}
        for platform in ('android','ios'):
            item=artifacts[platform]; asset=assets.get(Path(item['path']).name)
            if not asset or asset['size']!=item['size']: raise ValueError('GitHub Release 附件缺失或大小不同')
            if asset.get('digest') and asset['digest'] != 'sha256:' + item['sha256']: raise ValueError('GitHub 附件 SHA-256 不匹配')
            artifacts[platform]['downloadUrl']=asset['browser_download_url']
        return {'done':True,'result':{'runId':run['id'],'attempt':run.get('run_attempt',1),'releaseId':release['id'],
                              'releaseUrl':release['html_url'],'sourceCommit':self.frozen_sha,'batchId':self.context['id'],'artifacts':artifacts}}

    def run_build(self):
        started, deadline = self.build_wait_budget()
        while True:
            # 恢复时先查询实际完成状态；预算过期也能接纳已成功的同一运行。
            run = self.ci_run()
            if run:
                self.progress('build', runId=run['id'], attempt=run.get('run_attempt', 1), status=run['status'], url=run.get('html_url'))
                if run['status'] == 'completed':
                    if run['conclusion'] != 'success': raise ValueError('正式 CI 失败，保留失败批次并关联修复')
                    break
                if time.time() >= deadline: raise TimeoutError('等待正式 CI 超时；远端运行不会被取消')
            elif time.time() >= started + 120:
                raise ValueError('推送后没有对应冻结提交 CI，不能借用其他构建')
            time.sleep(10)
        if not self.build_artifacts():
            partials=self.root/'ci-partials';partials.mkdir(exist_ok=True,mode=0o700)
            for platform in ('android','ios'):
                current=partials/platform
                if current.exists():
                    if self.platform_artifact(current,platform): continue
                    raise ValueError('已验收 CI 单端产物缺少回执或文件')
                intent=read_json(self.root/f'download-{platform}.json')
                if intent and (str(intent.get('runId')) != str(run['id']) or str(intent.get('attempt', run.get('run_attempt', 1))) != str(run.get('run_attempt', 1))):
                    raise ValueError('CI 下载候选不属于已记录 run/attempt')
                candidate=Path(intent['candidate']) if intent else self.root/(f'download-{platform}-'+uuid.uuid4().hex)
                if candidate.parent!=self.root:raise ValueError('CI 下载候选路径不属于本批')
                complete=False
                if candidate.exists() or intent: complete=bool(self.download_candidate_artifact(candidate,platform,intent))
                if not complete:
                    candidate=self.root/(f'download-{platform}-'+uuid.uuid4().hex);candidate.mkdir(mode=0o700)
                    intent = {'candidate':str(candidate),'runId':run['id'],'attempt':run.get('run_attempt',1),'downloadState':'downloading'}
                    intent_path = self.root / f'download-{platform}.json'
                    atomic_json(intent_path, intent)
                    try:
                        self.command(['gh','run','download',str(run['id']),'--repo',self.repo,'--name','codex-mobile-'+platform,'--dir',str(candidate)], read_only=True)
                    except TransientReadError:
                        atomic_json(intent_path, {**intent, 'downloadState':'interrupted'})
                        raise
                    except Exception:
                        atomic_json(intent_path, {**intent, 'downloadState':'failed'})
                        raise
                    atomic_json(intent_path, {**intent, 'downloadState':'downloaded'})
                    if not self.platform_artifact(candidate,platform):raise ValueError('CI 单端下载未完整验收')
                if current.exists():os.replace(current,self.root/(f'incomplete-{platform}-'+uuid.uuid4().hex))
                os.replace(candidate,current)
            flat=self.root/('verified-'+uuid.uuid4().hex);flat.mkdir(mode=0o700)
            for folder in partials.iterdir():
                for file in folder.iterdir():
                    if file.is_file():
                        dest=flat/file.name
                        if dest.exists():raise ValueError('CI artifact 文件名冲突')
                        shutil.copyfile(file,dest)
            if not self.build_artifacts(flat):raise ValueError('双端产物未通过完整校验')
            dest=self.root/'ci-artifacts'
            if dest.exists():os.replace(dest,self.root/('incomplete-ci-'+uuid.uuid4().hex))
            os.replace(flat,dest)

    def package_info(self, path):
        with zipfile.ZipFile(path) as archive:
            names=[n for n in archive.namelist() if re.fullmatch(r'Payload/[^/]+\.app/Info.plist',n)]
            if len(names)!=1: raise ValueError('IPA 必须包含一个主 app')
            info=plistlib.loads(archive.read(names[0]))
        if info.get('CFBundleShortVersionString') != self.version or str(info.get('CFBundleVersion'))!=self.build_number:
            raise ValueError('IPA 版本/构建号不在本批')
        return info

    def local_ipa(self, signed=False):
        return self.root / ('adhoc.ipa' if signed else 'device-unsigned.ipa')

    def iosbuild_check(self):
        path=self.local_ipa();intent=read_json(self.root/'iosbuild-intent.json')
        if not path.exists() and intent and intent.get('candidate'):
            candidate=Path(intent['candidate'])
            if candidate.parent != self.root:raise ValueError('设备候选路径不属于本批')
            if candidate.is_file():
                if intent['sourceCommit']!=self.frozen_sha or intent['batchId']!=self.context['id']:raise ValueError('设备候选来源不在本批')
                try:self.package_info(candidate)
                except (zipfile.BadZipFile,EOFError):return {'done':False,'result':{'incompleteCandidate':str(candidate)}}
                os.replace(candidate,path)
        if not path.exists(): return {'done':False,'result':{}}
        if not intent or intent['sourceCommit']!=self.frozen_sha or intent['batchId']!=self.context['id']:
            raise ValueError('设备构建缺少本批来源意图')
        self.package_info(path)
        return {'done':True,'result':{'sourceCommit':self.frozen_sha,'batchId':self.context['id'],'version':self.version,
                                    'buildNumber':self.build_number,'sha256':sha256(path),'size':path.stat().st_size,'path':str(path)}}

    def validate_signed_candidate(self, path, expected):
        import ios_sign
        metadata=ios_sign.verify_ipa(path)
        for key in ('bundleId','teamId','applicationIdentifier'):
            if metadata[key]!=expected[key]:raise ValueError('签名身份不连续: '+key)
        if metadata['entitlementsSha256']!=ios_sign.entitlements_sha256(expected['entitlements']):
            raise ValueError('签名包权限不等于已授权兼容基准')
        self.package_info(path)
        return metadata

    def recover_signed_candidate(self, expected):
        import ios_sign
        # These directories belong to this batch's existing signing helper invocation.
        for temporary in sorted(self.root.glob('.codex-ios-sign-*')):
            if temporary.is_symlink():raise ValueError('签名临时目录不能为链接')
            candidate=temporary/'signed.ipa'
            if candidate.exists():
                try:
                    with zipfile.ZipFile(candidate) as archive:complete=archive.testzip() is None
                except (zipfile.BadZipFile,EOFError):complete=False
                if not complete:os.replace(candidate,self.root/('incomplete-signed-'+uuid.uuid4().hex+'.ipa'))
            if not candidate.exists():
                apps=list((temporary/'unpacked/Payload').glob('*.app'))
                if len(apps)!=1:continue
                try:
                    details=ios_sign.verify_app(apps[0],temporary,details=True)
                    ios_sign.validate_signed_entitlements(details['entitlements'],expected)
                    if details['metadata']['version']!=self.version or details['metadata']['buildNumber']!=self.build_number:continue
                except ios_sign.SigningError:continue
                ios_sign.pack_ipa(temporary/'unpacked',candidate)
            self.validate_signed_candidate(candidate,expected)
            os.replace(candidate,self.local_ipa(True))
            shutil.rmtree(temporary)
            return True
        return False

    def sign_check(self):
        path=self.local_ipa(True);intent=read_json(self.root/'sign-intent.json')
        if not intent:return {'done':False,'result':{}}
        unsigned=self.iosbuild_check()
        if not unsigned['done'] or intent['unsignedSha256']!=unsigned['result']['sha256'] or intent['sourceCommit']!=self.frozen_sha:
            raise ValueError('已签名包没有可追溯的本批来源')
        import ios_sign
        cfg=self.ios_config()
        expected=ios_sign.signing_identity(ios_sign.read_profile(cfg['profile']),cfg['bundleId'],cfg['udid'],
                    compatibility_ipa=cfg.get('compatibilityIpa'),compatibility_ipa_sha256=cfg.get('compatibilityIpaSha256'))
        if not path.exists() and not self.recover_signed_candidate(expected):return {'done':False,'result':{}}
        metadata=self.validate_signed_candidate(path,expected)
        old=read_json(self.root/'signed.json')
        if old and (old['sourceCommit']!=self.frozen_sha or old['sha256']!=sha256(path)):
            raise ValueError('已验收签名产物被替换')
        result={**metadata,'batchId':self.context['id'],'sourceCommit':self.frozen_sha,'sha256':sha256(path),'size':path.stat().st_size,'path':str(path)}
        if not old:atomic_json(self.root/'signed.json',result)
        return {'done':True,'result':result}

    def validate_ota_staging(self, path):
        import ios_ota
        release=ios_ota.check_package(path)
        if release['sourceCommit']!=self.frozen_sha or release['batchId']!=self.context['id'] or release['version']!=self.version:
            raise ValueError('OTA 暂存来源不属于本批')
        page=(Path(path)/'install.html').read_text()
        if quote(release['manifestUrl'],safe='') not in page:raise ValueError('OTA 安装页不包含本批 manifest')
        signed=read_json(self.root/'signed.json')
        if not signed or any(release[k]!=signed[k] for k in ('sha256','size','entitlementsSha256')):
            raise ValueError('OTA 暂存不是本批已验签包')
        return release

    def ota_staging(self, metadata):
        import ios_ota
        staging=self.root/'ota';intent=read_json(self.root/'ota-intent.json')
        if staging.exists():self.validate_ota_staging(staging);return staging
        candidate=Path(intent['candidate']) if intent else self.root/('ota-'+uuid.uuid4().hex)
        if candidate.parent!=self.root:raise ValueError('OTA 候选路径不属于本批')
        if candidate.exists():
            try:self.validate_ota_staging(candidate)
            except (OSError,ValueError,KeyError):
                # Preserve partial candidate diagnostics; create only the missing package stage.
                candidate=self.root/('ota-'+uuid.uuid4().hex)
            else:os.replace(candidate,staging);return staging
        cfg=self.ios_config()
        atomic_json(self.root/'ota-intent.json',{'candidate':str(candidate),'sourceCommit':self.frozen_sha})
        previous=ios_ota.fetch_previous(cfg['baseUrl'])
        ios_ota.create_release(self.local_ipa(True),{k:v for k,v in metadata.items() if k!='path'},candidate,cfg['baseUrl'],self.notes(),previous)
        self.validate_ota_staging(candidate);os.replace(candidate,staging)
        return staging

    def ota_check(self):
        signed=self.sign_check()
        if not signed['done']:return {'done':False,'result':{}}
        cfg=self.ios_config();remote=self.url_json(cfg['baseUrl']+'/current/latest-ios.json',ca=cfg['caFile'])
        if not remote or remote['version']!=self.version:return {'done':False,'result':{}}
        expected=signed['result']
        for key in ('sha256','size','batchId','sourceCommit','bundleId','teamId','applicationIdentifier','keychainAccessGroups'):
            if remote.get(key)!=expected.get(key):raise ValueError('OTA 来源/身份/包不匹配: '+key)
        import ios_ota
        ios_ota.verify_published(remote)
        return {'done':True,'result':remote}

    def lan_check(self, phase):
        if phase=='apk':
            artifacts=self.build_artifacts()
            if not artifacts:return {'done':False,'result':{}}
            expected=artifacts['android'];suffix='';ext='apk'
        else:
            signed=self.sign_check()
            if not signed['done']:return {'done':False,'result':{}}
            expected=signed['result'];suffix='-ios';ext='ipa'
        remote=self.url_json(LAN+'/latest'+suffix+'.json')
        if not remote or remote['version']!=self.version:return {'done':False,'result':{}}
        for key in ('size','sha256'):
            if remote.get(key)!=expected[key]:raise ValueError('LAN 同版本散列/大小与冻结产物不一致')
        self.download_verified(LAN+'/latest.'+ext,expected,self.root/('verified-lan.'+ext))
        return {'done':True,'result':{**remote,'sourceCommit':self.frozen_sha,'batchId':self.context['id'],
                                  'signed':phase=='ipa','buildNumber':self.build_number,'releaseId':self.context['id']+':'+phase}}

    def source_check(self):
        build=self.build_check()
        if not build['done']:return {'done':False,'result':{}}
        unsigned=build['result']['artifacts']['ios'];feed=self.url_json(self.options['source_url'])
        apps=[a for a in feed['apps'] if a.get('bundleIdentifier')==self.config['target']]
        matching=[a for a in apps if a.get('downloadURL','').endswith('-unsigned.ipa')]
        if len(matching)!=1:raise ValueError('软件源 unsigned IPA 订阅不唯一')
        app=matching[0]
        if app.get('version')!=self.version:return {'done':False,'result':{}}
        expected={'buildVersion':self.build_number,'downloadURL':unsigned['downloadUrl'],'size':unsigned['size'],'sha256':unsigned['sha256']}
        for key,value in expected.items():
            if key=='sha256' and not app.get(key):return {'done':False,'result':{'missing':'unsigned-digest-attestation'}}
            if app.get(key)!=value:raise ValueError('软件源 unsigned 产物不匹配: '+key)
        username=self.gh_json('user')['login']
        if username.lower() not in re.split(r'[^a-z0-9-]+',app.get('developerName','').lower()):return {'done':False,'result':{}}
        return {'done':True,'result':{'appId':app['appID'],'version':self.version,**expected,'developerName':app['developerName'],
                                     'sourceCommit':self.frozen_sha,'signed':False,
                                     'syncOperation':self.read_progress().get('operations',{}).get('source',{})}}

    def attest_source(self, base, headers, entry_id, catalog, expected):
        for attempt in range(5):
            entry=next(e for e in catalog['entries'] if e['id']==entry_id)
            current=entry.get('current') or {};metadata=current.get('metadata') or {}
            if current.get('downloadURL')!=expected['downloadUrl'] or metadata.get('version')!=self.version:
                return False
            if str(metadata.get('buildVersion'))!=self.build_number or current.get('inspection',{}).get('fullBytes')!=expected['size']:
                raise ValueError('软件源待证明包的构建号/大小不在本批')
            actual=current.get('sha256')
            if actual and actual!=expected['sha256']:raise ValueError('软件源已公布散列不同，不能覆盖')
            if actual==expected['sha256']:
                self.progress('source',attestationVerified=True,attestationId=entry_id+':'+current.get('fingerprint',self.version),sha256=actual)
                return True
            if attempt==4:raise ValueError('软件源散列证明四次写入后仍未核对')
            self.progress('source',attestationIntent=True,attestationId=entry_id+':'+current.get('fingerprint',self.version),sha256=expected['sha256'])
            try:self.url_json(base+'/api/entries/'+entry_id+'/attest',method='POST',headers=headers,
                              data={'revision':catalog['revision'],'sha256':expected['sha256']})
            except Exception as error:
                reconciled=self.url_json(base+'/api/catalog',headers=headers)
                live=next(e for e in reconciled['entries'] if e['id']==entry_id)
                if live.get('current',{}).get('sha256')==expected['sha256']:
                    catalog=reconciled;continue
                if 'HTTP 409' not in str(error) or attempt==3:raise
                catalog=reconciled;continue
            catalog=self.url_json(base+'/api/catalog',headers=headers)
        raise ValueError('软件源散列证明未完成真实核对')

    def source_manage(self):
        credential_path=self.options.get('source_credentials')
        if not credential_path:return
        private=read_json(Path(credential_path).expanduser())
        if not private or not private['url'].startswith('https://'):raise ValueError('软件源管理配置无效')
        headers={'Authorization':'Bearer '+private['token'],'Content-Type':'application/json'}
        base=private['url'].rstrip('/')
        catalog=self.url_json(base+'/api/catalog',headers=headers)
        entries=catalog.get('entries',[])
        candidates=[e for e in entries if e.get('kind')=='github' and e.get('repository')==self.repo]
        # Catalog keeps configuration fields nested in config on current source versions.
        if not candidates:candidates=[e for e in entries if (e.get('config') or {}).get('repository')==self.repo]
        if len(candidates)!=1:raise ValueError('软件源管理订阅不能唯一定位本仓库')
        entry=candidates[0];entry_id=entry['id']
        username=self.gh_json('user')['login']
        presentation=entry.get('presentation') or {}
        developer=entry.get('developerName') or presentation.get('developerName') or ''
        public={}
        if not developer:
            feed=self.url_json(self.options['source_url'])
            public=next((app for app in feed.get('apps',[]) if app.get('appID')==entry_id),{})
            developer=public.get('developerName') or entry.get('config',{}).get('repository',self.repo).split('/')[0]
        if username.lower() not in re.split(r'[^a-z0-9-]+',developer.lower()):
            presentation=entry.get('presentation') or {}
            developer=(developer+', ' if developer else '')+username
            self.url_json(base+'/api/entries/'+entry_id+'/presentation',method='POST',headers=headers,
                          data={'revision':catalog['revision'],'developerName':developer,
                                'description':presentation.get('description',''),
                                'iconURL':presentation.get('iconURL') or public.get('iconURL'), 'legacyDefault':presentation.get('legacyDefault',public.get('legacyDefault',False))})
        current=entry.get('current') or {}
        if current.get('metadata',{}).get('version')==self.version:
            build=self.build_check()
            if not build['done']:raise ValueError('软件源证明缺少本批 CI 产物')
            # presentation can change the catalog revision; reconcile before an attest POST.
            catalog=self.url_json(base+'/api/catalog',headers=headers)
            if self.attest_source(base,headers,entry_id,catalog,build['result']['artifacts']['ios']):return
        active=[j for j in catalog.get('jobs',[]) if j['entryId']==entry_id and j.get('status') not in ('succeeded','failed','superseded')]
        if active:
            self.progress('source',releaseId=entry_id,jobId=active[-1]['id'],status=active[-1]['status'])
            return
        operation=self.read_progress().get('operations',{}).get('source',{})
        completed_ids=operation.get('syncJobIds',[])
        jobs=[j for j in catalog.get('jobs',[]) if j['entryId']==entry_id and j['id'] in completed_ids]
        if len(jobs)>=3:raise ValueError('软件源同步三次后仍未核对目标，保留失败批次')
        self.progress('source',releaseId=entry_id,syncIntentAt=time.time())
        # A boolean intent does not prove a request reached the remote service.
        old_job_ids={j['id'] for j in catalog.get('jobs',[]) if j['entryId']==entry_id}
        try:self.url_json(base+'/api/entries/'+entry_id+'/sync',method='POST',headers=headers,data={})
        except Exception:
            reconciled=self.url_json(base+'/api/catalog',headers=headers)
            confirmed=[j for j in reconciled.get('jobs',[]) if j['entryId']==entry_id and j['id'] not in old_job_ids]
            if not confirmed:raise
        else:reconciled=self.url_json(base+'/api/catalog',headers=headers)
        relevant=[j for j in reconciled.get('jobs',[]) if j['entryId']==entry_id]
        if relevant:
            job=relevant[-1]; ids=list(dict.fromkeys([*completed_ids,job['id']]))
            self.progress('source',releaseId=entry_id,jobId=job['id'],syncJobIds=ids,status=job['status'])

    def development_check(self):
        runs=self.gh_json(f'repos/{self.repo}/actions/workflows/development-checks.yml/runs?head_sha={self.frozen_sha}&per_page=100')['workflow_runs']
        matches=[r for r in runs if r['head_sha']==self.frozen_sha and r.get('event','push')=='push']
        if not matches:return {'done':False,'result':{}}
        run=matches[0]
        self.progress('development',runId=run['id'],attempt=run.get('run_attempt',1),status=run['status'])
        if run['status']!='completed':return {'done':False,'result':{'runId':run['id']}}
        if run['conclusion']!='success':raise ValueError('冻结提交必要开发 CI 未通过')
        return {'done':True,'result':{'runId':run['id'],'attempt':run.get('run_attempt',1),'sourceCommit':self.frozen_sha}}

    def require_authorized_phase(self, phase):
        if self.ota_only and phase not in self.ota_phases:
            raise ValueError('OTA-only 目标禁止执行阶段: ' + phase)

    def prior_ota_history(self):
        from release_coordination.prior_ota import included_history
        return included_history(self)

    def check_phase(self, phase):
        self.require_authorized_phase(phase)
        if phase=='main':return self.main_check()
        if phase=='build':return self.build_check()
        if phase=='iosbuild':return self.iosbuild_check()
        if phase=='sign':return self.sign_check()
        if phase=='ota':return self.ota_check()
        if phase in ('apk','ipa'):return self.lan_check(phase)
        if phase=='source':return self.source_check()
        if phase=='gateway':
            from release_coordination.gateway import Gateway
            return Gateway(self).check()
        if phase=='verify':
            development=self.development_check()
            if not development['done']:return {'done':False,'result':{'missing':'development'}}
            phases=self.ota_phases[:-1] if self.ota_only else ['main','build','iosbuild','sign','ota','apk','ipa','source'] if self.mobile else ['main','gateway']
            evidence={'development':development['result']}
            for step in phases:
                checked=self.check_phase(step)
                if not checked.get('done'):return {'done':False,'result':{'missing':step}}
                evidence[step]=checked['result']
            # GitHub Release contents are independently downloaded, not just trusted CI filenames.
            if self.mobile and not self.ota_only:
                for item in evidence['build']['artifacts'].values():
                    self.download_verified(item['downloadUrl'],item,self.root/('verified-github-'+Path(item['path']).name))
                if evidence['apk']['version']!=evidence['ipa']['version']:raise ValueError('双端渠道版本不一致')
                atomic_json(self.root/'ota-release.json',{**evidence['ota'],'lan':evidence['ipa'],'source':evidence['source'],
                            'verifiedAt':time.time(),'appSource':{'signedPackage':'disabled','unsignedVerified':True}})
            history = self.prior_ota_history() if self.ota_only else []
            if self.ota_only:
                atomic_json(self.root/'ota-release.json', {**evidence['ota'], 'lan':evidence['ipa'],
                    'sourceCommit':self.frozen_sha, 'batchId':self.context['id'], 'distribution':'ota-only',
                    'githubReleasePublished':False, 'apkPublished':False, 'softwareSourceUpdated':False,
                    'priorStandaloneDeliveries':history, 'verifiedAt':time.time()})
            return {'done':True,'result':{'sourceCommit':self.frozen_sha,'batchId':self.context['id'],'channels':evidence,
                             **({'distribution':'ota-only','priorStandaloneDeliveries':history} if self.ota_only else {}),
                             'tasksIncluded':[t['sha'] for t in self.context['tasks']], 'verifiedAt':time.time(),
                             'deviceInstall':'未进行真机覆盖安装与数据保留验收'}}
        raise ValueError('不支持的发布阶段: '+phase)

    def execute_phase(self, phase):
        self.require_authorized_phase(phase)
        if phase=='main':
            self.command(['git','push','origin',self.frozen_sha+':refs/heads/'+self.config['branch']])
        elif phase=='build':self.run_build()
        elif phase=='iosbuild':
            cfg=self.ios_config();candidate=self.root/('device-'+uuid.uuid4().hex+'.ipa')
            atomic_json(self.root/'iosbuild-intent.json',{'sourceCommit':self.frozen_sha,'batchId':self.context['id'],'version':self.version,'candidate':str(candidate)})
            self.ios_module().build_unsigned(self.version,cfg,candidate,retained_root=self.root/'device-build')
            self.package_info(candidate);os.replace(candidate,self.local_ipa())
        elif phase=='sign':
            cfg=self.ios_config();unsigned=self.iosbuild_check()['result']
            atomic_json(self.root/'sign-intent.json',{'sourceCommit':self.frozen_sha,'batchId':self.context['id'],'unsignedSha256':unsigned['sha256']})
            import ios_sign
            ios_sign.sign_ipa(self.local_ipa(),self.local_ipa(True),cfg['profile'],cfg['p12'],
                    password_file=cfg.get('passwordFile'),password_keychain_service=cfg.get('passwordKeychainService'),
                    bundle_id=cfg['bundleId'],udid=cfg['udid'],compatibility_ipa=cfg.get('compatibilityIpa'),
                    compatibility_ipa_sha256=cfg.get('compatibilityIpaSha256'))
        elif phase=='ota':
            import ios_ota
            cfg=self.ios_config();metadata=self.sign_check()['result'];staging=self.ota_staging(metadata)
            if not cfg.get('localRoot'):raise ValueError('本项目适配器仅使用当前现役本机 OTA 配置')
            destination=Path(cfg['localRoot'])/'releases'/self.version
            if not destination.exists():ios_ota.stage_local(staging,cfg['localRoot'])
            elif ios_ota.check_package(destination)!=ios_ota.check_package(staging):raise ValueError('OTA 同版本暂存不匹配，保留失败现场')
            release=ios_ota.check_package(staging);ios_ota.verify_published(release,fixed=False)
            ios_ota.activate_staged(staging,cfg['localRoot'])
        elif phase in ('apk','ipa'):
            suffix='' if phase=='apk' else '-ios';current=self.url_json(LAN+'/latest'+suffix+'.json')
            if current and version_code(current['version'])>=version_code(self.version):raise ValueError('不能覆盖同版本/更高版本渠道，须关联修复')
            path=self.build_artifacts()['android']['path'] if phase=='apk' else str(self.local_ipa(True))
            self.progress(phase,releaseId=self.context['id']+':'+phase,sourceCommit=self.frozen_sha)
            self.command([sys.executable,self.options['lan_publisher'],'publish-channel','codex-mobile',path,'--version',self.version,'--notes',self.notes()])
        elif phase=='source':
            self.source_manage();deadline=time.monotonic()+3600
            while time.monotonic()<deadline:
                if self.source_check()['done']:return
                self.source_manage()
                self.progress('source',status='waiting-for-unsigned-subscription');time.sleep(15)
            raise TimeoutError('软件源 unsigned 版本尚未通过验收；保留失败批次')
        elif phase=='gateway':
            from release_coordination.gateway import Gateway
            Gateway(self).run()
        elif phase=='verify':
            deadline=time.monotonic()+1200
            while time.monotonic()<deadline:
                if self.development_check()['done']:return
                time.sleep(10)
            raise TimeoutError('冻结提交必要开发 CI 等待超时')
        else:raise ValueError('不支持的发布阶段')

    def notes(self):
        return self.command(['node', self.work/'scripts/read-release-notes.mjs', '--root', self.work])

    def run_phase(self, phase):
        checked=self.check_phase(phase)
        if checked.get('done'):return checked
        self.progress(phase,status='executing')
        try:self.execute_phase(phase)
        except Exception:
            # Mirrors coordinator reconciliation, also supports a direct adapter invocation.
            with contextlib.suppress(Exception):
                checked=self.check_phase(phase)
                if checked.get('done'):return checked
            raise
        return self.check_phase(phase)


def main():
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action',choices=['check','run']);parser.add_argument('phase');parser.add_argument('--context',required=True)
    args=parser.parse_args();adapter=Adapter(read_json(args.context))
    # Imported legacy build helpers use inherited stdout; reserve stdout for the protocol JSON.
    try:
        with contextlib.redirect_stdout(sys.stderr):
            if args.phase == 'prepare':
                if args.action != 'run': raise ValueError('prepare 仅由协调器运行')
                result = adapter.prepare()
            else:
                adapter.assert_frozen()
                result = adapter.check_phase(args.phase) if args.action == 'check' else adapter.run_phase(args.phase)
    except TransientReadError as error:
        if args.phase == 'prepare': raise
        result = {'done': False, 'retryable': {'kind': 'transient-read', 'reason': str(error)}}
    print(json.dumps(result, ensure_ascii=False))


if __name__=='__main__':
    try:main()
    except Exception as error:raise SystemExit(f'Codex Mobile 发布协调失败: {error}')
