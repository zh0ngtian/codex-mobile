"""复算全部折叠的进程冷启动样本；nearest-rank。"""
import csv,json,math
from pathlib import Path
root=Path(__file__).parent
rows=list(csv.DictReader((root/'samples.csv').open()))
result={'samples':len(rows),'errors':sum(int(r['errors']) for r in rows),'metrics':{}}
for key in ['launch_to_settled_ms','document_to_settled_ms','web_start_ms','catalog_requests','summary_requests','project_requests','projectless_requests']:
 values=sorted(float(r[key]) for r in rows)
 result['metrics'][key]={name:values[max(0,math.ceil(len(values)*p)-1)] for name,p in [('min',0),('p50',.5),('p90',.9),('p95',.95),('max',1)]}
(root/'summary.json').write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n')
print(json.dumps(result,ensure_ascii=False,indent=2))
