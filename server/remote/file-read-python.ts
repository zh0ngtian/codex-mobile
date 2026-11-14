/** 固定、单窗口Python命令；输入仅为argv中的JSON数据，输出自然结束后整体验证。 */
export const REMOTE_FILE_READ_PYTHON = String.raw`import base64,hashlib,json,os,stat,sys,threading,time
nonce=sys.argv[1]
deadline=time.monotonic()+int(sys.argv[2])/1000
CHUNK=524288
WINDOW=2097152
MAX=104857600
wirehash=hashlib.sha256();wirebytes=0;sequence=0
class Failure(Exception): pass
def check():
    if time.monotonic()>=deadline: raise Failure('timeout')
def watchdog():
    while time.monotonic()<deadline: time.sleep(min(.01,max(.001,deadline-time.monotonic())))
    os._exit(124)
threading.Thread(target=watchdog,daemon=True).start()
def emit(kind,**data):
    global sequence,wirebytes
    check();sequence+=1;data.update(v=1,n=nonce,end=nonce,seq=sequence,kind=kind)
    raw=(json.dumps(data,separators=(',',':'),ensure_ascii=True)+'\n').encode('ascii')
    wirehash.update(raw);wirebytes+=len(raw)
    sys.stdout.buffer.write(raw);check()
def finish():
    check();sys.stdout.buffer.flush()
    sys.stderr.write('CMFILE_READ1_DONE:'+nonce+':'+str(wirebytes)+':'+wirehash.hexdigest()+'\n');sys.stderr.flush();check()
def facts(s): return dict(dev=str(s.st_dev),ino=str(s.st_ino),mode=str(s.st_mode),size=str(s.st_size),mtime=str(s.st_mtime_ns),ctime=str(s.st_ctime_ns))
def verify(f,path,expected):
    check()
    try: actual=facts(os.stat(path))
    except FileNotFoundError: raise Failure('version')
    if facts(os.fstat(f.fileno()))!=expected or actual!=expected: raise Failure('version')
try:
    request=json.loads(sys.argv[3])
    if type(request)!=dict or set(request)-{'path','offset','length','expected','window','position'} or not {'path','offset','window','position'}<=set(request): raise Failure('protocol')
    path=request['path'];offset=request['offset'];window=request['window'];position=request['position']
    if type(path)!=str or not os.path.isabs(path) or '\0' in path: raise Failure('invalid-input')
    if type(offset)!=int or type(window)!=int or type(position)!=int or offset<0 or window<0 or position!=window*WINDOW: raise Failure('protocol')
    with open(path,'rb') as f:
        initial=facts(os.fstat(f.fileno()))
        if not stat.S_ISREG(os.fstat(f.fileno()).st_mode): raise Failure('invalid-input')
        verify(f,path,initial)
        if 'expected' in request and request['expected']!=initial: raise Failure('version')
        length=request.get('length',int(initial['size'])-offset)
        if type(length)!=int or length<0 or length>MAX or offset+length>int(initial['size']): raise Failure('capacity')
        if position>length or (position==length and (length!=0 or window!=0)): raise Failure('protocol')
        emit('meta',path=path,type='file',facts=initial,length=length,offset=offset,window=window,position=position)
        f.seek(offset+position);total=position
        for _ in range(4):
            if total==length: break
            verify(f,path,initial);part=f.read(min(CHUNK,length-total));verify(f,path,initial)
            if not part: raise Failure('integrity')
            emit('chunk',offset=offset+total,size=len(part),sha256=hashlib.sha256(part).hexdigest(),base64=base64.b64encode(part).decode('ascii'));total+=len(part)
        verify(f,path,initial)
        if total==length:
            # 独立重读整个请求Range，不能把输出时累计的散列当作独立证明。
            f.seek(offset);whole=hashlib.sha256()
            remaining=length
            while remaining:
                verify(f,path,initial);part=f.read(min(CHUNK,remaining));verify(f,path,initial)
                if not part: raise Failure('integrity')
                whole.update(part);remaining-=len(part)
            verify(f,path,initial)
            emit('done',window=window,position=position,total=total,sha256=whole.hexdigest(),facts=initial)
        else: emit('batch-end',window=window,position=position,total=total,facts=initial)
    finish()
except Failure as error:
    emit('failure',code=str(error));finish()
except FileNotFoundError:
    emit('failure',code='not-found');finish()
except PermissionError:
    emit('failure',code='permission');finish()
except BaseException:
    emit('failure',code='protocol');finish()
`;
