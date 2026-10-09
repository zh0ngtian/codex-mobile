#!/usr/bin/env python3
"""已验证 Ad Hoc IPA 的 HTTPS 静态 OTA 发布；证书校验由 ios_sign 完成。"""
import argparse
import fcntl
import hashlib
import html
import json
import os
from pathlib import Path
import plistlib
import re
import shlex
import shutil
import ssl
import subprocess
import tempfile
import urllib.error
import urllib.parse
import urllib.request
from datetime import datetime, timezone


def version_tuple(value):
    if not isinstance(value, str) or not re.fullmatch(r'\d+\.\d+\.\d+', value):
        raise ValueError('版本必须是 major.minor.patch')
    return tuple(map(int, value.split('.')))


def resolve_version(floor, current=None, requested=None):
    baseline = max([version_tuple(floor), *([version_tuple(current)] if current else [])])
    if requested:
        if version_tuple(requested) <= baseline:
            raise ValueError('指定版本必须高于现有渠道与版本下限')
        return requested
    major, minor, patch = baseline
    if patch >= 999:
        raise ValueError('patch 已到 999，请明确指定更高 minor 版本')
    return f'{major}.{minor}.{patch+1}'


def validate_base_url(value):
    parts = urllib.parse.urlsplit(value)
    if (parts.scheme != 'https' or not parts.hostname or parts.username or parts.password
            or parts.query or parts.fragment or '%' in parts.path
            or any(p in ('.', '..') for p in parts.path.split('/'))
            or not re.fullmatch(r'https://[A-Za-z0-9.:-]+(?:/[A-Za-z0-9_-]+)*/?', value)):
        raise ValueError('OTA 地址必须是无凭据、查询参数和片段的 HTTPS 地址')
    return value.rstrip('/')


def validate_upgrade(metadata, previous):
    transition = metadata.get('identityTransition')
    if not previous:
        if transition is not None:
            raise ValueError('身份恢复记录缺少原渠道版本')
        return
    if version_tuple(metadata['version']) <= version_tuple(previous['version']):
        raise ValueError('发布版本必须高于现有 OTA 版本')
    restoring = False
    if transition is not None:
        if (not isinstance(transition, dict)
                or set(transition) != {'fromBundleId', 'toBundleId', 'previousVersion', 'previousSha256', 'compatibilityIpaSha256'}
                or transition['fromBundleId'] != previous.get('bundleId')
                or transition['toBundleId'] != metadata.get('bundleId')
                or transition['fromBundleId'] == transition['toBundleId']
                or transition['previousVersion'] != previous.get('version')
                or transition['previousSha256'] != previous.get('sha256')
                or not all(isinstance(transition[k], str) and re.fullmatch(r'[0-9a-f]{64}', transition[k])
                           for k in ('previousSha256', 'compatibilityIpaSha256'))):
            raise ValueError('身份恢复记录与原渠道、目标 Bundle ID 或基准散列不匹配')
        restoring = True
    for key in ('bundleId', 'teamId', 'applicationIdentifier'):
        if key == 'bundleId' and restoring:
            continue
        if metadata[key] != previous.get(key):
            raise ValueError(f'覆盖升级签名身份发生变化：{key}；需要兼容描述文件')
    if (not restoring and previous.get('keychainAccessGroups') is not None
            and metadata.get('keychainAccessGroups') != previous['keychainAccessGroups']):
        raise ValueError('覆盖升级钥匙串组发生变化')
    if previous.get('buildNumber') and int(metadata['buildNumber']) <= int(previous['buildNumber']):
        raise ValueError('CFBundleVersion 必须高于现有 OTA 构建号')


def digest(path):
    with Path(path).open('rb') as stream:
        sha = hashlib.sha256()
        while chunk := stream.read(1024*1024):
            sha.update(chunk)
        return sha.hexdigest()


def create_release(ipa, metadata, output, base_url, notes, previous=None):
    base = validate_base_url(base_url)
    if metadata.get('signed') is not True:
        raise ValueError('OTA 仅接受已验证的 Ad Hoc 签名 IPA')
    version = metadata['version']
    version_tuple(version)
    for key in ('bundleId', 'teamId', 'applicationIdentifier', 'profileExpiresAt', 'buildNumber'):
        if not isinstance(metadata.get(key), str) or not metadata[key]:
            raise ValueError(f'签名检查结果缺少 {key}')
    validate_upgrade(metadata, previous)
    output = Path(output)
    output.mkdir(parents=True, exist_ok=False)
    shutil.copyfile(ipa, output / 'latest.ipa')
    version_url = f'{base}/releases/{version}'
    manifest_url = f'{version_url}/manifest.plist'
    release = {**metadata, 'tag': f'v{version}', 'notes': notes,
               'pageUrl': f'{base}/current/latest-ios.json',
               'downloadUrl': f'{version_url}/latest.ipa',
               'manifestUrl': manifest_url, 'installUrl': f'{base}/current/install.html',
               'sha256': digest(output/'latest.ipa'), 'size': (output/'latest.ipa').stat().st_size,
               'publishedAt': datetime.now(timezone.utc).isoformat()}
    release['releases'] = [*(previous or {}).get('releases', []),
                           {'version': version, 'notes': notes}]
    manifest = {'items': [{'assets': [{'kind': 'software-package', 'url': release['downloadUrl']}],
                          'metadata': {'bundle-identifier': metadata['bundleId'],
                                       'bundle-version': metadata['buildNumber'], 'kind': 'software', 'title': 'Codex Mobile'}}]}
    (output/'manifest.plist').write_bytes(plistlib.dumps(manifest))
    (output/'latest-ios.json').write_text(json.dumps(release, ensure_ascii=False, indent=2)+'\n')
    link = 'itms-services://?action=download-manifest&url=' + urllib.parse.quote(manifest_url, safe='')
    (output/'install.html').write_text(f'''<!doctype html>
<html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>安装 Codex Mobile</title><style>body{{font:17px system-ui;max-width:36rem;margin:12vh auto;padding:24px;line-height:1.7}}a{{display:inline-block;padding:12px 24px;background:#111;color:white;border-radius:12px;text-decoration:none}}small{{word-break:break-all}}</style>
<h1>Codex Mobile v{html.escape(version)}</h1><p>{html.escape(notes)}</p>
<p><a href="{html.escape(link, quote=True)}">安装 / 更新</a></p>
<p>请在 iPhone 的 Safari 中点击，并确认系统安装提示。安装后回到主屏幕等待完成，再打开 App。</p>
<p>仅已登记的设备可以安装。覆盖升级请保留原 App，不要卸载。</p>
<small>SHA-256：{release['sha256']}</small></html>''')
    return release


def read_release(path):
    path = Path(path)
    return json.loads(path.read_text()) if path.exists() else None


def check_package(source):
    source = Path(source)
    release = read_release(source/'latest-ios.json')
    if not release or release.get('signed') is not True:
        raise ValueError('缺少已签名发布清单')
    version_tuple(release['version'])
    validate_base_url(release['pageUrl'].removesuffix('/current/latest-ios.json'))
    if digest(source/'latest.ipa') != release['sha256'] or (source/'latest.ipa').stat().st_size != release['size']:
        raise ValueError('待发布 IPA 大小或 SHA-256 不匹配')
    manifest = plistlib.loads((source/'manifest.plist').read_bytes())['items'][0]
    if (manifest['assets'] != [{'kind': 'software-package', 'url': release['downloadUrl']}]
            or manifest['metadata']['bundle-identifier'] != release['bundleId']
            or manifest['metadata']['bundle-version'] != release['buildNumber']):
        raise ValueError('manifest 与发布清单不一致')
    return release


def activate_local(source, root):
    """单个文件系统内先完成版本目录，再用原子 symlink 切换四个固定入口。"""
    source, root = Path(source).resolve(), Path(root).resolve()
    release = check_package(source)
    root.mkdir(parents=True, exist_ok=True)
    with (root/'.publish.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        validate_upgrade(release, read_release(root/'current/latest-ios.json'))
        releases = root/'releases'; releases.mkdir(exist_ok=True)
        dest = releases/release['version']
        if dest.exists():
            raise ValueError('该版本目录已经存在，不能覆盖不可变发布')
        pending = Path(tempfile.mkdtemp(prefix='.pending-', dir=releases))
        link = root/f'.current-{os.urandom(8).hex()}'
        try:
            for name in ('latest.ipa', 'manifest.plist', 'latest-ios.json', 'install.html'):
                shutil.copyfile(source/name, pending/name)
            pending.chmod(0o755)
            for item in pending.iterdir():
                item.chmod(0o644)
            pending.rename(dest)
            link.symlink_to(Path('releases')/release['version'], target_is_directory=True)
            os.replace(link, root/'current')
        finally:
            link.unlink(missing_ok=True)
            shutil.rmtree(pending, ignore_errors=True)
    return release


class HttpsOnlyRedirectHandler(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        if urllib.parse.urlsplit(newurl).scheme != 'https':
            raise ValueError('OTA 不允许重定向到 HTTP')
        return super().redirect_request(req, fp, code, msg, headers, newurl)


def request(url, method='GET'):
    if urllib.parse.urlsplit(url).scheme != 'https':
        raise ValueError('OTA 请求必须使用 HTTPS')
    context = ssl.create_default_context()
    ca_file = os.environ.get('CODEX_MOBILE_OTA_CA_FILE')
    if ca_file:
        context.load_verify_locations(cafile=ca_file)
    response = urllib.request.build_opener(HttpsOnlyRedirectHandler(), urllib.request.HTTPSHandler(context=context)).open(urllib.request.Request(url, method=method,
                                      headers={'Cache-Control': 'no-cache'}), timeout=120)
    if urllib.parse.urlsplit(response.url).scheme != 'https':
        response.close()
        raise ValueError('OTA 不允许重定向到 HTTP')
    return response


def fetch_previous(base):
    try:
        with request(f'{base}/current/latest-ios.json') as response:
            return json.load(response)
    except urllib.error.HTTPError as error:
        if error.code != 404:
            raise
    return None


def verify_published(release, fixed=True):
    """HEAD + 完整 GET，不跳过 TLS 验证，也不依赖浏览器 Cookie。"""
    with request(release['downloadUrl'], 'HEAD') as response:
        if int(response.headers.get('Content-Length', '-1')) != release['size']:
            raise ValueError('远端 IPA HEAD 大小不匹配')
    sha, size = hashlib.sha256(), 0
    with request(release['downloadUrl']) as response:
        while chunk := response.read(1024*1024):
            size += len(chunk); sha.update(chunk)
    if size != release['size'] or sha.hexdigest() != release['sha256']:
        raise ValueError('远端 IPA 完整 GET 校验失败')
    with request(release['manifestUrl']) as response:
        item = plistlib.loads(response.read())['items'][0]
    if (item['metadata']['bundle-identifier'] != release['bundleId']
            or item['metadata']['bundle-version'] != release['buildNumber']
            or item['assets'][0]['url'] != release['downloadUrl']):
        raise ValueError('远端 OTA manifest 不匹配')
    json_url = release['pageUrl'] if fixed else release['manifestUrl'].removesuffix('manifest.plist')+'latest-ios.json'
    with request(json_url) as response:
        remote = json.load(response)
    for key in ('version', 'buildNumber', 'sha256', 'size', 'bundleId', 'teamId', 'applicationIdentifier', 'manifestUrl', 'installUrl',
                'keychainAccessGroups', 'entitlementsSha256', 'identityTransition'):
        if remote.get(key) != release.get(key):
            raise ValueError(f'远端 OTA 清单不匹配：{key}')
    with request(release['installUrl'] if fixed else release['manifestUrl'].removesuffix('manifest.plist')+'install.html') as response:
        if urllib.parse.quote(release['manifestUrl'], safe='') not in response.read().decode():
            raise ValueError('远端安装页没有本版本安装链接')


def publish_ssh(source, host, remote_root):
    if not re.fullmatch(r'[A-Za-z0-9_.@-]+', host) or host.startswith('-'):
        raise ValueError('SSH 主机必须使用已配置的别名或 user@host')
    if not re.fullmatch(r'/[A-Za-z0-9_./-]+', remote_root) or '..' in remote_root.split('/'):
        raise ValueError('服务器目录必须为安全绝对路径')
    release = check_package(source)
    incoming = f'{remote_root}/.incoming-{os.urandom(8).hex()}'
    ssh = ['ssh', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes', host]
    def remote(*args):
        subprocess.run([*ssh, shlex.join(args)], check=True)
    remote('mkdir', '-p', incoming)
    try:
        subprocess.run(['rsync', '-a', '-e',
                        'ssh -o BatchMode=yes -o StrictHostKeyChecking=yes',
                        str(Path(source))+'/', f'{host}:{incoming}/'], check=True)
        subprocess.run(['scp', '-q', '-o', 'BatchMode=yes', '-o', 'StrictHostKeyChecking=yes',
                        str(Path(__file__).resolve()), f'{host}:{incoming}/ios_ota.py'], check=True)
        # 新目录先暴露为不可变版本，固定入口仍指向旧版本；外网回验成功才切换。
        remote('python3', f'{incoming}/ios_ota.py', 'stage', '--source', incoming, '--root', remote_root)
        verify_published(release, fixed=False)
        remote('python3', f'{incoming}/ios_ota.py', 'activate', '--source', incoming, '--root', remote_root)
        verify_published(release)
    finally:
        remote('rm', '-rf', incoming)
    return release


def stage_local(source, root):
    release = check_package(source)
    root = Path(root); root.mkdir(parents=True, exist_ok=True)
    with (root/'.publish.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        validate_upgrade(release, read_release(root/'current/latest-ios.json'))
        dest = root/'releases'/release['version']
        dest.parent.mkdir(exist_ok=True)
        if dest.exists():
            raise ValueError('版本已经存在；使用新版本重试')
        pending = Path(tempfile.mkdtemp(prefix='.pending-', dir=dest.parent))
        try:
            for name in ('latest.ipa', 'manifest.plist', 'latest-ios.json', 'install.html'):
                shutil.copyfile(Path(source)/name, pending/name)
            pending.chmod(0o755)
            for item in pending.iterdir():
                item.chmod(0o644)
            pending.rename(dest)
        finally:
            shutil.rmtree(pending, ignore_errors=True)


def activate_staged(source, root):
    release = check_package(source)
    root = Path(root)
    with (root/'.publish.lock').open('a') as lock:
        fcntl.flock(lock, fcntl.LOCK_EX)
        validate_upgrade(release, read_release(root/'current/latest-ios.json'))
        dest = root/'releases'/release['version']
        if check_package(dest) != release:
            raise ValueError('版本目录与待发布包不一致')
        link = root/f'.current-{os.urandom(8).hex()}'
        try:
            link.symlink_to(Path('releases')/release['version'], target_is_directory=True)
            os.replace(link, root/'current')
        finally:
            link.unlink(missing_ok=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('activate', 'stage'):
        command = commands.add_parser(name)
        command.add_argument('--source', required=True); command.add_argument('--root', required=True)
    latest = commands.add_parser('latest-version')
    latest.add_argument('--base-url', required=True)
    resolve = commands.add_parser('resolve-version')
    resolve.add_argument('--base-url', required=True)
    resolve.add_argument('--floor', required=True)
    resolve.add_argument('--requested')
    publish = commands.add_parser('publish')
    publish.add_argument('--ipa', required=True); publish.add_argument('--base-url', required=True)
    publish.add_argument('--notes', required=True); publish.add_argument('--host', required=True)
    publish.add_argument('--remote-root', required=True)
    args = parser.parse_args()
    if args.command in ('latest-version', 'resolve-version'):
        previous = fetch_previous(validate_base_url(args.base_url))
        current = previous['version'] if previous else None
        print((current or '') if args.command == 'latest-version' else resolve_version(args.floor, current, args.requested))
    elif args.command == 'activate':
        activate_staged(args.source, args.root)
    elif args.command == 'stage':
        stage_local(args.source, args.root)
    else:
        from ios_sign import verify_ipa
        metadata = verify_ipa(args.ipa)
        base = validate_base_url(args.base_url)
        with tempfile.TemporaryDirectory(prefix='codex-mobile-ota-') as tmp:
            source = Path(tmp)/'release'
            create_release(args.ipa, metadata, source, base, args.notes, fetch_previous(base))
            release = publish_ssh(source, args.host, args.remote_root)
            print(json.dumps(release, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError) as error:
        raise SystemExit(f'OTA 发布失败：{error}')
