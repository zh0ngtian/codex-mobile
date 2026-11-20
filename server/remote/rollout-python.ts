/** 固定只读目标能力；分别传送定位/投影源码，保留Windows既有argv预算。 */
const WIRE = String.raw`import base64,hashlib,json,os,sys
q=json.loads(sys.argv[1]);WINDOW=65536
def encoded(value): return (json.dumps(value,separators=(',',':'),ensure_ascii=True)+'\n').encode('ascii')
def emit(value): sys.stdout.buffer.write(encoded(value))
def fail(code):
    emit(dict(error=code));raise SystemExit(0)
`;

const SCAN_COMMON = String.raw`import re,stat
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
def wanted_id(value,wanted): return isinstance(value,str) and hashlib.sha256(value.encode('utf-8','surrogatepass')).hexdigest() in wanted
`;

const CORE_PROJECTIONS = String.raw`def units(s): return len(s.encode('utf-16-le','surrogatepass'))//2
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
            state['done']=True
            yield dict(matched=True,error=moderation(payload.get('output')))
`;

const COMMENTARY_PROJECTION = String.raw`WINDOW=24576
def message_text(payload):
    content=payload.get('content')
    return ''.join(obj(part).get('text') for part in content if isinstance(obj(part).get('text'),str)) if isinstance(content,list) else ''
def project(entry,mode,wanted,state):
    payload=obj(entry.get('payload'))
    if entry.get('type')=='event_msg':
        if payload.get('type') in ('task_started','turn_started'):
            turn=payload.get('turn_id');state['turn']=turn
            if wanted_id(turn,wanted): yield dict(turnId=turn)
        elif payload.get('type') in ('task_complete','turn_completed','turn_aborted') and payload.get('turn_id')==state.get('turn'):
            state['turn']=None
        elif payload.get('type')=='item_completed':
            turn=payload.get('turn_id');item=obj(payload.get('item'));item_id=item.get('id')
            if wanted_id(turn,wanted) and isinstance(item_id,str) and item.get('type') in ('UserMessage','AgentMessage','ImageView','ImageGeneration','VideoGeneration'):
                value=dict(turnId=turn,id=item_id)
                if item.get('type')=='AgentMessage' and item.get('phase')=='commentary':
                    text=message_text(item)
                    if text: value.update(text=text,timestamp=entry.get('timestamp'))
                yield value
        return
    turn=state.get('turn');item_id=payload.get('id');role=payload.get('role')
    if wanted_id(turn,wanted) and isinstance(item_id,str) and entry.get('type')=='response_item' and payload.get('type')=='message' and role in ('user','assistant'):
        value=dict(turnId=turn,id=item_id)
        if role=='assistant' and payload.get('phase')=='commentary':
            text=message_text(payload)
            if text: value.update(text=text,timestamp=entry.get('timestamp'))
        yield value
`;

const SCAN_FILE = String.raw`def scan():
    mode=q['projection'];previous=q.get('token');wanted=set(q['wanted']);offset=q['offset']
    with open(q['path'],'rb') as f:
        initial=os.fstat(f.fileno())
        if not stat.S_ISREG(initial.st_mode): fail('capability')
        length=previous['size'] if previous else min(initial.st_size,65536) if mode in ['metadata','cwd'] else initial.st_size
        if previous and (previous['identity']!=identity(initial) or initial.st_size<length): fail('changed')
        digest=hashlib.sha256();outHash=hashlib.sha256();window=bytearray();total=0;position=0;first=True;valid=False;state=dict(found=False,done=False)
        def take(value):
            nonlocal total
            raw=encoded(value);outHash.update(raw)
            left=max(0,offset-total);right=min(len(raw),offset+WINDOW-total)
            if right>left: window.extend(raw[left:right])
            total+=len(raw)
        while position<length:
            raw=f.readline(length-position)
            if not raw: fail('changed')
            digest.update(raw);position+=len(raw)
            # metadata先确认64KiB内完整首LF；缺LF不是待解析的完整首行。
            if mode in ['metadata','cwd'] and not raw.endswith(b'\n'):
                length=position;break
            text=raw.decode('utf-8','replace')
            lines=[text] if mode in ['metadata','cwd'] else re.split(r'\r\n|[\n\r\u2028\u2029]' if q['unicodeLines'] else r'\r\n|[\n\r]',text)
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
                    if first and mode in ['metadata','cwd']: length=position
                    if valid and mode=='image' and state['found'] and 'custom_tool_call_output' in line:
                        state['done']=True;take(dict(matched=True,error=None))
                    first=False;continue
                if first:
                    first=False;payload=obj(entry.get('payload'));valid=entry.get('type')=='session_meta' and payload.get('id')==q['threadId']
                    if mode in ['metadata','cwd']:
                        length=position
                        if valid and raw.endswith(b'\n'):
                            if mode=='cwd':
                                cwd=payload.get('cwd')
                                if isinstance(cwd,str): take(dict(id=q['threadId'],cwd=cwd))
                                continue
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
    if q['mode']=='scan': scan()
    else: fail('protocol')
except (FileNotFoundError,NotADirectoryError): fail('missing')
except PermissionError: fail('permission')
except (OSError,ValueError,TypeError,KeyError,OverflowError,RecursionError): fail('capability')
`;

export const ROLLOUT_PYTHON = WIRE + SCAN_COMMON + CORE_PROJECTIONS + SCAN_FILE;
export const ROLLOUT_COMMENTARY_PYTHON = WIRE + SCAN_COMMON + COMMENTARY_PROJECTION + SCAN_FILE;

export const ROLLOUT_LOCATOR_PYTHON = WIRE + String.raw`import datetime,ntpath,posixpath,re
def locate():
    p=ntpath if q['windows'] else posixpath;home=p.normpath(q['path']);thread=q['threadId'];offset=q['offset']
    filename=re.compile(r'-'+re.escape(thread)+r'(?:_[a-f0-9-]{36})*\.jsonl$',re.I)
    class FullDirectory(Exception): pass
    def walkFiles(proof):
        def ls(path):
            def key(s): return [str(s.st_dev),str(s.st_ino),s.st_mtime_ns,s.st_ctime_ns]
            try:
                initial=os.stat(path)
                entries=[]
                with os.scandir(path) as directory:
                    for item in directory:
                        if len(entries)>=10000: raise FullDirectory()
                        entries.append([item.name,item.is_dir(follow_symlinks=False)])
                if key(initial)!=key(os.stat(path)): fail('changed')
                entries.sort();record=[path,key(initial),entries]
            except (FileNotFoundError,NotADirectoryError): entries=[];record=[path,None]
            proof.update(encoded(record))
            return entries
        def candidates(path):
            for name,_ in ls(path):
                if name.startswith('rollout-') and filename.search(name): yield p.join(path,name)
        first=[]
        if thread[14]=='7':
            stamp=int(thread.replace('-','')[:12],16)/1000
            for delta in [0,-86400,86400]:
                for zone in [datetime.timezone.utc,None]:
                    date=datetime.datetime.fromtimestamp(stamp+delta,zone)
                    path=p.join(home,'sessions',date.strftime('%Y'),date.strftime('%m'),date.strftime('%d'))
                    if path not in first: first.append(path)
        first.append(p.join(home,'archived_sessions'))
        for path in first: yield from candidates(path)
        sessions=p.join(home,'sessions')
        for year,directory in ls(sessions):
            if not directory or not re.fullmatch(r'[0-9]{4}',year): continue
            y=p.join(sessions,year)
            for month,directory in ls(y):
                if not directory or not re.fullmatch(r'0[1-9]|1[0-2]',month): continue
                m=p.join(y,month)
                for day,directory in ls(m):
                    if directory and re.fullmatch(r'0[1-9]|[12][0-9]|3[01]',day):
                        path=p.join(m,day)
                        if path not in first: yield from candidates(path)
    def walk(proof):
        try: yield from walkFiles(proof)
        except (FullDirectory,OSError,ValueError,TypeError,KeyError,OverflowError,RecursionError) as error:
            code='capacity' if isinstance(error,FullDirectory) else 'permission' if isinstance(error,PermissionError) else 'capability'
            value=dict(error=code);proof.update(encoded(value));yield value
    proof=hashlib.sha256();output=hashlib.sha256();window=bytearray();total=0
    for path in walk(proof):
        raw=encoded(path);output.update(raw)
        left=max(0,offset-total);right=min(len(raw),offset+WINDOW-total)
        if right>left: window.extend(raw[left:right])
        total+=len(raw)
    check=hashlib.sha256()
    for _ in walk(check): pass
    version=proof.hexdigest()
    if check.hexdigest()!=version or (q.get('version') is not None and q['version']!=version): fail('changed')
    emit(dict(version=version,offset=offset,total=total,sha256=output.hexdigest(),base64=base64.b64encode(window).decode('ascii')))
try:
    if q['mode']=='locate': locate()
    else: fail('protocol')
except (FileNotFoundError,NotADirectoryError): fail('missing')
except PermissionError: fail('permission')
except (OSError,ValueError,TypeError,KeyError,OverflowError,RecursionError): fail('capability')
`;
