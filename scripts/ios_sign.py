#!/usr/bin/env python3
"""使用 macOS 系统工具独立完成单 app IPA 的 Ad Hoc 签名。

公开接口：validate_profile、sign_ipa、verify_ipa。profile 的纯数据校验支持 Linux。
密码仅从受限文件或 Keychain 读取，不打印工具参数和工具错误输出。
macOS security import -P / create-keychain -p / set-key-partition-list -k
只能通过进程参数接收密码：同用户或管理员可能读取短暂的进程参数；此模块
不声称消除此系统工具限制。密码不会进入日志或公开 signing.json。
不修改 login/default keychain 或其 search list。暂不支持扩展、多个 app、符号链接。
"""
import argparse
import contextlib
import datetime as dt
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import re
import secrets
import shutil
import stat
import ssl
import subprocess
import sys
import tempfile
import zipfile


class SigningError(RuntimeError):
    """可安全展示给用户、不包含密钥和工具原始输出的失败。"""


def run(command):
    """工具输出仅交给调用者；失败时不回显参数、stdout 或 stderr。"""
    try:
        result = subprocess.run([str(x) for x in command], check=True, capture_output=True, timeout=120)
        return result.stdout
    except (subprocess.CalledProcessError, subprocess.TimeoutExpired, OSError):
        executable = Path(str(command[0])).name
        operation = str(command[1]) if len(command) > 1 and executable == 'security' else ''
        raise SigningError(f'{executable} {operation} 执行失败；请检查凭据和签名环境') from None


def require_macos():
    if sys.platform != 'darwin':
        raise SigningError('IPA 签名及验签需要 macOS security/codesign')


def utc(value):
    if not isinstance(value, dt.datetime):
        raise SigningError('Profile 缺少有效日期')
    return value.replace(tzinfo=dt.timezone.utc) if value.tzinfo is None else value.astimezone(dt.timezone.utc)


def authorized(pattern, value):
    if not isinstance(pattern, str):
        return False
    if '*' not in pattern:
        return pattern == value
    return pattern.count('*') == 1 and pattern.endswith('*') and value.startswith(pattern[:-1])


def validate_profile(profile, bundle_id, udid=None, now=None):
    """校验 Ad Hoc 授权，返回最小 entitlement 和可公开 metadata。

    udid=None 仅用于 verify_ipa 对已有产物的验签；sign_ipa 必须传入目标 UDID。
    App ID prefix 与 Team ID 分别来自对应 profile 字段，不假设两者相同。
    """
    if not isinstance(profile, dict) or not isinstance(bundle_id, str) or not re.fullmatch(r'[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+', bundle_id):
        raise SigningError('Bundle ID 无效')
    ent = profile.get('Entitlements', {})
    if not isinstance(ent, dict):
        raise SigningError('Profile Entitlements 无效')
    devices = profile.get('ProvisionedDevices')
    if not isinstance(devices, list) or not devices or not all(isinstance(x, str) and x for x in devices) or profile.get('ProvisionsAllDevices', False) is not False or ent.get('get-task-allow') is not False:
        raise SigningError('Profile 必须是 Ad Hoc 分发类型')
    expiry = utc(profile.get('ExpirationDate'))
    if expiry <= utc(now or dt.datetime.now(dt.timezone.utc)):
        raise SigningError('Profile 已过期')
    creation = profile.get('CreationDate')
    if creation is not None and utc(creation) > utc(now or dt.datetime.now(dt.timezone.utc)):
        raise SigningError('Profile 尚未生效')
    if udid is not None and udid not in devices:
        raise SigningError('目标 UDID 不在 Profile 授权设备中')
    teams = profile.get('TeamIdentifier')
    prefixes = profile.get('ApplicationIdentifierPrefix')
    certs = profile.get('DeveloperCertificates')
    if not isinstance(teams, list) or len(teams) != 1 or not isinstance(teams[0], str) or not teams[0]:
        raise SigningError('Profile Team ID 无效')
    team = teams[0]
    if ent.get('com.apple.developer.team-identifier') != team:
        raise SigningError('Profile Team ID 与 entitlement 不一致')
    pattern = ent.get('application-identifier', '')
    if not isinstance(pattern, str) or '.' not in pattern or not isinstance(prefixes, list):
        raise SigningError('Profile App ID prefix 无效')
    prefix = pattern.split('.', 1)[0]
    if prefix not in prefixes or not prefix:
        raise SigningError('Profile App ID prefix 与 application-identifier 不一致')
    app_id = f'{prefix}.{bundle_id}'
    if not authorized(pattern, app_id):
        raise SigningError('Bundle ID 不符合 Profile 的 App ID 授权；请显式指定匹配值')
    if not isinstance(certs, list) or not certs or not all(isinstance(x, bytes) and x for x in certs):
        raise SigningError('Profile 缺少授权签名证书')
    groups = ent.get('keychain-access-groups', [])
    if not isinstance(groups, list) or not any(authorized(group, app_id) for group in groups):
        raise SigningError('Profile 不允许目标默认 keychain-access-group')
    minimal = {
        'application-identifier': app_id,
        'com.apple.developer.team-identifier': team,
        'keychain-access-groups': [app_id],
        'get-task-allow': False,
    }
    return {'bundleId': bundle_id, 'teamId': team, 'applicationIdentifier': app_id,
            'profileExpiresAt': expiry.isoformat().replace('+00:00', 'Z'), 'entitlements': minimal}


def read_profile(path):
    """验证 CMS 签名及 Apple 系统根信任链后解析 profile；不导入任何证书。

    security cms -D 仅做解码且可能导入证书，不能用于此信任边界。
    Apple 根仅从系统只读 root keychain 导出；空的 CApath 隔离其它默认信任源。
    """
    require_macos()
    with tempfile.TemporaryDirectory(prefix='codex-profile-verify-') as work:
        root = Path(work)
        anchors = run(['security', 'find-certificate', '-a', '-c', 'Apple Root CA', '-p',
                       '/System/Library/Keychains/SystemRootCertificates.keychain'])
        if not anchors.strip():
            raise SigningError('系统缺少可用的 Apple Root CA')
        ca_file = root / 'apple-roots.pem'
        ca_file.write_bytes(anchors)
        ca_directory = root / 'empty-ca-directory'
        ca_directory.mkdir()
        signer_file = root / 'cms-signer.pem'
        try:
            verified = run(['/usr/bin/openssl', 'cms', '-verify', '-inform', 'DER',
                            '-in', path, '-CAfile', ca_file, '-CApath', ca_directory,
                            '-purpose', 'any', '-binary', '-signer', signer_file])
        except SigningError:
            raise SigningError('Provisioning Profile CMS 签名或 Apple 信任链验证失败') from None
        try:
            signer_pem = signer_file.read_text(encoding='ascii')
            if signer_pem.count('-----BEGIN CERTIFICATE-----') != 1:
                raise SigningError('Profile CMS 必须只有一个 Apple provisioning signer')
            signer_der = ssl.PEM_cert_to_DER_cert(signer_pem)
        except (OSError, ValueError, UnicodeError):
            raise SigningError('Profile CMS 缺少有效 signer 证书') from None
        validate_profile_signer_certificate(signer_der)
        try:
            result = plistlib.loads(verified)
        except (ValueError, plistlib.InvalidFileException):
            raise SigningError('无法读取已验证的 Provisioning Profile') from None
    if not isinstance(result, dict):
        raise SigningError('Provisioning Profile 数据无效')
    return result


def unpack_ipa(path, destination):
    """拒绝路径越界、重复路径、链接和特殊文件，保留 executable 权限。"""
    destination = Path(destination)
    destination.mkdir(parents=True, exist_ok=True)
    try:
        with zipfile.ZipFile(path) as archive:
            seen = set()
            for item in archive.infolist():
                name = item.filename
                parts = PurePosixPath(name).parts
                if not name or '\\' in name or name.startswith('/') or any(p in ('', '.', '..') for p in name.rstrip('/').split('/')) or '/'.join(parts) in seen:
                    raise SigningError('IPA 含不安全或重复归档路径')
                seen.add('/'.join(parts))
                mode = item.external_attr >> 16
                kind = stat.S_IFMT(mode)
                if kind not in (0, stat.S_IFREG, stat.S_IFDIR):
                    raise SigningError('IPA 含符号链接或特殊文件，暂不支持')
                target = destination.joinpath(*parts)
                if not target.resolve().is_relative_to(destination.resolve()):
                    raise SigningError('IPA 归档路径越界')
                if item.is_dir():
                    target.mkdir(parents=True, exist_ok=True)
                else:
                    target.parent.mkdir(parents=True, exist_ok=True)
                    with archive.open(item) as source, target.open('wb') as output:
                        shutil.copyfileobj(source, output)
                    target.chmod((mode & 0o777) or 0o644)
    except (zipfile.BadZipFile, OSError, RuntimeError) as error:
        if isinstance(error, SigningError):
            raise
        raise SigningError('IPA 解包失败') from None
    apps = [p for p in destination.rglob('*.app') if p.is_dir()]
    if len(apps) != 1 or apps[0].parent != destination / 'Payload':
        raise SigningError('IPA 必须仅包含 Payload 下的一个主 app')
    if any(destination.rglob('*.appex')) or any(destination.rglob('*.xpc')):
        raise SigningError('暂不支持 IPA 中的 extension 或 XPC bundle')
    if not (apps[0] / 'Info.plist').is_file():
        raise SigningError('主 app 缺少 Info.plist')
    return apps[0]


def read_bundle_id(app):
    try:
        info = plistlib.loads((app / 'Info.plist').read_bytes())
        bundle_id = info['CFBundleIdentifier']
        if not isinstance(bundle_id, str):
            raise ValueError()
        return bundle_id
    except (OSError, KeyError, ValueError, plistlib.InvalidFileException):
        raise SigningError('主 app Bundle ID 无效') from None


def validate_signed_entitlements(entitlements, expected):
    if entitlements != expected['entitlements']:
        raise SigningError('签名 entitlement 与 Bundle ID/Profile 的最小授权不一致')


def der_item(data, offset=0):
    """读取 DER TLV，仅用于 X.509 有效期，无外部 Python 依赖。"""
    if offset + 2 > len(data):
        raise SigningError('签名证书 DER 无效')
    tag, length = data[offset], data[offset + 1]
    start = offset + 2
    if length & 0x80:
        count = length & 0x7f
        if count == 0 or count > 4 or start + count > len(data):
            raise SigningError('签名证书 DER 长度无效')
        length = int.from_bytes(data[start:start + count], 'big'); start += count
    end = start + length
    if end > len(data):
        raise SigningError('签名证书 DER 截断')
    return tag, data[start:end], end


def validate_profile_signer_certificate(certificate):
    """在已验证的 Apple root chain 上要求 provisioning 专用 leaf marker。

    此 iOS profile signer 使用 1.2.840.113635.100.6.58 (DER NULL)。
    Apple Developer Distribution 证书虽有 Apple 根链，但没有此专用 marker，
    不能作为 profile 的签名者。不按证书 CN 猜测签名权限。
    """
    marker = bytes.fromhex('2a864886f76364063a')
    try:
        tag, outer, end = der_item(certificate)
        if tag != 0x30 or end != len(certificate): raise ValueError()
        tag, tbs, _ = der_item(outer)
        if tag != 0x30: raise ValueError()
        offset = 0; extension_containers = []; authorized_markers = 0
        while offset < len(tbs):
            tag, value, offset = der_item(tbs, offset)
            if tag == 0xa3: extension_containers.append(value)
        if len(extension_containers) != 1: raise ValueError()
        tag, extensions, end = der_item(extension_containers[0])
        if tag != 0x30 or end != len(extension_containers[0]): raise ValueError()
        offset = 0
        while offset < len(extensions):
            tag, extension, offset = der_item(extensions, offset)
            if tag != 0x30: raise ValueError()
            tag, oid, next_offset = der_item(extension)
            if tag != 6: raise ValueError()
            if oid != marker: continue
            tag, value, next_offset = der_item(extension, next_offset)
            if tag == 1:
                if value != b'\x00': raise ValueError()
                tag, value, next_offset = der_item(extension, next_offset)
            if tag != 4 or value != b'\x05\x00' or next_offset != len(extension): raise ValueError()
            authorized_markers += 1
        if authorized_markers != 1: raise ValueError()
    except (ValueError, IndexError):
        raise SigningError('CMS signer 不是 Apple provisioning 专用签名证书') from None


def certificate_validity(certificate, now=None):
    """解析并检查 X.509 notBefore/notAfter；macOS find-identity 再校验签名身份。"""
    try:
        tag, outer, end = der_item(certificate)
        if tag != 0x30 or end != len(certificate):
            raise ValueError()
        tag, tbs, _ = der_item(outer)
        if tag != 0x30:
            raise ValueError()
        offset = 0
        tag, _, next_offset = der_item(tbs)
        if tag == 0xa0: offset = next_offset
        # serialNumber, signature, issuer precede validity.
        for _ in range(3): _, _, offset = der_item(tbs, offset)
        tag, validity, _ = der_item(tbs, offset)
        if tag != 0x30: raise ValueError()
        dates = []; offset = 0
        for _ in range(2):
            tag, value, offset = der_item(validity, offset)
            if tag not in (0x17, 0x18): raise ValueError()
            text = value.decode('ascii')
            if tag == 0x17:
                year = int(text[:2]); year += 1900 if year >= 50 else 2000
                text = str(year) + text[2:]
            dates.append(dt.datetime.strptime(text, '%Y%m%d%H%M%SZ').replace(tzinfo=dt.timezone.utc))
        if offset != len(validity): raise ValueError()
    except (ValueError, UnicodeError, IndexError):
        raise SigningError('签名证书有效期数据无效') from None
    current = utc(now or dt.datetime.now(dt.timezone.utc))
    if not dates[0] <= current < dates[1]:
        raise SigningError('签名证书已过期或尚未生效')
    return dates


@contextlib.contextmanager
def temporary_keychain(directory):
    """显式传递临时 keychain 路径，finally 销毁；不设置系统搜索列表。"""
    keychain = Path(directory) / 'signing.keychain-db'
    password = secrets.token_urlsafe(32)
    try:
        run(['security', 'create-keychain', '-p', password, keychain])
        run(['security', 'set-keychain-settings', '-lut', '3600', keychain])
        run(['security', 'unlock-keychain', '-p', password, keychain])
        yield keychain, password
    finally:
        # 尝试系统删除；失败时也删除本次临时目录中的数据库文件。
        try:
            run(['security', 'delete-keychain', keychain])
        finally:
            keychain.unlink(missing_ok=True)


@contextlib.contextmanager
def compatible_pkcs12(p12, password, directory):
    """重新封装为 macOS 可导入的 3DES/SHA1 P12；私钥中间态始终加密。

    源 P12 的密码仅通过 0600 临时文件提供给 OpenSSL。加密 PEM 和兼容 P12
    使用新的随机密码，保存于 0700 临时目录，离开上下文（含失败）即全部清理。
    仅对本次临时容器使用兼容算法，不修改源 P12 或证书授权规则。
    """
    with tempfile.TemporaryDirectory(prefix='pkcs12-compatible-', dir=directory) as work:
        root = Path(work)
        root.chmod(0o700)
        original_secret = root / 'source-password'
        conversion_secret = root / 'conversion-password'
        export_secret = root / 'export-password'
        encrypted_pem = root / 'encrypted-private-material.pem'
        converted = root / 'compatible.p12'
        conversion_password = secrets.token_urlsafe(32)
        for path, content in ((original_secret, password), (conversion_secret, conversion_password),
                              (export_secret, conversion_password),
                              (encrypted_pem, ''), (converted, '')):
            descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            with os.fdopen(descriptor, 'w', encoding='utf-8') as file:
                file.write(content)
        run(['/usr/bin/openssl', 'pkcs12', '-in', p12,
             '-passin', 'file:' + str(original_secret), '-des3',
             '-passout', 'file:' + str(conversion_secret), '-out', encrypted_pem])
        run(['/usr/bin/openssl', 'pkcs12', '-export', '-in', encrypted_pem,
             '-passin', 'file:' + str(conversion_secret), '-passout', 'file:' + str(export_secret),
             '-keypbe', 'PBE-SHA1-3DES', '-certpbe', 'PBE-SHA1-3DES', '-macalg', 'sha1',
             '-out', converted])
        yield converted, conversion_password


def import_identity(p12, password, keychain, keychain_password, profile, directory):
    with compatible_pkcs12(p12, password, directory) as (container, container_password):
        run(['security', 'import', container, '-k', keychain, '-f', 'pkcs12', '-P', container_password,
             '-x', '-T', '/usr/bin/codesign', '-T', '/usr/bin/security'])
    run(['security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:',
         '-s', '-k', keychain_password, keychain])
    identities = run(['security', 'find-identity', '-v', '-p', 'codesigning', keychain]).decode('utf-8', errors='replace')
    authorized_certs = {hashlib.sha1(cert).hexdigest().upper(): cert for cert in profile['DeveloperCertificates']}
    matches = set(re.findall(r'^\s*\d+\) ([0-9A-Fa-f]{40})\s+"', identities, re.MULTILINE))
    permitted = sorted(x.upper() for x in matches if x.upper() in authorized_certs)
    if len(permitted) != 1:
        raise SigningError('P12 必须含一个由 Profile 授权的有效私钥/签名证书身份')
    identity = permitted[0]
    certificate_validity(authorized_certs[identity])
    # 实际 codesign 会验证私钥可用；find-identity 仅返回具有私钥的身份。
    return identity


def read_password(password_file=None, password_keychain_service=None):
    if bool(password_file) == bool(password_keychain_service):
        raise SigningError('必须且只能提供一个密码来源')
    if password_file:
        path = Path(password_file)
        try:
            if not path.is_file() or path.is_symlink():
                raise SigningError('密码文件必须是普通文件')
            if path.stat().st_mode & 0o077:
                raise SigningError('密码文件权限必须为 0600 或更严格')
            return path.read_text(encoding='utf-8').rstrip('\r\n')
        except (OSError, UnicodeError):
            raise SigningError('无法读取密码文件') from None
    try:
        return run(['security', 'find-generic-password', '-s', password_keychain_service, '-w']).decode('utf-8').rstrip('\r\n')
    except UnicodeError:
        raise SigningError('Keychain 密码编码无效') from None


def verify_app(app, directory):
    run(['codesign', '--verify', '--deep', '--strict', app])
    bundle_id = read_bundle_id(app)
    expected = validate_profile(read_profile(app / 'embedded.mobileprovision'), bundle_id)
    try:
        entitlements = plistlib.loads(run(['codesign', '-d', '--entitlements', ':-', app]))
    except (ValueError, plistlib.InvalidFileException):
        raise SigningError('无法读取已签名 entitlement') from None
    validate_signed_entitlements(entitlements, expected)
    try:
        info = plistlib.loads((app / 'Info.plist').read_bytes())
    except (OSError, ValueError, plistlib.InvalidFileException):
        raise SigningError('主 app Info.plist 无效') from None
    for key, expected_value in [('CodexMobileTeamID', expected['teamId']),
                                ('CodexMobileApplicationIdentifier', expected['applicationIdentifier'])]:
        if key in info and info[key] != expected_value:
            raise SigningError('Info.plist 发布身份与实际签名不一致')
    version, build = info.get('CFBundleShortVersionString'), info.get('CFBundleVersion')
    if not isinstance(version, str) or not version or not isinstance(build, str) or not build:
        raise SigningError('签名 IPA 必须含字符串 version 和 buildNumber')
    prefix = Path(directory) / 'signer-'
    run(['codesign', '-d', '--extract-certificates=' + str(prefix), app])
    try:
        leaf = Path(str(prefix) + '0').read_bytes()
    except OSError:
        raise SigningError('IPA 没有可验证的签名证书') from None
    certificate_validity(leaf)
    profile = read_profile(app / 'embedded.mobileprovision')
    if not any(leaf == cert for cert in profile['DeveloperCertificates']):
        raise SigningError('IPA 签名证书未获得嵌入 Profile 授权')
    return {key: value for key, value in expected.items() if key != 'entitlements'} | {'signed': True, 'version': version, 'buildNumber': build}


def verify_ipa(path):
    """独立验签 IPA；不依赖 .signing.json 或原始 P12，返回可公开 metadata。"""
    require_macos()
    with tempfile.TemporaryDirectory(prefix='codex-ipa-verify-') as work:
        root = Path(work)
        return verify_app(unpack_ipa(path, root / 'unpacked'), root)


def pack_ipa(root, output):
    with zipfile.ZipFile(output, 'w', compression=zipfile.ZIP_DEFLATED) as archive:
        for path in sorted(Path(root).rglob('*')):
            if path.is_file(): archive.write(path, path.relative_to(root).as_posix())


def sign_ipa(ipa, output, profile, p12, *, password_file=None,
             password_keychain_service=None, bundle_id=None, udid=None):
    """签名单 app，验证归档后原子安装 output 与 output.signing.json。

    不覆盖已有 output，避免失败后旧成功产物被误当作本次成功。
    调用者可使用全新暂存路径，再通过发布步骤覆盖固定渠道。
    """
    require_macos()
    ipa, output, profile, p12 = map(Path, (ipa, output, profile, p12))
    sidecar = Path(str(output) + '.signing.json')
    if output.exists() or sidecar.exists() or ipa.resolve() == output.resolve():
        raise SigningError('签名输出必须使用尚不存在的新路径')
    if not bundle_id or not udid:
        raise SigningError('签名必须显式提供 --bundle-id 和 --udid')
    output.parent.mkdir(parents=True, exist_ok=True)
    published = False
    try:
        data = read_profile(profile)
        expected = validate_profile(data, bundle_id, udid)
        password = read_password(password_file, password_keychain_service)
        with tempfile.TemporaryDirectory(prefix='.codex-ios-sign-', dir=output.parent) as work:
            root = Path(work); unpacked = root / 'unpacked'
            app = unpack_ipa(ipa, unpacked)
            info_path = app / 'Info.plist'
            info = plistlib.loads(info_path.read_bytes())
            info['CFBundleIdentifier'] = bundle_id
            info['CodexMobileTeamID'] = expected['teamId']
            info['CodexMobileApplicationIdentifier'] = expected['applicationIdentifier']
            info_path.write_bytes(plistlib.dumps(info))
            shutil.copyfile(profile, app / 'embedded.mobileprovision')
            entitlements = root / 'entitlements.plist'
            entitlements.write_bytes(plistlib.dumps(expected['entitlements']))
            with temporary_keychain(root) as (keychain, keychain_password):
                identity = import_identity(p12, password, keychain, keychain_password, data, root)
                # 深层 framework/dylib 优先签名，最后封装外层 resource seal。
                nested = [p for p in app.rglob('*') if (p.is_dir() and p.suffix == '.framework') or (p.is_file() and p.suffix == '.dylib')]
                for component in sorted(nested, key=lambda p: len(p.parts), reverse=True):
                    run(['codesign', '--force', '--sign', identity, '--keychain', keychain, '--timestamp=none', component])
                run(['codesign', '--force', '--sign', identity, '--keychain', keychain,
                     '--entitlements', entitlements, '--generate-entitlement-der', '--timestamp=none', app])
                metadata = verify_app(app, root)
                candidate = root / 'signed.ipa'
                pack_ipa(unpacked, candidate)
                # 再解包最终 archive 验证，确保 zip 未丢失文件/权限/签名。
                final_metadata = verify_ipa(candidate)
                if metadata != final_metadata:
                    raise SigningError('IPA 归档前后签名 metadata 不一致')
            staged_json = root / 'signing.json'
            staged_json.write_text(json.dumps(metadata, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
            os.replace(candidate, output); published = True
            os.replace(staged_json, sidecar)
        return metadata
    except BaseException:
        if published:
            output.unlink(missing_ok=True); sidecar.unlink(missing_ok=True)
        raise


def parse_args(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--verify-ipa', help='独立检查已有 IPA，仅可单独使用此参数')
    parser.add_argument('--ipa')
    parser.add_argument('--output')
    parser.add_argument('--profile')
    parser.add_argument('--p12')
    secret = parser.add_mutually_exclusive_group()
    secret.add_argument('--password-file', help='权限 0600 的密码文件；不会写入日志')
    secret.add_argument('--password-keychain-service', help='macOS Keychain generic password service')
    parser.add_argument('--bundle-id')
    parser.add_argument('--udid')
    args = parser.parse_args(argv)
    signing_fields = ('ipa', 'output', 'profile', 'p12', 'bundle_id', 'udid',
                      'password_file', 'password_keychain_service')
    if args.verify_ipa is not None:
        if any(getattr(args, name) is not None for name in signing_fields):
            parser.error('--verify-ipa 不能同时提供签名参数')
        return args
    missing = [name for name in signing_fields[:6] if not getattr(args, name)]
    if missing:
        parser.error('签名必须提供：' + ', '.join('--' + name.replace('_', '-') for name in missing))
    if args.password_file is None and args.password_keychain_service is None:
        parser.error('签名必须提供 --password-file 或 --password-keychain-service')
    return args


def main(argv=None):
    args = parse_args(argv)
    try:
        if args.verify_ipa is not None:
            metadata = verify_ipa(args.verify_ipa)
        else:
            metadata = sign_ipa(args.ipa, args.output, args.profile, args.p12,
                            password_file=args.password_file,
                            password_keychain_service=args.password_keychain_service,
                            bundle_id=args.bundle_id, udid=args.udid)
        print(json.dumps(metadata, ensure_ascii=False))
        return 0
    except SigningError as error:
        print(f'签名失败：{error}', file=sys.stderr)
        return 1
    except Exception:
        # 防止意外异常 traceback 包含敏感工具参数。
        print('签名失败：产物或系统环境异常，未产生成功输出', file=sys.stderr)
        return 1


if __name__ == '__main__':
    sys.exit(main())
