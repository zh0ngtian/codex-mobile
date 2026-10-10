#!/usr/bin/env python3
"""将成功 OTA 发布的同一 Codex Mobile IPA 交给 SignOs 软件源发布器。"""
import argparse
import fcntl
import hashlib
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
from urllib.parse import urlsplit
from urllib.request import Request, urlopen
import zipfile

from ios_ota import version_tuple

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_REPO = Path.home() / 'WorkSpace/SignOs'
BUNDLE_ID = 'vip.loock.codexmobile'
USER_AGENT = 'YaoAppSourcePublisher/1.0'


def digest(path):
    with Path(path).open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def prepare(ipa, receipt_path):
    ipa = Path(ipa)
    receipt = json.loads(Path(receipt_path).read_text())
    if receipt.get('signed') is not True or receipt.get('bundleId') != BUNDLE_ID:
        raise ValueError('需要已签名 Codex Mobile OTA 发布凭证')
    for key in ('version', 'buildNumber', 'notes', 'publishedAt'):
        if not isinstance(receipt.get(key), str) or not receipt[key]:
            raise ValueError(f'OTA 凭证缺少 {key}')
    version_tuple(receipt['version'])
    if not re.fullmatch(r'[1-9][0-9]*', receipt['buildNumber']):
        raise ValueError('OTA 构建号必须是正整数')
    if ipa.stat().st_size != receipt['size'] or digest(ipa) != receipt['sha256']:
        raise ValueError('IPA 大小或 SHA-256 与 OTA 凭证不符')
    with zipfile.ZipFile(ipa) as archive:
        if archive.testzip() is not None:
            raise ValueError('IPA ZIP 损坏')
        names = [n for n in archive.namelist() if re.fullmatch(r'Payload/[^/]+\.app/Info.plist', n)]
        if len(names) != 1:
            raise ValueError('IPA 必须包含一个主应用')
        info = plistlib.loads(archive.read(names[0]))
    if tuple(info[k] for k in ('CFBundleIdentifier', 'CFBundleShortVersionString', 'CFBundleVersion')) != tuple(
            receipt[k] for k in ('bundleId', 'version', 'buildNumber')):
        raise ValueError('IPA 身份、版本或构建号与 OTA 凭证不符')
    return receipt


def check_candidate(source, receipt):
    for app in source['apps']:
        if app['bundleIdentifier'] != receipt['bundleId']:
            continue
        current = (version_tuple(app['version']), int(app['buildVersion']))
        candidate = (version_tuple(receipt['version']), int(receipt['buildNumber']))
        if candidate[0] < current[0] or candidate[1] < current[1]:
            raise ValueError('拒绝将软件源当前版本降级')
        for release in [app, *app.get('versions', [])]:
            if (release['version'], release.get('buildVersion')) == (receipt['version'], receipt['buildNumber']):
                if (release['sha256'], release['size']) != (receipt['sha256'], receipt['size']):
                    raise ValueError('软件源同版本/构建号的 IPA 摘要冲突')


def assets(source, config):
    base = config['baseUrl']
    if source.get('sourceURL') != base + '/source.json':
        raise ValueError('软件源 sourceURL 与目标不符')
    result = {}

    def collect(value):
        if isinstance(value, dict):
            for key, item in value.items():
                if key in ('downloadURL', 'iconURL', 'sourceicon') and item:
                    if not isinstance(item, str) or not item.startswith(base + '/'):
                        raise ValueError('软件源资源地址不在目标源内')
                    path = item[len(base) + 1:]
                    if not re.fullmatch(r'files/[A-Za-z0-9._-]+\.(ipa|png)', path):
                        raise ValueError('软件源资源路径不合法')
                    expected = (value['size'], value['sha256']) if key == 'downloadURL' else None
                    if path in result and result[path] is not None and expected is not None and result[path] != expected:
                        raise ValueError('同一资源的大小或摘要冲突')
                    result[path] = expected or result.get(path)
                else:
                    collect(item)
        elif isinstance(value, list):
            for item in value:
                collect(item)
    collect(source)
    return result


def check_preserved(before, after, receipt):
    for app in before['apps']:
        updated = next((a for a in after['apps'] if a['bundleIdentifier'] == app['bundleIdentifier']), None)
        if app['bundleIdentifier'] != receipt['bundleId']:
            if updated != app:
                raise ValueError('软件源其他应用被意外修改或删除')
        else:
            for old in app.get('versions', []):
                if (old['version'], old.get('buildVersion')) == (receipt['version'], receipt['buildNumber']):
                    continue
                if updated is None or old not in updated.get('versions', []):
                    raise ValueError('软件源历史版本被意外修改或删除')


def published_app(source, receipt):
    matches = [a for a in source['apps'] if a['bundleIdentifier'] == receipt['bundleId']]
    if len(matches) != 1:
        raise ValueError('软件源应恰有一个 Codex Mobile 条目')
    app = matches[0]
    for source_key, receipt_key in (('version', 'version'), ('buildVersion', 'buildNumber'),
                                    ('sha256', 'sha256'), ('size', 'size')):
        if app[source_key] != receipt[receipt_key]:
            raise ValueError('软件源与 OTA 凭证不一致：' + receipt_key)
    return app


def load_settings(signos_repo=DEFAULT_REPO, source_config=None):
    repo = Path(signos_repo).expanduser().resolve(strict=True)
    script = repo / 'scripts/app_source.py'
    if not script.is_file():
        raise ValueError('SignOs 仓库缺少 scripts/app_source.py')
    path = Path(source_config).expanduser() if source_config else repo / 'cloudflare/app-source/source.config.json'
    raw = json.loads(path.read_text())
    # 仅传递发布所需的公开配置；认证只由子进程环境继承。
    config = {key: raw[key] for key in ('name', 'identifier', 'baseUrl', 'root', 'bucket', 'accountId')}
    base = config['baseUrl'].rstrip('/')
    parts = urlsplit(base)
    if (parts.scheme != 'https' or not parts.hostname or parts.username or parts.password
            or parts.query or parts.fragment or parts.path):
        raise ValueError('软件源 baseUrl 必须为 HTTPS 根地址')
    if not re.fullmatch(r'[a-fA-F0-9]{32}', config['accountId']):
        raise ValueError('无效的 Cloudflare accountId')
    if not re.fullmatch(r'[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]', config['bucket']):
        raise ValueError('无效的 R2 bucket')
    root = Path(config['root']).expanduser()
    config.update(baseUrl=base, root=str((root if root.is_absolute() else repo / root).resolve()))
    return dict(script=script, config=config)


def preflight(settings):
    if sys.version_info < (3, 11):
        raise ValueError('软件源发布需要 Python 3.11+')
    if not shutil.which('rclone'):
        raise ValueError('软件源 S3 发布需要 rclone')
    missing = [key for key in ('AWS_ACCESS_KEY_ID', 'AWS_SECRET_ACCESS_KEY') if not os.environ.get(key)]
    if missing:
        raise ValueError('软件源发布缺少环境变量：' + ', '.join(missing))


def read_public(url):
    with urlopen(Request(url, headers={'User-Agent': USER_AGENT}), timeout=30) as response:
        return response.read()


def read_bucket(config):
    result = subprocess.run(['rclone', 'cat', ':s3:' + config['bucket'] + '/source.json',
                             '--s3-provider', 'Cloudflare', '--s3-env-auth', '--s3-no-check-bucket',
                             '--s3-endpoint', 'https://' + config['accountId'] + '.r2.cloudflarestorage.com'],
                            capture_output=True)
    if result.returncode:
        raise ValueError('无法读取 R2 source.json；检查 bucket、网络与 S3 凭据权限')
    return result.stdout


def baseline(config):
    public = read_public(config['baseUrl'] + '/source.json')
    if public != read_bucket(config):
        raise ValueError('公网与 R2 source.json 不一致，停止发布')
    return public


def download(url, target):
    target.parent.mkdir(parents=True, exist_ok=True)
    with urlopen(Request(url, headers={'User-Agent': USER_AGENT}), timeout=120) as response, target.open('wb') as output:
        shutil.copyfileobj(response, output, 1024 * 1024)


def restore_assets(source, config, destination):
    for key, expected in assets(source, config).items():
        target = destination / key
        download(config['baseUrl'] + '/' + key, target)
        if expected and (target.stat().st_size, digest(target)) != expected:
            raise ValueError('历史 IPA 大小或摘要不符：' + key)


def run_cli(script, config_path, *args):
    result = subprocess.run([sys.executable, str(script), '--config', str(config_path), *map(str, args)],
                            capture_output=True)
    if result.returncode:
        raise ValueError(f'SignOs {args[0]} 失败；线上清单可能尚未更新或回验失败，检查在线状态后用原包重试')


def publish(ipa, receipt_path, settings, workdir):
    receipt = prepare(ipa, receipt_path)
    preflight(settings)
    config = settings['config']
    shared = Path(config['root'])
    shared.mkdir(parents=True, exist_ok=True)
    # 与默认 SignOs publish/sync 使用同一锁；其他机器仍须人工排队。
    with (shared / '.publish.lock').open('a') as lock:
        try:
            fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
        except BlockingIOError:
            raise ValueError('软件源正在发布，请排队后重试') from None
        original = baseline(config)
        before = json.loads(original)
        assets(before, config)
        check_candidate(before, receipt)
        workdir = Path(workdir)
        workdir.mkdir(parents=True, exist_ok=True)
        stage = Path(tempfile.mkdtemp(prefix=receipt['version'] + '-', dir=workdir))
        (stage / 'before-source.json').write_bytes(original)
        (stage / 'source.json').write_bytes(original)
        print('软件源发布证据目录：' + str(stage), file=sys.stderr)
        config_path = stage / 'source.config.local.json'
        try:
            restore_assets(before, config, stage)
            config_path.write_text(json.dumps(config | {'root': str(stage)}, ensure_ascii=False))
            run_cli(settings['script'], config_path, 'publish', '--ipa', Path(ipa).resolve(),
                    '--sha256', receipt['sha256'], '--icon', ROOT / 'docs/assets/app-icon/codex-mobile-app-icon-1024.png',
                    '--developer', 'loock-ai / zh0ngtian',
                    '--description', '在手机上查看、继续和管理运行在 Mac 上的 Codex 工作流。',
                    '--notes', receipt['notes'], '--date', receipt['publishedAt'])
            after = json.loads((stage / 'source.json').read_text())
            assets(after, config)
            check_preserved(before, after, receipt)
            published_app(after, receipt)
            if baseline(config) != original:
                raise ValueError('线上清单已变化；保留本次证据，基于最新源重试')
            run_cli(settings['script'], config_path, 'sync', '--transport', 's3')
            online = read_public(config['baseUrl'] + '/source.json')
            if online != (stage / 'source.json').read_bytes():
                raise ValueError('软件源清单已上传，但公网回验不一致')
            app = published_app(json.loads(online), receipt)
            result = dict(sourceURL=config['baseUrl'] + '/source.json', downloadURL=app['downloadURL'],
                          version=receipt['version'], buildNumber=receipt['buildNumber'],
                          size=receipt['size'], sha256=receipt['sha256'])
            (stage / 'verification.json').write_text(json.dumps(result, ensure_ascii=False, indent=2) + '\n')
            return result
        finally:
            config_path.unlink(missing_ok=True)
            # 保留前后清单与回验凭证；可再生的恢复资源无需长期占用磁盘。
            shutil.rmtree(stage / 'files', ignore_errors=True)


def add_arguments(parser):
    parser.add_argument('--signos-repo', default=str(DEFAULT_REPO), help='包含 app_source.py 的 SignOs 仓库')
    parser.add_argument('--source-config', help='软件源公开配置；默认读取 SignOs cloudflare/app-source/source.config.json')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ipa', required=True)
    parser.add_argument('--release-json', required=True, help='成功 OTA 发布的凭证；不接受临时构建包')
    parser.add_argument('--workdir', default=str(ROOT / '.mobile-build/app-source'), help='保留发布前后清单与验收记录')
    parser.add_argument('--plan', action='store_true', help='只读检查包与凭证；不代表在线上传验收')
    add_arguments(parser)
    args = parser.parse_args()
    settings = load_settings(args.signos_repo, args.source_config)
    receipt = prepare(args.ipa, args.release_json)
    if args.plan:
        result = {key: receipt[key] for key in ('bundleId', 'version', 'buildNumber', 'size', 'sha256')}
        result.update(plan=True, sourceURL=settings['config']['baseUrl'] + '/source.json',
                      bucket=settings['config']['bucket'], transport='s3')
    else:
        result = publish(args.ipa, args.release_json, settings, args.workdir)
    print(json.dumps(result, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, KeyError, zipfile.BadZipFile) as error:
        raise SystemExit(f'iOS 软件源发布失败：{error}')
