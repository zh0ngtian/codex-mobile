#!/usr/bin/env python3
"""将DEBUG会话计时转换为脱敏报告；不依赖第三方包。"""
import argparse
import csv
import json
import statistics as stats
from pathlib import Path
from datetime import datetime
from zoneinfo import ZoneInfo


def percentile(values, ratio):
    ordered = sorted(values)
    at = (len(ordered) - 1) * ratio
    lower = int(at)
    upper = min(lower + 1, len(ordered) - 1)
    return ordered[lower] * (upper - at) + ordered[upper] * (at - lower) if upper != lower else ordered[lower]


def analyze(raw, output):
    raw.sort(key=lambda value: value['startedAtMs'])
    warmups = set()
    samples = []
    anonymous = []
    for trial in raw:
        if trial['mode'] == 'repeat' and trial['threadKey'] not in warmups:
            warmups.add(trial['threadKey'])
            continue
        events = {entry['phase']: entry for entry in trial['events']}
        base = events['native-command']['elapsedMs']
        moment = lambda key: events[key]['elapsedMs'] - base
        rpc_start = next(entry['elapsedMs'] - base for entry in trial['events'] if entry['phase'] == 'rpc-start')
        stages = {
            'dispatch': rpc_start,
            'primary_rpc': moment('details-ready') - rpc_start,
            'react_publish': moment('js-ready-snapshot') - moment('details-ready'),
            'webkit_bridge': moment('native-snapshot') - moment('js-ready-snapshot'),
            'serialize': moment('native-serialized') - moment('native-snapshot'),
            'decode': moment('native-decoded') - moment('native-serialized'),
            'projection': moment('native-projected') - moment('native-decoded'),
            'first_layout_display': moment('native-first-frame') - moment('native-projected'),
        }
        assert abs(sum(stages.values()) - moment('native-first-frame')) < 0.001
        assert min(stages.values()) > -2, '跨进程时钟差超出校准精度'
        rpc = [entry['data'] for entry in trial['events'] if entry['phase'] == 'rpc-end']
        sample = {'sample': len(samples) + 1, 'mode': trial['mode'], 'details_ms': moment('details-ready'),
                  'first_frame_ms': moment('native-first-frame'), 'stable_ms': moment('native-stable'),
                  'resume_ms': next(value['durationMs'] for value in rpc if value['method'] == 'thread/resume'),
                  'history_ms': next((value['durationMs'] for value in rpc if value['method'] == 'thread/turns/list'), 0),
                  'snapshot_bytes': events['native-serialized']['data']['bytes'], **stages}
        samples.append(sample)
        anonymous.append({'sample': sample['sample'], 'mode': sample['mode'], 'events': [
            {'phase': entry['phase'], 'elapsedMs': round(entry['elapsedMs'] - base, 3),
             'data': {key: value for key, value in entry['data'].items() if key != 'confirmedAtMs'}} for entry in trial['events']]})
    output.mkdir(parents=True, exist_ok=True)
    with (output / 'samples.csv').open('w') as file:
        writer = csv.DictWriter(file, fieldnames=list(samples[0])); writer.writeheader(); writer.writerows(samples)
    (output / 'trials.json').write_text(json.dumps(anonymous, ensure_ascii=False, indent=2) + '\n')
    summary = {}
    for mode in ['repeat', 'process-first']:
        subset = [sample for sample in samples if sample['mode'] == mode]
        summary[mode] = {'n': len(subset), 'metrics': {}, 'mean_stages': {key: stats.mean(sample[key] for sample in subset) for key in stages}}
        for key in ['details_ms', 'first_frame_ms', 'stable_ms', 'resume_ms', 'history_ms']:
            values = [sample[key] for sample in subset]
            summary[mode]['metrics'][key] = {'mean': stats.mean(values), 'p50': stats.median(values), 'p90': percentile(values, .9), 'min': min(values), 'max': max(values)}
    (output / 'summary.json').write_text(json.dumps(summary, ensure_ascii=False, indent=2) + '\n')
    first_snapshot = next(entry['data'] for entry in raw[0]['events'] if entry['phase'] == 'js-ready-snapshot')
    target_count = len({trial['threadKey'] for trial in raw})
    resume_ranges = {mode: (min(sample['resume_ms'] for sample in samples if sample['mode'] == mode), max(sample['resume_ms'] for sample in samples if sample['mode'] == mode)) for mode in summary}
    start = datetime.fromtimestamp(raw[0]['startedAtMs'] / 1000, ZoneInfo('Asia/Shanghai'))
    end = datetime.fromtimestamp(raw[-1]['startedAtMs'] / 1000, ZoneInfo('Asia/Shanghai'))
    lines = ['# 当前关注会话加载耗时', '', f'测量日期：{start:%Y-%m-%d %H:%M:%S}—{end:%H:%M:%S}（Asia/Shanghai）。', '',
             '- 环境：iPhone 17 Pro、iOS 26.5、竖屏，保留现有系统及App设置；0.3.6（3006）Debug，源码基于06d22ff，仅增加显式启用的测量探针。',
             f'- 对象：当前所选设备范围内的{target_count}条关注会话；初次就绪快照为{first_snapshot["messages"]}条消息、{first_snapshot["textChars"]}个JS文本字符，最近5个回合。公开数据不包含标题、正文、原始会话ID、网关或凭据。',
             f'- 同进程重开{summary["repeat"]["n"]}次；另有{len(warmups)}次预热已排除。进程重启后首次点开{summary["process-first"]["n"]}次，点击前已完成App启动和网关连接；不清理服务端缓存。',
             '- 起点为原生thread.open派发。新数据首帧是本次请求的ready快照投影后，下一个显示机会；不是旧缓存内容刚出现，也不保证图片全部下载完成。CADisplayLink端点为显示机会，非屏幕合成器的像素级呈现证明。',
             '- 稳定终点为最后一次相关RPC完成/原生快照更新/内容几何或位置变化；随后300ms无变化且无未完成RPC才确认，报告耗时已扣除这300ms判定窗口。',
             '- RPC耗时包含客户端传输、网络往返和网关/服务端处理，无法据此单独拆出服务端CPU。JS和原生时钟有约1ms粒度差，表中按ms取整。', '',
             '## 分布（毫秒）', '', '| 场景 | n | 指标 | 中位数 | P90 | 最小—最大 |', '| --- | ---: | --- | ---: | ---: | ---: |']
    names = {'repeat': '同进程重开', 'process-first': '重启后首次点开'}
    metrics = {'details_ms': '核心会话数据返回', 'first_frame_ms': '新数据首帧机会', 'stable_ms': '补齐及界面稳定'}
    for mode, data in summary.items():
        for key, title in metrics.items():
            m = data['metrics'][key]
            lines.append(f"| {names[mode]} | {data['n']} | {title} | {m['p50']:.0f} | {m['p90']:.0f} | {m['min']:.0f}—{m['max']:.0f} |")
    lines += ['', '## 到新数据首帧的阶段分摊', '', '以下为每阶段均值及占首帧平均耗时的比例；阶段均值可以相加，分位数不作相加。', '', '| 阶段 | 重开均值 | 占比 | 重启后首次均值 | 占比 |', '| --- | ---: | ---: | ---: | ---: |']
    labels = {'dispatch': '原生派发及JS调度到首个请求', 'primary_rpc': '核心RPC及结果归一化', 'react_publish': 'React状态/业务投影及快照调度', 'webkit_bridge': 'WebKit快照桥接/原生排队', 'serialize': '快照JSON序列化', 'decode': 'Swift快照解码', 'projection': 'Store与AgentSession投影', 'first_layout_display': '原生布局到下一显示机会'}
    for key, title in labels.items():
        a, b = [summary[mode]['mean_stages'][key] for mode in names]
        ar = a / summary['repeat']['metrics']['first_frame_ms']['mean'] * 100
        br = b / summary['process-first']['metrics']['first_frame_ms']['mean'] * 100
        lines.append(f'| {title} | {a:.1f}ms | {ar:.1f}% | {b:.1f}ms | {br:.1f}% |')
    lines += ['', '## 原始结果与限制', '', '- [逐次样本](samples.csv)、[脱敏阶段事件](trials.json)、[统计JSON](summary.json)。P90使用线性插值；3次首次点开的P90仅作观察，不能作为稳定SLA。',
              f'- 同进程重开的首个thread/resume为{resume_ranges["repeat"][0]:.0f}—{resume_ranges["repeat"][1]:.0f}ms，而重启后的{summary["process-first"]["n"]}次为{resume_ranges["process-first"][0]:.0f}—{resume_ranges["process-first"][1]:.0f}ms；这次采样不是服务端冷缓存对照，不能据此推断“冷启动更快”。',
              '- 探针只在DEBUG参数开启时工作；不记录正文或连接信息，不发送消息，没有新建测试会话。自动化等待不计入指标，但Debug构建、模拟器和轻量探针对绝对数值仍有影响。',
              '- 首帧之后的尾段包含并行历史详情补齐、后续快照和布局/过渡；不能把它全部当成绘制CPU开销。',
              '- 未采样ETTrace CPU火焰图，因此本报告只给出墙钟时间分解，不把时间占比解释为CPU占比。', '']
    (output / 'README.md').write_text('\n'.join(lines))
    print(json.dumps(summary, ensure_ascii=False, indent=2))


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('input', type=Path)
    parser.add_argument('output', type=Path)
    args = parser.parse_args()
    analyze(json.loads(args.input.read_text()), args.output)
