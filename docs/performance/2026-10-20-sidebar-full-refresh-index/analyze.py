"""复算脱敏样本；缺失终点按无穷参与分位数，JSON 写 null。"""
import csv,json,math
from pathlib import Path
root=Path(__file__).parent
rows=list(csv.DictReader((root/'samples.csv').open()))
metrics=['first_ms','all_ms','first_web_ms','all_web_ms','web_start_ms','client_reads','client_lists','summary_requests','projectless_requests','upstream_reads','upstream_lists','open_rpc_ms']
result={}
for suite,case in sorted({(r['suite'],r['case']) for r in rows}):
 cohort=[r for r in rows if r['suite']==suite and r['case']==case]
 values={}
 for metric in metrics:
  if metric=='open_rpc_ms' and suite!='foreground':continue
  data=sorted(float(r[metric]) if r[metric] else math.inf for r in cohort)
  pick=lambda p: data[max(0,math.ceil(len(data)*p)-1)]
  values[metric]={'min':data[0],'p50':pick(.5),'p90':pick(.9),'p95':pick(.95),'max':data[-1]}
 result[suite+'/'+case]={'samples':len(cohort),'failed_samples':sum(int(r['project_errors'])>0 or int(r['rpc_errors'])>0 or int(r['runtime_errors'])>0 for r in cohort),'project_errors':sum(int(r['project_errors']) for r in cohort),'censored':sum(not r['all_ms'] for r in cohort),'open_rpc_errors':sum(int(r['open_rpc_error']) for r in cohort),'metrics':values}
def finite(v):
 if isinstance(v,float) and not math.isfinite(v):return None
 if isinstance(v,dict):return {k:finite(x) for k,x in v.items()}
 if isinstance(v,list):return [finite(x) for x in v]
 return v
(root/'summary.json').write_text(json.dumps(finite(result),ensure_ascii=False,indent=2)+'\n')
print(json.dumps(finite(result),ensure_ascii=False,indent=2))
