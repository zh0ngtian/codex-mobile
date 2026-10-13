"""本项目持久凭证与一次版本预留；不创建协调器数据库。"""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import uuid


def read_json(path):
    path = Path(path)
    return json.loads(path.read_text()) if path.is_file() else None


def atomic_json(path, value, *, canonical=False):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    pending = path.with_name('.' + path.name + '-' + uuid.uuid4().hex)
    try:
        with pending.open('x') as stream:
            os.chmod(pending, 0o600)
            json.dump(value, stream, ensure_ascii=False, **({"sort_keys":True} if canonical else {"indent":2}))
            stream.write('\n'); stream.flush(); os.fsync(stream.fileno())
        os.replace(pending, path)
        directory = os.open(path.parent, os.O_RDONLY)
        try: os.fsync(directory)
        finally: os.close(directory)
    finally:
        pending.unlink(missing_ok=True)


def sha256(path):
    digest = hashlib.sha256()
    with Path(path).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''): digest.update(chunk)
    return digest.hexdigest()


def version_code(version):
    if not re.fullmatch(r'\d+\.\d+\.\d+', version or ''): raise ValueError('版本必须为 major.minor.patch')
    major, minor, patch = map(int, version.split('.'))
    code = major * 1000000 + minor * 1000 + patch
    if minor > 999 or patch > 999 or not 0 < code <= 2100000000: raise ValueError('版本超出本项目构建号范围')
    return code


def reserve_version(path, versions, fingerprint):
    """批次 lease 外仍用 flock + 原子写，崩溃和并发重试不再分配。"""
    path = Path(path); path.parent.mkdir(parents=True, exist_ok=True, mode=0o700)
    with path.with_suffix('.lock').open('a') as lock:
        os.chmod(lock.name, 0o600); fcntl.flock(lock, fcntl.LOCK_EX)
        old = read_json(path)
        if old:
            if old['inputFingerprint'] != fingerprint: raise ValueError('预留版本来源 fingerprint 改变')
            return old
        major, minor, patch = map(int, max(versions, key=version_code).split('.'))
        patch += 1
        if patch > 999:
            patch = 0; minor += 1
            if minor > 999: minor = 0; major += 1
        version = f'{major}.{minor}.{patch}'
        result = {'version': version, 'buildNumber': str(version_code(version)), 'inputFingerprint': fingerprint}
        atomic_json(path, result)
        return result
