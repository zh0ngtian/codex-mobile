"""复算脱敏采样；分位数采用nearest-rank，不混合数据与视频两组。"""
from pathlib import Path
import csv
import json
import math

root = Path(__file__).parent
with (root / "samples.csv").open() as source:
    samples = list(csv.DictReader(source))
with (root / "visual-samples.csv").open() as source:
    visual = list(csv.DictReader(source))


def distribution(key):
    values = sorted(float(row[key]) for row in samples)
    return {
        "count": len(values),
        "minMs": values[0],
        "p50Ms": values[math.ceil(len(values) * .5) - 1],
        "p95Ms": values[math.ceil(len(values) * .95) - 1],
        "maxMs": values[-1],
    }


assert len(samples) == 20 and len(visual) == 3
assert all(int(row["limit"]) == int(row["finalCount"]) == 5 for row in samples)
assert all(int(row["threadListCount"]) == 1 for row in samples)
assert all(int(row["threadReadCount"]) == int(row["postToggleRpcErrors"]) == 0 for row in samples)
result = {
    "data": {key: distribution(key) for key in
             ("commandToReadyMs", "listRpcMs", "upstreamListMs")},
    "startupInitializeAborts": sum(int(row["startupInitializeAborts"]) for row in samples),
    "visual": {
        "count": len(visual),
        "firstNativeExpansionFrameTo90PercentMs": [float(row["fiveAt90PercentMs"]) for row in visual],
        "firstNativeExpansionFrameTo25PercentMs": [float(row["fiveAt25PercentMs"]) for row in visual],
        "touchToPixelsMeasured": False,
    },
}
print(json.dumps(result, ensure_ascii=False, indent=2))
