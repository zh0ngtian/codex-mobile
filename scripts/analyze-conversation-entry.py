#!/usr/bin/env python3
"""检查无用户滚动的会话进入采样，拒绝单帧离开已到达的底部。"""
import argparse
import json
from pathlib import Path


def analyze(trials, tolerance=8):
    reports = []
    for trial in trials:
        frames = [event for event in trial['events'] if event['phase'] == 'native-frame']
        if not frames:
            raise ValueError('缺少native-frame，不能将未采样视为通过')
        reached = False
        visible = 0
        regressions = []
        for index, event in enumerate(frames):
            data = event['data']
            if 'presentationReady' not in data:
                raise ValueError('缺少同一呈现树的几何，不能使用模型位置代替可见帧验收')
            if not data['presentationReady'] or abs(data['shownX']) > 8:
                continue
            visible += 1
            # 短内容保持顶部，长内容对齐可见区底部；全部几何来自同一呈现树。
            target = min(data['viewportBottom'] - data['bottomInset'],
                         data['viewportTop'] + data['topInset'] + data['shownHeight'])
            gap = data['shownBottom'] - target
            if abs(gap) <= 2:
                reached = True
            elif abs(gap) > tolerance:
                regressions.append({'frame': index, 'elapsedMs': event['elapsedMs'], 'gap': gap,
                                    'shownHeight': data['shownHeight'], 'shownBottom': data['shownBottom']})
        reports.append({'threadKey': trial.get('threadKey'), 'frames': len(frames),
                        'visibleFrames': visible,
                        'reachedBottom': reached, 'regressions': regressions,
                        'maximumGap': max((abs(entry['gap']) for entry in regressions), default=0)})
    if not reports:
        raise ValueError('缺少会话采样')
    return {'passed': all(row['reachedBottom'] and not row['regressions'] for row in reports),
            'trials': reports, 'totalFrames': sum(row['frames'] for row in reports),
            'visibleFrames': sum(row['visibleFrames'] for row in reports)}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('profile', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--require-stable', action='store_true')
    args = parser.parse_args()
    result = analyze(json.loads(args.profile.read_text()))
    rendered = json.dumps(result, ensure_ascii=False, indent=2) + '\n'
    if args.output:
        args.output.write_text(rendered)
    print(rendered, end='')
    return 1 if args.require_stable and not result['passed'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
