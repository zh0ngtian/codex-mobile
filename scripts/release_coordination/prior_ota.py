"""核对独立 OTA 的原始凭证与本批源码祖先，不伪造历史协调批次。"""
import json
from pathlib import PurePosixPath
import re

from .state import version_code


def included_history(adapter):
    index_path = 'release/standalone-ota-history.json'
    if not (adapter.work / index_path).is_file():
        raise ValueError("独立 OTA 历史索引缺失")
    index = json.loads(adapter.git('show', f'{adapter.frozen_sha}:{index_path}'))
    paths = index.get('receipts')
    if index.get('schemaVersion') != 1 or not isinstance(paths, list) or not paths or len(paths) != len(set(paths)):
        raise ValueError('独立 OTA 历史索引无效')
    result = []
    versions = set()
    for path in paths:
        if not isinstance(path, str) or not path.startswith('docs/') or not path.endswith('.json') or '..' in PurePosixPath(path).parts:
            raise ValueError('独立 OTA 凭证必须是仓库内 docs JSON')
        receipt = json.loads(adapter.git('show', f'{adapter.frozen_sha}:{path}'))
        version = receipt.get('version')
        source = receipt.get('sourceCommit', '')
        digest = receipt.get('sha256', '')
        size = receipt.get('size')
        if (receipt.get('distribution') != 'ota-only' or receipt.get('signed') is not True
                or not re.fullmatch(r'[a-f0-9]{40}', source) or not re.fullmatch(r'[a-f0-9]{64}', digest)
                or not isinstance(size, int) or isinstance(size, bool) or size <= 0
                or version in versions or version_code(version) >= version_code(adapter.version)):
            raise ValueError('独立 OTA 凭证缺少有效来源、版本或签名包摘要')
        adapter.git('merge-base', '--is-ancestor', source, adapter.frozen_sha)
        versions.add(version)
        result.append({'receiptPath':path, 'version':version, 'sourceCommit':source, 'size':size,
                       'sha256':digest, 'sourceIncluded':True, 'originalDistribution':'standalone-ota-only'})
    return result
