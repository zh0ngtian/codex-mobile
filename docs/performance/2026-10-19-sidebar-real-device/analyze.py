"""重算真机采样分布；截尾上界保留为无穷，不剔除慢样本。"""
from pathlib import Path
import csv
import json
import math


def nearest_rank(values, probability):
    ordered = sorted(values)
    return ordered[max(0, math.ceil(probability * len(ordered)) - 1)]


def analyze(path):
    rows = list(csv.DictReader(Path(path).open()))
    assert len(rows) == 20
    result = {"samples": len(rows), "percentile_method": "nearest-rank ceil(n*p)", "metrics": {}}
    for key in ["tap_ms", "drawer_ms", "first_visible_ms", "visible_after_drawer_ms", "visible_frame_interval_ms", "all_marker_lower_ms", "all_marker_upper_ms"]:
        values = [float(r[key]) if r[key] else math.inf for r in rows]
        assert key == "all_marker_upper_ms" or all(math.isfinite(v) for v in values)
        stats = {"n": len(values), "min": min(values), "p50": nearest_rank(values, .5), "p90": nearest_rank(values, .9), "p95": nearest_rank(values, .95), "max": max(values)}
        result["metrics"][key] = {k: v if not isinstance(v, float) or math.isfinite(v) else None for k, v in stats.items()}
    result["right_censored_count"] = sum(r["right_censored"] == "True" for r in rows)
    assert result["right_censored_count"] == 1
    result["max_marker_end_lower_bound_ms"] = max(float(r["all_marker_lower_ms"]) for r in rows)
    return result


if __name__ == "__main__":
    print(json.dumps(analyze(Path(__file__).with_name("samples.csv")), ensure_ascii=False, indent=2))
