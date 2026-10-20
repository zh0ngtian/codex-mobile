"""从脱敏 CSV 重算分布；仅依赖标准库，保留截尾样本。"""
from pathlib import Path
import csv
import json
import math


def summarize(path):
    rows = list(csv.DictReader(Path(path).open()))
    assert len(rows) == 40
    assert [int(row["sample"]) for row in rows] == list(range(1, 41))
    result = {"percentile_method": "nearest-rank ceil(n*p)", "cases": {}}
    metrics = ["first_expanded_snapshot_ms", "all_settled_ms",
               "first_expanded_after_web_ms", "all_settled_after_web_ms",
               "web_start_after_launch_ms", "launch_command_ms",
               "thread_read_requests", "thread_list_requests", "directory_requests"]
    for case in ("baseline", "fixed"):
        samples = [row for row in rows if row["case"] == case]
        assert len(samples) == 20
        entry = {"samples": len(samples), "metrics": {}}
        for metric in metrics:
            values = sorted(float(row[metric]) if row[metric] else math.inf for row in samples)
            def rank(probability):
                return values[max(0, math.ceil(len(values) * probability) - 1)]
            stats = {"min": values[0], "p50": rank(.5), "p90": rank(.9), "p95": rank(.95), "max": values[-1]}
            entry["metrics"][metric] = {key: value if math.isfinite(value) else None for key, value in stats.items()}
        for column in ("global_list_requests", "project_errors", "runtime_errors"):
            entry[column] = sum(int(row[column]) for row in samples)
        entry["right_censored_samples"] = sum(row["right_censored"] == "true" for row in samples)
        entry["project_request_before_summary_samples"] = sum(row["project_request_before_summary"] == "true" for row in samples)
        result["cases"][case] = entry
    return result


if __name__ == "__main__":
    print(json.dumps(summarize(Path(__file__).with_name("samples.csv")), ensure_ascii=False, indent=2))
