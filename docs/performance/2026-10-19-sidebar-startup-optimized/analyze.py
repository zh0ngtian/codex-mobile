#!/usr/bin/env python3
"""从同目录的脱敏事件重新生成冷启动边栏分布，不依赖第三方库。"""
import csv
import json
import statistics
from collections import Counter
from pathlib import Path

ROOT = Path(__file__).resolve().parent


def percentile(values, fraction):
    values = sorted(values)
    position = (len(values) - 1) * fraction
    lower = int(position)
    upper = min(lower + 1, len(values) - 1)
    return values[lower] + (values[upper] - values[lower]) * (position - lower)


def describe(values):
    return {"n": len(values), "mean": statistics.mean(values),
            "p50": statistics.median(values), "p90": percentile(values, .9),
            "p95": percentile(values, .95), "min": min(values), "max": max(values)}


def analyze(trials):
    rows = []
    for trial in trials:
        events = trial['events']
        phase = lambda name: [event for event in events if event['phase'] == name]
        list_start, = phase('list-start')
        settled, = phase('list-settled')
        priority, = phase('priority-data')
        projects = phase('project-data')
        snapshots = phase('snapshot')
        first_fresh = next(event for event in snapshots if event['ms'] >= priority['ms'] and event['rows'] > 0)
        first_project = next(event for event in snapshots if event['ms'] >= projects[0]['ms'])
        complete = next(event for event in snapshots if event['ms'] >= settled['ms'])
        requests = phase('fetch-json')
        list_rpc = [event for event in requests if event.get('method') == 'thread/list']
        global_rpc = [event for event in list_rpc if 'project' not in event]
        loaded_start = next(event for event in phase('fetch-start') if event.get('method') == 'thread/loaded/list')
        rate_limits, = [event for event in requests if event.get('method') == 'account/rateLimits/read']
        offset = trial['launchToWebMs']
        row = {
            'sample': trial['sample'],
            'launch_to_web_ms': offset,
            'web_to_list_start_ms': list_start['ms'],
            'list_start_to_loaded_fetch_ms': loaded_start['ms'] - list_start['ms'],
            'loaded_fetch_to_priority_ms': priority['ms'] - loaded_start['ms'],
            'priority_to_all_lists_ms': settled['ms'] - priority['ms'],
            'all_lists_to_snapshot_ms': complete['ms'] - settled['ms'],
            'launch_to_first_fresh_snapshot_ms': offset + first_fresh['ms'],
            'launch_to_first_project_snapshot_ms': offset + first_project['ms'],
            'launch_to_all_lists_snapshot_ms': offset + complete['ms'],
            'refresh_to_first_fresh_snapshot_ms': first_fresh['ms'] - list_start['ms'],
            'refresh_to_all_lists_snapshot_ms': complete['ms'] - list_start['ms'],
            'project_groups': len(projects),
            'project_rows': sum(event['count'] for event in projects),
            'thread_read_requests': sum(event.get('method') == 'thread/read' for event in requests),
            'thread_list_requests': len(list_rpc),
            'global_list_pages': len(global_rpc),
            'global_list_records': sum(event.get('records', 0) for event in global_rpc),
            'project_errors': len(phase('project-error')),
            'fetch_errors': len(phase('fetch-error')),
            'http_or_rpc_errors': sum(event['status'] >= 400 or (event.get('rpcError', False) and not event.get('expectedMissing', False)) for event in requests),
            'launch_command_ms': trial['launchCommandMs'],
            'rate_limit_rpc_ms': rate_limits['duration'],
            'loaded_fetch_while_rate_limit_pending': loaded_start['ms'] < rate_limits['ms'],
            'expected_missing_reads': sum(event.get('expectedMissing', False) for event in requests),
        }
        assert all(row[key] >= 0 for key in row if key.endswith('_ms')), row
        assert len(phase('project-start')) == len(projects), row
        assert complete['connection'] == 'online' and not complete['error'], row
        rows.append({key: round(value, 3) if isinstance(value, float) else value for key, value in row.items()})
    summary = {
        'n': len(rows),
        'metrics_ms': {key: describe([row[key] for row in rows]) for key in rows[0] if key.endswith('_ms')},
        'counts': {key: dict(sorted(Counter(row[key] for row in rows).items())) for key in rows[0] if not key.endswith('_ms') and key != 'sample'},
        'histogram_launch_to_all_lists_seconds': {
            f'[{lower},{lower + 1})': sum(lower <= row['launch_to_all_lists_snapshot_ms'] / 1000 < lower + 1 for row in rows)
            for lower in range(int(min(row['launch_to_all_lists_snapshot_ms'] for row in rows) // 1000), int(max(row['launch_to_all_lists_snapshot_ms'] for row in rows) // 1000) + 1)
        },
    }
    return rows, summary


def save(mode):
    trials = json.loads((ROOT / (mode + '-trials.json')).read_text())
    rows, summary = analyze(trials)
    with (ROOT / (mode + '-samples.csv')).open('w') as file:
        writer = csv.DictWriter(file, fieldnames=rows[0], lineterminator='\n')
        writer.writeheader()
        writer.writerows(rows)
    (ROOT / (mode + '-summary.json')).write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    return summary


if __name__ == '__main__':
    for mode in ['baseline', 'fixed']:
        summary = save(mode)
        print(mode, summary['n'], summary['metrics_ms']['launch_to_all_lists_snapshot_ms'])
