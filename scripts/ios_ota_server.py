#!/usr/bin/env python3
"""本机 LAN HTTPS OTA 服务；私有 CA 和服务器密钥保存于仓库外。

init 创建一次 CA 和 365 天服务器证书；HTTP bootstrap 仅提供公开 CA 与
mobileconfig。HTTPS 仅提供 ios_ota.py 的四个发布文件，兼容 current 原子链接。
安装 launchd 前先从长期保留的仓库 checkout 执行此脚本。SSL_CERT_FILE 可指向
init 返回的 caFile，以便本机发布工具验证 TLS。没有第三方 Python 依赖。
"""
import argparse
from datetime import datetime, timezone
import hashlib
import ipaddress
import json
import os
from pathlib import Path
import plistlib
import re
import shutil
import ssl
import subprocess
import sys
import tempfile
import threading
import urllib.parse
import uuid
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer

DEFAULT_STATE = Path.home() / 'Library/Application Support/CodexMobile/ota-server'
LABEL = 'local.codex-mobile.ios-ota'
CHANNEL_PREFIX = '/channels/codex-mobile/'
PUBLISHED = {'latest.ipa': 'application/octet-stream', 'manifest.plist': 'application/xml',
             'latest-ios.json': 'application/json', 'install.html': 'text/html; charset=utf-8'}
BOOTSTRAP = {'codex-mobile-ca.cer': 'application/x-x509-ca-cert',
             'codex-mobile-ca.mobileconfig': 'application/x-apple-aspen-config'}


class ServerError(RuntimeError):
    """可公开、不含密钥或工具原始输出的错误。"""


def run(command):
    try:
        return subprocess.run([str(x) for x in command], check=True, capture_output=True, timeout=60).stdout
    except (OSError, subprocess.CalledProcessError, subprocess.TimeoutExpired):
        raise ServerError(f'{Path(str(command[0])).name} 操作失败，请检查本机环境') from None


def private_write(path, data):
    descriptor = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
    with os.fdopen(descriptor, 'wb') as output:
        output.write(data if isinstance(data, bytes) else data.encode('utf-8'))


def validated_state(state):
    state = Path(state).expanduser()
    if state.is_symlink():
        raise ServerError('服务 state 不能使用符号链接')
    state = state.resolve()
    if state == Path('/') or state == Path.home().resolve() or any((p / '.git').exists() for p in (state, *state.parents)):
        raise ServerError('证书 state 必须位于仓库外的独立目录')
    return state


def load_config(state):
    state = validated_state(state)
    try:
        config = json.loads((state / 'config.json').read_text())
        if config['state'] != str(state): raise ValueError()
        if state.stat().st_mode & 0o777 != 0o700: raise ValueError()
        tls = state / 'tls'
        if tls.is_symlink() or tls.stat().st_mode & 0o777 != 0o700: raise ValueError()
        for name in ('ca.pem', 'ca.key', 'server.pem', 'server.key'):
            path = state / 'tls' / name
            if not path.is_file() or path.is_symlink(): raise ValueError()
            if name.endswith('.key') and path.stat().st_mode & 0o777 != 0o600: raise ValueError()
        return config
    except (OSError, ValueError, KeyError):
        raise ServerError('请先 init；服务配置或证书不完整') from None


def init_state(state=DEFAULT_STATE, host='192.168.123.79', https_port=8766, bootstrap_port=8767, channel_root=None):
    state = validated_state(state)
    try: address = str(ipaddress.IPv4Address(host))
    except ipaddress.AddressValueError: raise ServerError('host 必须是 LAN IPv4 地址') from None
    if not all(isinstance(port, int) and 1 <= port <= 65535 for port in (https_port, bootstrap_port)) or https_port == bootstrap_port:
        raise ServerError('HTTPS 与 bootstrap 端口必须不同且介于 1 至 65535')
    channel_root = Path(channel_root).expanduser().resolve() if channel_root else state / 'channels/codex-mobile'
    base = f'https://{address}:{https_port}/channels/codex-mobile'
    config = {'state': str(state), 'host': address, 'httpsPort': https_port, 'bootstrapPort': bootstrap_port,
              'localRoot': str(channel_root), 'caFile': str(state / 'tls/ca.pem'), 'baseUrl': base,
              'installUrl': base + '/current/install.html',
              'bootstrapProfileUrl': f'http://{address}:{bootstrap_port}/codex-mobile-ca.mobileconfig',
              'bootstrapCertificateUrl': f'http://{address}:{bootstrap_port}/codex-mobile-ca.cer'}
    if (state / 'config.json').exists():
        previous = load_config(state)
        if previous != config: raise ServerError('已有 CA 配置不一致；重复 init 不覆盖现有 CA')
        return previous
    if (state / 'tls').exists(): raise ServerError('已有 TLS 目录，拒绝覆盖现有 CA；请检查初始化状态')
    state.mkdir(parents=True, exist_ok=True); state.chmod(0o700)
    with tempfile.TemporaryDirectory(prefix='.initialize-', dir=state) as work:
        root = Path(work); tls = root / 'tls'; tls.mkdir(mode=0o700)
        for name in ('ca.key', 'server.key'): private_write(tls / name, b'')
        root_extensions = root / 'ca.conf'
        private_write(root_extensions, '''[req]
distinguished_name = dn
x509_extensions = root
prompt = no
[dn]
CN = Codex Mobile LAN CA
O = Codex Mobile Local
[root]
basicConstraints = critical,CA:TRUE,pathlen:0
keyUsage = critical,keyCertSign,cRLSign
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid:always
''')
        run(['/usr/bin/openssl', 'req', '-x509', '-newkey', 'rsa:2048', '-nodes', '-sha256',
             '-days', '3650', '-config', root_extensions, '-keyout', tls / 'ca.key', '-out', tls / 'ca.pem'])
        csr = root / 'server.csr'
        run(['/usr/bin/openssl', 'req', '-new', '-newkey', 'rsa:2048', '-nodes', '-sha256',
             '-subj', '/CN=Codex Mobile LAN CA/O=Codex Mobile Local', '-keyout', tls / 'server.key', '-out', csr])
        leaf_extensions = root / 'server.conf'
        private_write(leaf_extensions, f'''[server]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
subjectAltName = IP:{address},IP:127.0.0.1,DNS:localhost
''')
        run(['/usr/bin/openssl', 'x509', '-req', '-in', csr, '-CA', tls / 'ca.pem', '-CAkey', tls / 'ca.key',
             '-set_serial', '0x' + os.urandom(16).hex(), '-days', '365', '-sha256',
             '-extfile', leaf_extensions, '-extensions', 'server', '-out', tls / 'server.pem'])
        public = root / 'public'; public.mkdir(mode=0o755)
        run(['/usr/bin/openssl', 'x509', '-in', tls / 'ca.pem', '-outform', 'DER', '-out', public / 'codex-mobile-ca.cer'])
        ca_data = (public / 'codex-mobile-ca.cer').read_bytes()
        ca_uuid = str(uuid.uuid5(uuid.NAMESPACE_URL, hashlib.sha256(ca_data).hexdigest())).upper()
        profile = {'PayloadType': 'Configuration', 'PayloadVersion': 1,
                   'PayloadIdentifier': 'local.codex-mobile.ota-ca', 'PayloadUUID': str(uuid.uuid4()).upper(),
                   'PayloadDisplayName': 'Codex Mobile LAN CA', 'PayloadRemovalDisallowed': False,
                   'PayloadDescription': '安装后在设置 → 通用 → 关于本机 → 证书信任设置中启用完全信任。',
                   'PayloadContent': [{'PayloadType': 'com.apple.security.root', 'PayloadVersion': 1,
                                       'PayloadIdentifier': 'local.codex-mobile.ota-ca.root', 'PayloadUUID': ca_uuid,
                                       'PayloadDisplayName': 'Codex Mobile LAN CA',
                                       'PayloadCertificateFileName': 'codex-mobile-ca.cer', 'PayloadContent': ca_data}]}
        (public / 'codex-mobile-ca.mobileconfig').write_bytes(plistlib.dumps(profile))
        for path in (tls / 'ca.pem', tls / 'server.pem', *public.iterdir()): path.chmod(0o644)
        for name in ('ca.key', 'server.key'): (tls / name).chmod(0o600)
        channel_root.mkdir(parents=True, exist_ok=True)
        tls.rename(state / 'tls'); public.rename(state / 'public')
        private_write(state / 'config.json', json.dumps(config, ensure_ascii=False, indent=2) + '\n')
    return config


def renew_state(state, restart=False):
    """仅用原 CA/服务器私钥续签 365 天 leaf，原子替换证书后重启已加载服务。"""
    config = load_config(state); state = Path(config['state']); tls = state / 'tls'
    run(['/usr/bin/openssl', 'x509', '-in', tls / 'ca.pem', '-checkend', str(365 * 86400), '-noout'])
    with tempfile.TemporaryDirectory(prefix='.renew-', dir=state) as work:
        root = Path(work); csr = root / 'server.csr'; certificate = root / 'server.pem'
        extensions = root / 'server.conf'
        private_write(extensions, f"""[server]
basicConstraints = critical,CA:FALSE
keyUsage = critical,digitalSignature,keyEncipherment
extendedKeyUsage = serverAuth
subjectKeyIdentifier = hash
authorityKeyIdentifier = keyid,issuer
subjectAltName = IP:{config['host']},IP:127.0.0.1,DNS:localhost
""")
        run(['/usr/bin/openssl', 'req', '-new', '-key', tls / 'server.key', '-sha256',
             '-subj', '/CN=Codex Mobile LAN CA/O=Codex Mobile Local', '-out', csr])
        run(['/usr/bin/openssl', 'x509', '-req', '-in', csr, '-CA', tls / 'ca.pem', '-CAkey', tls / 'ca.key',
             '-set_serial', '0x' + os.urandom(16).hex(), '-days', '365', '-sha256',
             '-extfile', extensions, '-extensions', 'server', '-out', certificate])
        run(['/usr/bin/openssl', 'verify', '-CAfile', tls / 'ca.pem', certificate])
        ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER).load_cert_chain(certificate, tls / 'server.key')
        certificate.chmod(0o644)
        os.replace(certificate, tls / 'server.pem')
    restarted = False
    if restart and status(state)['loaded']:
        run(['/bin/launchctl', 'kickstart', '-k', f'gui/{os.getuid()}/{LABEL}'])
        restarted = True
    return {'renewed': True, 'restarted': restarted, 'caFile': config['caFile'], 'installUrl': config['installUrl']}


def handler(config, bootstrap=False):
    root = Path(config['state']) / 'public' if bootstrap else Path(config['localRoot'])
    root = root.resolve()
    class Handler(BaseHTTPRequestHandler):
        server_version = 'CodexMobileOTA/1.0'
        sys_version = ''
        def log_message(self, *_): pass
        def log_request(self, code='-', size='-'):
            # 响应开始记录，不代表下载完成。只记录 allowlist 路径，不输出查询或 Header。
            path = '[rejected]'
            try:
                parsed = urllib.parse.urlsplit(self.path)
                if not parsed.query and not parsed.fragment:
                    if bootstrap and parsed.path.removeprefix('/') in BOOTSTRAP:
                        path = parsed.path
                    elif not bootstrap and re.fullmatch(
                        re.escape(CHANNEL_PREFIX) + r'(current|releases/\d+\.\d+\.\d+)/(latest\.ipa|manifest\.plist|latest-ios\.json|install\.html)', parsed.path):
                        path = parsed.path
            except ValueError:
                pass
            record = {'event': 'ota_request', 'time': datetime.now(timezone.utc).isoformat(),
                      'remoteAddress': self.client_address[0],
                      'method': self.command if self.command in ('GET', 'HEAD', 'OPTIONS', 'POST') else 'OTHER',
                      'status': code, 'path': path}
            print(json.dumps(record, ensure_ascii=True), file=sys.stderr, flush=True)
        def setup(self):
            self.request.settimeout(15)
            super().setup()
        def do_GET(self): self.respond(False)
        def do_HEAD(self): self.respond(True)
        def do_OPTIONS(self):
            requested = self.headers.get('Access-Control-Request-Method')
            headers = self.headers.get('Access-Control-Request-Headers', '')
            permitted_headers = all(name.strip().lower() in ('content-type', '') for name in headers.split(','))
            if self.headers.get('Origin') != 'null' or requested not in ('GET', 'HEAD') or not permitted_headers:
                self.send_error(403, 'Forbidden'); return
            self.send_response(204)
            self.send_header('Content-Length', '0')
            self.send_header('Access-Control-Allow-Origin', 'null')
            self.send_header('Access-Control-Allow-Methods', 'GET, HEAD')
            if headers: self.send_header('Access-Control-Allow-Headers', 'Content-Type')
            self.send_header('Vary', 'Origin, Access-Control-Request-Method, Access-Control-Request-Headers')
            self.end_headers()
        def respond(self, head):
            try:
                parsed = urllib.parse.urlsplit(self.path)
                raw = parsed.path
                decoded = urllib.parse.unquote(raw, errors='strict')
                if parsed.query or parsed.fragment or '\\' in decoded or '\x00' in decoded or any(p in ('.', '..') for p in decoded.split('/')):
                    raise ValueError()
                if bootstrap:
                    name = decoded.removeprefix('/')
                    if decoded != '/' + name or name not in BOOTSTRAP: raise ValueError()
                    target = root / name; mime = BOOTSTRAP[name]
                else:
                    if not decoded.startswith(CHANNEL_PREFIX): raise ValueError()
                    suffix = decoded[len(CHANNEL_PREFIX):]
                    match = re.fullmatch(r'(current|releases/\d+\.\d+\.\d+)/(latest\.ipa|manifest\.plist|latest-ios\.json|install\.html)', suffix)
                    if not match: raise ValueError()
                    target = root / suffix; mime = PUBLISHED[match.group(2)]
                actual = target.resolve(strict=True)
                if not actual.is_relative_to(root) or not actual.is_file(): raise ValueError()
                with actual.open('rb') as stream:
                    size = os.fstat(stream.fileno()).st_size
                    self.send_response(200)
                    self.send_header('Content-Type', mime); self.send_header('Content-Length', str(size))
                    self.send_header('X-Content-Type-Options', 'nosniff')
                    self.send_header('Cache-Control', 'no-cache' if '/current/' in decoded else 'public, max-age=3600')
                    if self.headers.get('Origin') == 'null':
                        self.send_header('Access-Control-Allow-Origin', 'null')
                        self.send_header('Access-Control-Allow-Methods', 'GET, HEAD')
                        self.send_header('Vary', 'Origin')
                    self.end_headers()
                    if not head: shutil.copyfileobj(stream, self.wfile)
            except (ValueError, UnicodeError, OSError):
                self.send_error(404, 'Not Found')
    return Handler


def create_servers(config, bind_host='0.0.0.0'):
    servers = []
    try:
        secure = ThreadingHTTPServer((bind_host, config['httpsPort']), handler(config))
        servers.append(secure)
        context = ssl.SSLContext(ssl.PROTOCOL_TLS_SERVER)
        context.minimum_version = ssl.TLSVersion.TLSv1_2
        tls = Path(config['state']) / 'tls'
        context.load_cert_chain(tls / 'server.pem', tls / 'server.key')
        secure.socket = context.wrap_socket(secure.socket, server_side=True, do_handshake_on_connect=False)
        servers.append(ThreadingHTTPServer((bind_host, config['bootstrapPort']), handler(config, bootstrap=True)))
        for server in servers: server.daemon_threads = True
        return servers
    except Exception:
        for server in servers: server.server_close()
        raise ServerError('启动 OTA 监听失败，请检查证书或端口占用') from None


def serve(state):
    servers = create_servers(load_config(state))
    try:
        threading.Thread(target=servers[1].serve_forever, daemon=True).start()
        servers[0].serve_forever()
    finally:
        servers[1].shutdown()
        for server in servers: server.server_close()


def launchd_spec(state):
    state = validated_state(state); load_config(state)
    python = str(Path(sys.executable).absolute())
    if 'Cellar' in Path(python).parts:
        stable = shutil.which('python3')
        if not stable or 'Cellar' in Path(stable).parts:
            raise ServerError('请从稳定 Python 路径执行 install，避免 Homebrew 版本目录失效')
        python = str(Path(stable).absolute())
    script = str(Path(__file__).absolute())
    return {'Label': LABEL, 'ProgramArguments': [python, script, 'serve', '--state', str(state)],
            'RunAtLoad': True, 'KeepAlive': True, 'ProcessType': 'Background', 'ThrottleInterval': 10,
            'StandardOutPath': str(state / 'server.stdout.log'), 'StandardErrorPath': str(state / 'server.stderr.log'),
            'EnvironmentVariables': {'PATH': '/usr/bin:/bin', 'PYTHONUNBUFFERED': '1'}}


def install(state):
    spec = launchd_spec(state); state = validated_state(state)
    for name in ('server.stdout.log', 'server.stderr.log'):
        path = state / name
        if not path.exists(): private_write(path, b'')
        path.chmod(0o600)
    agents = Path.home() / 'Library/LaunchAgents'; agents.mkdir(parents=True, exist_ok=True)
    path = agents / (LABEL + '.plist')
    if path.exists(): path.unlink()
    private_write(path, plistlib.dumps(spec))
    domain = f'gui/{os.getuid()}'
    try: run(['/bin/launchctl', 'bootout', domain + '/' + LABEL])
    except ServerError: pass
    run(['/bin/launchctl', 'bootstrap', domain, path])
    run(['/bin/launchctl', 'enable', domain + '/' + LABEL])
    return status(state)


def status(state):
    config = load_config(state)
    try:
        output = run(['/bin/launchctl', 'print', f'gui/{os.getuid()}/{LABEL}']).decode(errors='replace')
        pid = re.search(r'\bpid = (\d+)', output)
        return {'label': LABEL, 'loaded': True, 'running': bool(pid), 'pid': int(pid.group(1)) if pid else None,
                'installUrl': config['installUrl'], 'caFile': config['caFile']}
    except ServerError:
        return {'label': LABEL, 'loaded': False, 'running': False,
                'installUrl': config['installUrl'], 'caFile': config['caFile']}


def main(argv=None):
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    for name in ('init', 'serve', 'install', 'status', 'restart', 'renew'):
        command = commands.add_parser(name); command.add_argument('--state', default=str(DEFAULT_STATE))
        if name == 'init':
            command.add_argument('--host', default='192.168.123.79')
            command.add_argument('--https-port', type=int, default=8766)
            command.add_argument('--bootstrap-port', type=int, default=8767)
            command.add_argument('--channel-root')
    args = parser.parse_args(argv)
    try:
        if args.command == 'init': result = init_state(args.state, args.host, args.https_port, args.bootstrap_port, args.channel_root)
        elif args.command == 'serve': serve(args.state); return 0
        elif args.command == 'install': result = install(args.state)
        elif args.command == 'status': result = status(args.state)
        elif args.command == 'renew': result = renew_state(args.state, restart=True)
        else:
            run(['/bin/launchctl', 'kickstart', '-k', f'gui/{os.getuid()}/{LABEL}']); result = status(args.state)
        print(json.dumps(result, ensure_ascii=False, indent=2)); return 0
    except KeyboardInterrupt: return 0
    except ServerError as error:
        print(f'OTA 服务失败：{error}', file=sys.stderr); return 1
    except Exception:
        print('OTA 服务失败：本机状态异常，请检查初始化与服务状态', file=sys.stderr); return 1


if __name__ == '__main__': sys.exit(main())
