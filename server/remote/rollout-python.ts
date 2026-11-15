/** 固定只读目标投影；逐条JSON解析内存由已批准A方案承担，正文不进入网关。 */
export const ROLLOUT_PYTHON = String.raw`import base64,datetime,hashlib,json,os,re,stat,sys
q=json.loads(sys.argv[1]);WINDOW=65536
def emit(value): sys.stdout.write(json.dumps(value,separators=(',',':'),ensure_ascii=True)+'\n')
def fail(code):
    emit(dict(error=code));raise SystemExit(0)
class InvalidConstant(ValueError): pass
def parse(value):
    exhausted=False
    def integer(token):
        nonlocal exhausted
        try: return int(token)
        except ValueError:
            # 仅让标准decoder完成语法验证；资源失败的占位值永不进入投影。
            exhausted=True;return None
    result=json.loads(value,parse_int=integer,parse_constant=lambda _: (_ for _ in ()).throw(InvalidConstant()))
    if exhausted: raise ValueError('integer conversion resource failure')
    return result
def obj(value): return value if isinstance(value,dict) else {}
def identity(s): return [str(s.st_dev),str(s.st_ino)]
def units(s): return len(s.encode('utf-16-le','surrogatepass'))//2
def wanted_id(value,wanted): return isinstance(value,str) and hashlib.sha256(value.encode('utf-8','surrogatepass')).hexdigest() in wanted
def texts(value,depth=0):
    if depth>8: return
    if isinstance(value,str):
        if re.match(r'^\s*[\[{]',value):
            try: nested=parse(value)
            except (json.JSONDecodeError,InvalidConstant): pass
            else:
                yield from texts(nested,depth+1);return
        yield value
    elif isinstance(value,list):
        for part in value: yield from texts(part,depth+1)
    elif isinstance(value,dict):
        if isinstance(value.get('text'),str): yield from texts(value['text'],depth+1)
        elif isinstance(value.get('content'),list): yield from texts(value['content'],depth+1)
        elif value.get('status')=='fulfilled': yield from texts(value.get('value'),depth+1)
SPACE=r'\t\n\v\f\r \u00a0\u1680\u2000-\u200a\u2028\u2029\u202f\u205f\u3000\ufeff'
HEADER=re.compile(r'(?:^|(?<=[\r\u2028\u2029]))([^\n\r\u2028\u2029]{1,1000}) \((https?://[^'+SPACE+r']{1,8192})\)\r?\n【(turn[0-9]+[a-z]+[0-9]+)】(?=['+SPACE+r'])',re.M)
def moderation(output):
    if not isinstance(output,list): return None
    for part in output:
        text=obj(part).get('text','')
        if not isinstance(text,str): continue
        match=re.search(r'Some\(("(?:\\.|[^"\\])*")\)',text,re.S)
        if not match: continue
        try: error=obj(obj(parse(parse(match[1]))).get('error'))
        except (json.JSONDecodeError,InvalidConstant,TypeError): continue
        if error.get('code')!='moderation_blocked': continue
        details=obj(error.get('moderation_details'));categories=details.get('categories');stage=details.get('moderation_stage');message=error.get('message')
        request=re.search(r'request ID ([A-Za-z0-9_-]+)',message) if isinstance(message,str) else None
        return dict(code='moderation_blocked',stage=stage if isinstance(stage,str) else 'unknown',categories=[v for v in categories if isinstance(v,str) and units(v)<=40] if isinstance(categories,list) else [],requestId=request[1] if request else None)
    return None
def project(entry,mode,wanted,state):
    payload=obj(entry.get('payload'))
    if mode=='timestamps':
        if entry.get('type')=='response_item' and payload.get('type')=='message' and payload.get('role')=='assistant' and wanted_id(payload.get('id'),wanted) and isinstance(entry.get('timestamp'),str):
            yield dict(id=payload['id'],timestamp=entry['timestamp'])
    elif mode=='citations':
        if entry.get('type')!='response_item' or payload.get('type') not in ['custom_tool_call_output','function_call_output']: return
        for text in texts(payload.get('output')):
            for match in HEADER.finditer(text):
                if wanted_id(match[3],wanted) and units(match[1])<=1000 and units(match[2])<=8192: yield dict(refId=match[3],url=match[2],title=match[1])
    elif mode=='image' and not state['done']:
        item=obj(payload.get('item'))
        if not state['found']:
            state['found']=entry.get('type')=='event_msg' and payload.get('type')=='item_completed' and item.get('kind')=='image_gen.generation' and wanted_id(item.get('id'),wanted) and item.get('status')=='failed'
        elif entry.get('type')=='response_item' and payload.get('type')=='custom_tool_call_output':
            state['done']=True;value=moderation(payload.get('output'))
            if value is not None: yield value
def scan():
    mode=q['projection'];previous=q.get('token');wanted=set(q['wanted']);offset=q['offset']
    with open(q['path'],'rb') as f:
        initial=os.fstat(f.fileno())
        if not stat.S_ISREG(initial.st_mode): fail('capability')
        length=previous['size'] if previous else min(initial.st_size,65536) if mode=='metadata' else initial.st_size
        if previous and (previous['identity']!=identity(initial) or initial.st_size<length): fail('changed')
        digest=hashlib.sha256();outHash=hashlib.sha256();window=bytearray();total=0;position=0;first=True;valid=False;state=dict(found=False,done=False)
        def take(value):
            nonlocal total
            raw=(json.dumps(value,separators=(',',':'),ensure_ascii=True)+'\n').encode('ascii');outHash.update(raw)
            left=max(0,offset-total);right=min(len(raw),offset+WINDOW-total)
            if right>left: window.extend(raw[left:right])
            total+=len(raw)
        while position<length:
            raw=f.readline(length-position)
            if not raw: fail('changed')
            digest.update(raw);position+=len(raw)
            # metadata先确认64KiB内完整首LF；缺LF不是待解析的完整首行。
            if mode=='metadata' and not raw.endswith(b'\n'):
                length=position;break
            text=raw.decode('utf-8','replace')
            lines=[text] if mode=='metadata' else re.split(r'\r\n|[\n\r\u2028\u2029]' if q['unicodeLines'] else r'\r\n|[\n\r]',text)
            for line in lines:
                if not first:
                    # 首行排除或首image输出已确定后，仅保留原始字节摘要/二次验证。
                    if not valid or (mode=='image' and state['done']): continue
                    if mode=='image':
                        if not state['found']:
                            if q['itemId'] not in line or 'image_gen.generation' not in line: continue
                        elif 'custom_tool_call_output' not in line: continue
                try: entry=obj(parse(line))
                except (json.JSONDecodeError,InvalidConstant):
                    if first and mode=='metadata': length=position
                    if valid and mode=='image' and state['found'] and 'custom_tool_call_output' in line: state['done']=True
                    first=False;continue
                if first:
                    first=False;payload=obj(entry.get('payload'));valid=entry.get('type')=='session_meta' and payload.get('id')==q['threadId']
                    if mode=='metadata':
                        length=position
                        if valid and raw.endswith(b'\n'):
                            value=dict(id=q['threadId'])
                            for old,new in [('source','source'),('thread_source','threadSource'),('parent_thread_id','parentThreadId'),('ephemeral','ephemeral')]:
                                if old in payload: value[new]=payload[old]
                            take(value)
                    continue
                if valid:
                    for value in project(entry,mode,wanted,state): take(value)
        prefix=digest.hexdigest()
        if previous and prefix!=previous['sha256']: fail('changed')
        # 二次验证已读前缀；同路径替换、truncate、原地改写均不能混入旧结果。
        f.seek(0);check=hashlib.sha256();remaining=length
        while remaining:
            part=f.read(min(WINDOW,remaining))
            if not part: fail('changed')
            check.update(part);remaining-=len(part)
        current=os.stat(q['path']);opened=os.fstat(f.fileno())
        if identity(current)!=identity(initial) or identity(opened)!=identity(initial) or current.st_size<length or opened.st_size<length or check.hexdigest()!=prefix: fail('changed')
        emit(dict(token=dict(identity=identity(initial),size=length,sha256=prefix),offset=offset,total=total,sha256=outHash.hexdigest(),base64=base64.b64encode(window).decode('ascii')))
try:
    if q['mode']=='dates':
        stamp=q['stamp']/1000
        emit(dict(dates=[[datetime.datetime.fromtimestamp(stamp+delta,zone).strftime('%Y'),datetime.datetime.fromtimestamp(stamp+delta,zone).strftime('%m'),datetime.datetime.fromtimestamp(stamp+delta,zone).strftime('%d')] for delta in [0,-86400,86400] for zone in [datetime.timezone.utc,None]]))
    elif q['mode']=='list':
        entries=[]
        with os.scandir(q['path']) as directory:
            for item in directory:
                if len(entries)>=10000: fail('capacity')
                entries.append(dict(name=item.name,directory=item.is_dir(follow_symlinks=False)))
        entries.sort(key=lambda item:item['name']);version=hashlib.sha256(json.dumps(entries,separators=(',',':'),ensure_ascii=True).encode('ascii')).hexdigest()
        if q.get('version') is not None and q['version']!=version: fail('changed')
        emit(dict(entries=entries[q['offset']:q['offset']+32],total=len(entries),version=version))
    elif q['mode']=='scan': scan()
    else: fail('protocol')
except (FileNotFoundError,NotADirectoryError): fail('missing')
except PermissionError: fail('permission')
except (OSError,ValueError,TypeError,KeyError,OverflowError,RecursionError): fail('capability')
`;
