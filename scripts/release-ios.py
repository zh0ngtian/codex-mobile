#!/usr/bin/env python3
"""PakePlus 构建 → Ad Hoc 签名 → HTTPS OTA → 固定 LAN IPA。"""
import argparse
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import subprocess
import sys
import tempfile
import urllib.request

SCRIPTS = Path(__file__).resolve().parent
ROOT = SCRIPTS.parent
sys.path.insert(0, str(SCRIPTS))
from ios_sign import SigningError
from ios_ota import (version_tuple, validate_base_url, fetch_previous, create_release,
                     publish_ssh, validate_upgrade, stage_local, activate_staged, verify_published)

APP_SOURCE_GUIDE = 'https://github.com/zh0ngtian/SignOs/blob/main/cloudflare/app-source/PUBLISH_PROMPT.md'

LAN = 'http://192.168.123.79:8765/channels/codex-mobile'
LAN_PUBLISHER = Path('/Users/zhongtian/WorkSpace/GlobalTranslation/scripts/apk-server.py')


def next_version(versions):
    major, minor, patch = max(map(version_tuple, versions))
    if patch >= 999:
        raise ValueError('patch 已到 999，请明确指定下一 minor 版本')
    return f'{major}.{minor}.{patch+1}'


def require_new_version(version, current_versions):
    major, minor, patch = version_tuple(version)
    if minor > 999 or patch > 999 or major*1_000_000+minor*1000+patch > 2_100_000_000:
        raise ValueError('版本超出双平台构建号范围')
    if any(version_tuple(version) <= version_tuple(current) for current in current_versions):
        raise ValueError('版本必须高于 Android、iOS 固定渠道和 OTA 渠道')


def load_config(path):
    path = Path(path).expanduser().resolve()
    if path.stat().st_mode & 0o077:
        raise ValueError('发布配置包含私有路径，请设置权限 600')
    config = json.loads(path.read_text())
    for key in ('bundleId', 'udid', 'profile', 'p12', 'baseUrl'):
        if not isinstance(config.get(key), str) or not config[key]:
            raise ValueError(f'发布配置缺少 {key}')
    config['baseUrl'] = validate_base_url(config['baseUrl'])
    if config.get('localRoot'):
        if config.get('sshHost') or config.get('remoteRoot'):
            raise ValueError('本机与 SSH 发布配置不能同时使用')
        if not isinstance(config.get('caFile'), str) or not config['caFile']:
            raise ValueError('本机局域网发布需要 caFile 验证 HTTPS')
        raw = Path(config['localRoot']).expanduser()
        config['localRoot'] = str(raw.resolve() if raw.is_absolute() else (path.parent/raw).resolve())
        ca = Path(config['caFile']).expanduser()
        ca = ca.resolve() if ca.is_absolute() else (path.parent/ca).resolve()
        if not ca.is_file():
            raise ValueError('配置文件不存在：caFile')
        config['caFile'] = str(ca)
    else:
        for key in ('sshHost', 'remoteRoot'):
            if not isinstance(config.get(key), str) or not config[key]:
                raise ValueError(f'发布配置缺少 {key}')
    if not config.get('passwordFile') and not config.get('passwordKeychainService'):
        raise ValueError('配置必须指定 passwordFile 或 passwordKeychainService')
    if bool(config.get('compatibilityIpa')) != bool(config.get('compatibilityIpaSha256')):
        raise ValueError('compatibilityIpa 与 compatibilityIpaSha256 必须同时提供')
    if config.get('compatibilityIpa') and (not isinstance(config['compatibilityIpaSha256'], str)
            or not re.fullmatch(r'[0-9a-f]{64}', config['compatibilityIpaSha256'])):
        raise ValueError('compatibilityIpaSha256 必须是 SHA-256 小写十六进制')
    if config.get('restoreInstalledIdentityFromBundleId') and not config.get('compatibilityIpa'):
        raise ValueError('恢复渠道身份需要 compatibilityIpa 基准')
    for key in ('profile', 'p12', 'passwordFile', 'compatibilityIpa'):
        if config.get(key):
            raw = Path(config[key]).expanduser()
            target = raw.resolve() if raw.is_absolute() else (path.parent/raw).resolve()
            if not target.is_file():
                raise ValueError(f'配置文件不存在：{key}')
            if target.stat().st_mode & 0o077:
                raise ValueError(f'{key} 必须使用权限 600')
            config[key] = str(target)
    return config


def restore_identity_transition(config, identity, previous):
    """显式恢复误改的渠道 Bundle ID；目标身份已由签名模块对基准验签。"""
    if not previous or previous['bundleId'] == identity['bundleId']:
        return None
    if (not config.get('compatibilityIpa') or not config.get('compatibilityIpaSha256')
            or config.get('restoreInstalledIdentityFromBundleId') != previous['bundleId']):
        raise ValueError('渠道 Bundle ID 与已安装基准不同；需要显式恢复配置及 compatibilityIpa')
    return {'fromBundleId': previous['bundleId'], 'toBundleId': identity['bundleId'],
            'previousVersion': previous['version'], 'previousSha256': previous.get('sha256'),
            'compatibilityIpaSha256': config['compatibilityIpaSha256']}


def channel_versions():
    versions = []
    for name in ('latest.json', 'latest-ios.json'):
        with urllib.request.urlopen(f'{LAN}/{name}', timeout=15) as response:
            versions.append(json.load(response)['version'])
    return versions


def build_unsigned(version, config, output):
    env = {**os.environ, 'APP_ID': config['bundleId'], 'IOS_OTA_BASE_URL': config['baseUrl']}
    subprocess.run(['node', str(SCRIPTS/'prepare-ios.mjs'), '--version', version], cwd=ROOT, env=env, check=True)
    project = ROOT/'.mobile-build/ios/pakeplus'
    with tempfile.TemporaryDirectory(prefix='codex-mobile-ios-build-') as tmp:
        derived = Path(tmp)/'DerivedData'
        subprocess.run(['xcodebuild', '-project', str(project/'PakePlus.xcodeproj'), '-scheme', 'PakePlus',
                        '-configuration', 'Release', '-sdk', 'iphoneos', '-derivedDataPath', str(derived),
                        'CODE_SIGN_IDENTITY=', 'CODE_SIGNING_REQUIRED=NO', 'CODE_SIGNING_ALLOWED=NO'],
                       cwd=ROOT, env=env, check=True)
        app = derived/'Build/Products/Release-iphoneos/PakePlus.app'
        info_path = app/'Info.plist'
        info = plistlib.loads(info_path.read_bytes())
        info['CodexMobileUpdateURL'] = f"{config['baseUrl']}/current/latest-ios.json"
        info['CodexMobileInstallURL'] = f"{config['baseUrl']}/current/install.html"
        info_path.write_bytes(plistlib.dumps(info))
        package = Path(tmp)/'package'; (package/'Payload').mkdir(parents=True)
        shutil.copytree(app, package/'Payload/PakePlus.app', symlinks=True)
        subprocess.run(['ditto', '-c', '-k', '--keepParent', str(package/'Payload'), str(output)], check=True)


def publish_local(source, root, release):
    """本机也先回验版本目录，再原子切换固定入口。"""
    stage_local(source, root)
    verify_published(release, fixed=False)
    activate_staged(source, root)
    verify_published(release)
    return release


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config', required=True)
    parser.add_argument('--version'); parser.add_argument('--notes', required=True)
    parser.add_argument('--plan', action='store_true', help='仅验证配置、profile、版本与 OTA 签名连续性')
    args = parser.parse_args()
    from ios_sign import read_profile, signing_identity, sign_ipa
    config = load_config(args.config)
    if config.get('caFile'):
        os.environ['CODEX_MOBILE_OTA_CA_FILE'] = config['caFile']
    profile = read_profile(config['profile'])
    compatibility = dict(compatibility_ipa=config.get('compatibilityIpa'),
                         compatibility_ipa_sha256=config.get('compatibilityIpaSha256'))
    identity = signing_identity(profile, config['bundleId'], config['udid'], **compatibility)
    if identity.get('entitlements'):
        identity['keychainAccessGroups'] = identity['entitlements']['keychain-access-groups']
    previous = fetch_previous(config['baseUrl'])
    transition = restore_identity_transition(config, identity, previous)
    if transition:
        identity['identityTransition'] = transition
    versions = channel_versions() + ([previous['version']] if previous else [])
    version = args.version or next_version(versions)
    require_new_version(version, versions)
    major, minor, patch = version_tuple(version)
    build_number = str(major*1_000_000+minor*1000+patch)
    validate_upgrade({**identity, 'version': version, 'buildNumber': build_number}, previous)
    if args.plan:
        print(json.dumps({'version': version, 'bundleId': config['bundleId'],
                          'applicationIdentifier': identity.get('applicationIdentifier'),
                          'keychainAccessGroups': identity.get('keychainAccessGroups'),
                          'identityTransition': transition,
                          'installUrl': config['baseUrl']+'/current/install.html',
                          'appSource': {'status': 'pending', 'instructionsUrl': APP_SOURCE_GUIDE},
                          'steps': ['prepare', 'xcodebuild', 'adhoc-sign', 'https-publish-verify',
                                    'lan-publish-verify']}, indent=2))
        return
    if not LAN_PUBLISHER.is_file():
        raise ValueError('本机缺少固定 LAN 发布脚本；请在更新服务器所在 Mac 执行')
    output = ROOT/'.mobile-build/ota-release'/version
    output.mkdir(parents=True, exist_ok=False)
    unsigned = output/f'CodexMobile-v{version}-unsigned.ipa'
    signed = output/f'CodexMobile-v{version}-adhoc.ipa'
    build_unsigned(version, config, unsigned)
    metadata = sign_ipa(unsigned, signed, config['profile'], config['p12'],
                        password_file=config.get('passwordFile'),
                        password_keychain_service=config.get('passwordKeychainService'),
                        bundle_id=config['bundleId'], udid=config['udid'], **compatibility)
    if transition:
        metadata['identityTransition'] = transition
    unsigned.unlink()
    staging = output/'ota'
    release = create_release(signed, metadata, staging, config['baseUrl'], args.notes, previous)
    if config.get('localRoot'):
        release = publish_local(staging, config['localRoot'], release)
    else:
        release = publish_ssh(staging, config['sshHost'], config['remoteRoot'])
    subprocess.run(['python3', str(LAN_PUBLISHER), 'publish-channel', 'codex-mobile', str(signed),
                    '--version', version, '--notes', args.notes+'（Ad Hoc 已签名）'], check=True)
    with urllib.request.urlopen(LAN+'/latest-ios.json', timeout=15) as response:
        lan_release = json.load(response)
    for key in ('version', 'sha256', 'size'):
        if lan_release[key] != release[key]:
            raise ValueError(f'LAN 发布清单校验失败：{key}')
    with urllib.request.urlopen(urllib.request.Request(LAN+'/latest.ipa', method='HEAD'), timeout=15) as response:
        if int(response.headers['Content-Length']) != release['size']:
            raise ValueError('LAN IPA HEAD 大小不匹配')
    import hashlib
    with urllib.request.urlopen(LAN+'/latest.ipa', timeout=120) as response:
        sha, size = hashlib.sha256(), 0
        while chunk := response.read(1024*1024):
            sha.update(chunk); size += len(chunk)
    if sha.hexdigest() != release['sha256'] or size != release['size']:
        raise ValueError('LAN IPA 完整 GET 校验失败')
    receipt = output / 'ota-release.json'
    receipt.write_text(json.dumps(release, ensure_ascii=False, indent=2) + '\n')
    result = {**release, 'ipaPath': str(signed), 'releaseReceipt': str(receipt),
              'appSource': {'status': 'pending', 'instructionsUrl': APP_SOURCE_GUIDE}}
    print(json.dumps(result, ensure_ascii=False, indent=2))

if __name__ == '__main__':
    try:
        main()
    except (ValueError, OSError, subprocess.CalledProcessError, SigningError) as error:
        raise SystemExit(f'iOS 发布失败：{error}')
