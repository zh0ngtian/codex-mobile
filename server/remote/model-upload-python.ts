/** 固定只读统计程序：只解析官方环境指向的既有launcher，不执行JS或配置中的任何入口。 */
export const REMOTE_MODEL_UPLOAD_PYTHON = String.raw`import os,sys,stat,json,re,hashlib,socket,time,urllib.parse,select
nonce=sys.argv[1]
deadline=time.monotonic()+int(sys.argv[2])/1000
sequence=0;total=0;digest=hashlib.sha256();fd=None;client=None
MAX_SAFE=9007199254740991
class Invalid(Exception): pass
def need(value):
    if not value: raise Invalid()
def pairs(items):
    result={}
    for key,value in items:
        need(key not in result and key not in ('__proto__','prototype','constructor'));result[key]=value
    return result
def bad_constant(value): raise Invalid()
def decode(raw): return json.loads(raw.decode('utf-8','strict'),object_pairs_hook=pairs,parse_constant=bad_constant)
def emit(kind,**fields):
    global sequence,total
    sequence+=1
    value=dict(v=1,n=nonce,end=nonce,seq=sequence,kind=kind);value.update(fields)
    raw=(json.dumps(value,separators=(',',':'),ensure_ascii=True)+'\n').encode('ascii')
    need(total+len(raw)<=8388608)
    sys.stdout.buffer.write(raw);sys.stdout.buffer.flush();total+=len(raw);digest.update(raw)
def text(value):
    need(isinstance(value,str) and 0<len(value)<=16384 and '\x00' not in value)
    value.encode('utf-8','strict');return value
def absolute(path):
    text(path);need(path.startswith('/') and path==os.path.normpath(path) and not path.startswith('//'))
    return path
def identity(info): return (info.st_dev,info.st_ino,info.st_uid,info.st_mode)
def file_identity(info): return identity(info)+(info.st_nlink,info.st_size,info.st_mtime_ns,info.st_ctime_ns)
def private(info,kind):
    need(kind(info.st_mode) and info.st_uid==os.getuid() and not info.st_mode&0o077)
def trusted_home(info):
    need(stat.S_ISDIR(info.st_mode) and info.st_uid==os.getuid() and not info.st_mode&0o022)
def ancestors(path):
    absolute(path);result=[];current=os.path.dirname(path)
    while True:
        info=os.lstat(current);need(stat.S_ISDIR(info.st_mode) and info.st_uid in (0,os.getuid()))
        need(not info.st_mode&0o022 or (info.st_uid==0 and info.st_mode&stat.S_ISVTX))
        result.append((current,identity(info)))
        if current=='/': break
        current=os.path.dirname(current)
    return result
def recheck(proof):
    for path,wanted in proof: need(identity(os.lstat(path))==wanted)
def read_launcher():
    before=os.fstat(fd);private(before,stat.S_ISREG);need(before.st_nlink==1 and file_identity(before)==launcher_identity)
    os.lseek(fd,0,os.SEEK_SET);raw=b''
    while len(raw)<=65536:
        part=os.read(fd,min(8192,65537-len(raw)))
        if not part: break
        raw+=part
    after=os.fstat(fd);named=os.lstat(launcher)
    need(len(raw)==before.st_size and len(raw)<=65536 and file_identity(after)==launcher_identity and file_identity(named)==launcher_identity)
    return raw
def parse_launcher(raw):
    source=raw.decode('utf-8','strict')
    first,sep,rest=source.partition('\n');need(sep and first.startswith('#!'))
    node=absolute(first[2:]);need(not any(c.isspace() for c in node));prefix='// Codex Mobile desktop model upload meter; original adapter retained.\nimport('
    need(rest.startswith(prefix));rest=rest[len(prefix):]
    decoder=json.JSONDecoder(object_pairs_hook=pairs,parse_constant=bad_constant)
    module,end=decoder.raw_decode(rest);need(isinstance(module,str));rest=rest[end:]
    prefix=').then(async module => {\n  process.exitCode = await module.runDesktopModelUpload('
    need(rest.startswith(prefix));rest=rest[len(prefix):]
    config,end=decoder.raw_decode(rest)
    need(rest[end:]==');\n}).catch(() => { console.error("桌面模型计量启动失败，请检查安装与配置"); process.exitCode = 1; });\n')
    need(isinstance(config,dict) and set(config)==set(('codexExecutable','nodeExecutable','originalAdapter','socketPath','upstreamUrl')))
    for key in config: text(config[key])
    for key in ('codexExecutable','nodeExecutable','originalAdapter','socketPath'): absolute(config[key])
    need(config['nodeExecutable']==node and config['originalAdapter']==launcher+'.pre-model-upload')
    imported=urllib.parse.urlsplit(module)
    need(imported.scheme=='file' and not imported.netloc and not imported.query and not imported.fragment)
    module_path=absolute(urllib.parse.unquote(imported.path,errors='strict'))
    need(module_path.endswith('/npm-dist/server/desktop-model-upload.js'))
    url=urllib.parse.urlsplit(config['upstreamUrl'])
    need(url.scheme in ('ws','wss') and url.hostname in ('127.0.0.1','localhost','::1') and url.username is None and url.password is None and '#' not in config['upstreamUrl'])
    need(not any(ord(c)<=32 or ord(c)==127 for c in config['upstreamUrl']))
    url.port
    need(config['socketPath']==os.path.join(home,'mobile-model-upload','meter.sock'))
    return config
def verify():
    need(time.monotonic()<deadline)
    recheck(launcher_parents);recheck(socket_parents)
    need(read_launcher()==launcher_raw)
    trusted_home(os.lstat(home));private(os.lstat(os.path.dirname(launcher)),stat.S_ISDIR)
    private(os.lstat(os.path.dirname(socket_path)),stat.S_ISDIR)
    current=os.lstat(socket_path);private(current,stat.S_ISSOCK)
    need(current.st_nlink==1 and file_identity(current)==socket_identity)
def identifier(value):
    need(isinstance(value,str) and 0<len(value)<=256);value.encode('utf-8','strict')
def positive(value): need(type(value)==int and 0<value<=MAX_SAFE)
def validate(value):
    need(isinstance(value,dict))
    if value.get('type')=='remove':
        need(set(value)==set(('type','threadId')));identifier(value['threadId']);return
    need(set(value)==set(('type','threadId','usage')) and value['type']=='usage');identifier(value['threadId'])
    u=value['usage'];need(isinstance(u,dict) and set(u)==set(('epoch','revision','turnId','lastRequestBytes','turnBytes','requestCount')))
    identifier(u['epoch']);identifier(u['turnId'])
    for key in ('revision','turnBytes','requestCount'): positive(u[key])
    need(type(u['lastRequestBytes'])==int and 0<=u['lastRequestBytes']<=u['turnBytes'])
try:
    need(os.name=='posix' and hasattr(os,'O_NOFOLLOW') and hasattr(os,'O_NONBLOCK') and hasattr(socket,'AF_UNIX'))
    sys.stdout.write('CMMETER1_READY:'+nonce+'\n');sys.stdout.flush()
    need(select.select([sys.stdin.buffer],[],[],max(0,deadline-time.monotonic()))[0])
    request=decode(sys.stdin.buffer.readline(32769))
    need(isinstance(request,dict) and set(request)==set(('home','budgetMs')) and type(request['budgetMs'])==int and 0<request['budgetMs']<=180000)
    deadline=min(deadline,time.monotonic()+request['budgetMs']/1000)
    home=absolute(request['home']);trusted_home(os.lstat(home))
    launcher=absolute(os.environ.get('CODEX_APP_RUNTIME_CLI_PATH',''));launcher_parents=ancestors(launcher)
    private(os.lstat(os.path.dirname(launcher)),stat.S_ISDIR)
    original=os.lstat(launcher);private(original,stat.S_ISREG);need(original.st_nlink==1 and original.st_size<=65536)
    launcher_identity=file_identity(original)
    fd=os.open(launcher,os.O_RDONLY|os.O_NOFOLLOW|os.O_NONBLOCK)
    launcher_raw=read_launcher();config=parse_launcher(launcher_raw)
    socket_path=config['socketPath'];socket_parents=ancestors(socket_path)
    private(os.lstat(os.path.dirname(socket_path)),stat.S_ISDIR)
    previous=os.lstat(socket_path);private(previous,stat.S_ISSOCK);need(previous.st_nlink==1)
    socket_identity=file_identity(previous);expected=hashlib.sha256(config['upstreamUrl'].encode('utf-8')).hexdigest()
    verify();client=socket.socket(socket.AF_UNIX,socket.SOCK_STREAM);client.settimeout(max(.001,min(1,deadline-time.monotonic())));client.connect(socket_path);verify()
except BaseException:
    emit('failure',code='capability')
    if client is not None: client.close()
    if fd is not None: os.close(fd)
    raise SystemExit(1)
try:
    pending=b'';greeted=False;frames=0;received=0
    stop=deadline-min(.1,max(.01,(deadline-time.monotonic())/4))
    while time.monotonic()<stop:
        verify();client.settimeout(max(.001,min(.05,stop-time.monotonic())))
        try: part=client.recv(16384)
        except socket.timeout: continue
        need(part);received+=len(part);need(received<=8388608);verify()
        pending+=part
        while b'\n' in pending:
            line,pending=pending.split(b'\n',1);need(len(line)+1<=4096)
            value=decode(line);frames+=1;need(frames<=32768);verify()
            if not greeted:
                need(value==dict(type='hello',version=1,sourceHash=expected) and type(value.get('version'))==int)
                greeted=True;emit('verified',sourceHash=expected)
            else:
                validate(value);emit('frame',frame=value)
        need(len(pending)<4096)
    need(greeted and not pending);verify()
    count=sequence;size=total;sha=digest.hexdigest();emit('complete',records=count,bytes=size,sha256=sha)
    sys.stderr.write('CMMETER1_DONE:'+nonce+':'+str(total)+':'+digest.hexdigest()+'\n');sys.stderr.flush()
except BaseException:
    emit('failure',code='protocol');raise SystemExit(1)
finally:
    client.close();os.close(fd)
`;
