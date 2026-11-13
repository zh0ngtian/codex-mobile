/** 文件协议只接收JSON数据；固定源码通过-I隔离，目标路径永不进入网关FS。 */
export const REMOTE_FILE_PYTHON = String.raw`import base64,hashlib,json,os,stat,sys,threading,time
nonce=sys.argv[1]
deadline=time.monotonic()+int(sys.argv[2])/1000
CHUNK=524288
MAX=104857600
wirehash=hashlib.sha256();wirebytes=0;sequence=0
def watchdog():
    while time.monotonic()<deadline: time.sleep(min(.01,max(.001,deadline-time.monotonic())))
    os._exit(124)
threading.Thread(target=watchdog,daemon=True).start()
def check():
    if time.monotonic()>=deadline: raise Failure('timeout')
class Failure(Exception): pass
def emit(kind,**data):
    global wirebytes,sequence
    check();sequence+=1
    data.update(v=1,n=nonce,end=nonce,seq=sequence,kind=kind)
    raw=(json.dumps(data,separators=(',',':'),ensure_ascii=True)+'\n').encode('ascii')
    wirehash.update(raw);wirebytes+=len(raw)
    sys.stdout.buffer.write(raw);sys.stdout.buffer.flush();check()
def finish(kind='done',**data):
    emit(kind,**data)
    sys.stderr.write('CMFILE1_DONE:'+nonce+':'+str(wirebytes)+':'+wirehash.hexdigest()+'\n');sys.stderr.flush()
    time.sleep(max(0,deadline-time.monotonic())+1)
    raise SystemExit(0)
def receive():
    check();raw=sys.stdin.buffer.readline(710000)
    if not raw or len(raw)>=710000 or not raw.endswith(b'\n'): raise Failure('protocol')
    value=json.loads(raw.decode('utf-8','strict'))
    if type(value)!=dict: raise Failure('protocol')
    check();return value
def facts(s):
    return dict(dev=str(s.st_dev),ino=str(s.st_ino),mode=str(s.st_mode),size=str(s.st_size),mtime=str(s.st_mtime_ns),ctime=str(s.st_ctime_ns))
def kind(s):
    return 'file' if stat.S_ISREG(s.st_mode) else 'directory' if stat.S_ISDIR(s.st_mode) else 'symlink' if stat.S_ISLNK(s.st_mode) else 'other'
def current(path):
    try: return facts(os.stat(path))
    except FileNotFoundError: return None
def same(path,expected):
    check()
    if current(path)!=expected: raise Failure('version')
def write_version(path,expected):
    check()
    try: s=os.lstat(path)
    except FileNotFoundError:
        if expected is not None: raise Failure('version')
        return
    if not stat.S_ISREG(s.st_mode) or facts(s)!=expected: raise Failure('version')
def data_chunk(value):
    if type(value.get('base64'))!=str or len(value['base64'])>699052: raise Failure('protocol')
    raw=base64.b64decode(value['base64'],validate=True)
    if len(raw)>CHUNK or base64.b64encode(raw).decode('ascii')!=value['base64']: raise Failure('protocol')
    if len(raw)!=value['size'] or hashlib.sha256(raw).hexdigest()!=value['sha256']: raise Failure('integrity')
    return raw
def identity(s): return dict(dev=str(s.st_dev),ino=str(s.st_ino),mode=str(s.st_mode))
def private_directory(prefix,parent):
    # tempfile.mkdtemp某些版本会abspath，从而改变symlink/..的目标语义。
    for _ in range(8):
        check();path=os.path.join(parent,prefix+os.urandom(16).hex())
        try: os.mkdir(path,0o700);return path
        except FileExistsError: pass
    raise Failure('capacity')
def lock_file(path,create=False):
    if os.name=='nt':
        # Windows标准库构造允许删除共享的句柄；锁贯穿原子捕获及清理。
        import ctypes,msvcrt
        from ctypes import wintypes
        kernel=ctypes.WinDLL('kernel32',use_last_error=True);open_file=kernel.CreateFileW
        open_file.argtypes=[wintypes.LPCWSTR,wintypes.DWORD,wintypes.DWORD,wintypes.LPVOID,wintypes.DWORD,wintypes.DWORD,wintypes.HANDLE];open_file.restype=wintypes.HANDLE
        handle=open_file(path,0xc0000000,7,None,1 if create else 3,0x80,None)
        if handle==ctypes.c_void_p(-1).value: raise OSError(ctypes.get_last_error(),'lock')
        try: descriptor=msvcrt.open_osfhandle(handle,os.O_RDWR|os.O_BINARY)
        except BaseException:
            kernel.CloseHandle.argtypes=[wintypes.HANDLE];kernel.CloseHandle(handle);raise
    else: descriptor=os.open(path,os.O_RDWR|(os.O_CREAT|os.O_EXCL if create else 0),0o600)
    return os.fdopen(descriptor,'r+b',buffering=0)
def acquire_lock(handle):
    check();handle.seek(0)
    try:
        if os.name=='nt':
            import msvcrt
            msvcrt.locking(handle.fileno(),msvcrt.LK_NBLCK,1)
        else:
            import fcntl
            fcntl.flock(handle.fileno(),fcntl.LOCK_EX|fcntl.LOCK_NB)
    except OSError: raise Failure('version')
    check()
def inactive_lock(token):
    owned(token);handle=lock_file(os.path.join(token['directory'],'lock'))
    try:
        if identity(os.fstat(handle.fileno()))!=token['lockIdentity']: raise Failure('version')
        acquire_lock(handle);owned(token);return handle
    except BaseException:
        handle.close();raise
def filehash(path,expected_identity):
    total=0;h=hashlib.sha256()
    with open(path,'rb') as f:
        if identity(os.fstat(f.fileno()))!=expected_identity: raise Failure('version')
        before=facts(os.fstat(f.fileno()))
        while True:
            check();part=f.read(CHUNK)
            if not part: break
            total+=len(part)
            if total>MAX: raise Failure('capacity')
            h.update(part)
        if facts(os.fstat(f.fileno()))!=before or current(path)!=before: raise Failure('version')
    return total,h.hexdigest(),before
# 每次操作的目录和payload都用独占创建，凭证保留其真实inode；只移除已证明的自有名字。
def owned(token,location=None):
    directory=token['directory'] if location is None else location
    if identity(os.lstat(directory))!=token['directoryIdentity'] or not stat.S_ISDIR(os.lstat(directory).st_mode): raise Failure('version')
    locked=os.lstat(os.path.join(directory,'lock'))
    if identity(locked)!=token['lockIdentity'] or not stat.S_ISREG(locked.st_mode): raise Failure('version')
    record_path=os.path.join(directory,'receipt')
    s=os.lstat(record_path)
    if identity(s)!=token['receiptIdentity'] or not stat.S_ISREG(s.st_mode) or s.st_size>131072: raise Failure('version')
    with open(record_path,'rb') as f:
        if identity(os.fstat(f.fileno()))!=token['receiptIdentity']: raise Failure('version')
        raw=f.read(131073).decode('utf-8','strict');lines=raw.split('\n')[:-1]
    if len(raw.encode('utf-8'))>131072 or len(lines) not in (1,2,3) or json.loads(lines[0])!=token: raise Failure('version')
    committed=None;captured=None
    for line in lines[1:]:
        entry=json.loads(line)
        if entry.get('state')=='captured' and captured is None and committed is None:
            if set(entry)!={'state','directory','identity'} or type(entry['directory'])!=str or os.path.dirname(entry['directory'])!=os.path.dirname(token['directory']) or not os.path.basename(entry['directory']).startswith('.codex-mobile-commit-'+token['id']+'-') or set(entry['identity'])!={'dev','ino','mode'}: raise Failure('version')
            captured=entry
        elif entry.get('state')=='committed' and committed is None:
            if set(entry)!={'state','facts','size','sha256'} or entry['size']!=token['size'] or entry['sha256']!=token['sha256'] or {k:entry['facts'][k] for k in ('dev','ino','mode')}!=token['payloadIdentity']: raise Failure('version')
            committed=entry
        else: raise Failure('version')
    return directory,os.path.join(directory,'payload'),record_path,committed,captured

def resolve(token):
    if 'directoryIdentity' in token:
        owned(token);return token
    directory=token['directory'];receipt=os.path.join(directory,'receipt')
    s=os.lstat(receipt)
    if not stat.S_ISREG(s.st_mode) or s.st_size>131072: raise Failure('version')
    with open(receipt,'rb') as f:
        if identity(os.fstat(f.fileno()))!=identity(s): raise Failure('version')
        raw=f.readline(131073)
    actual=json.loads(raw.decode('utf-8','strict'))
    if any(actual.get(k)!=v for k,v in token.items()) or set(actual)!=set(token)|{'directoryIdentity','receiptIdentity','payloadIdentity','lockIdentity'}: raise Failure('version')
    owned(actual);return actual

def inspect(token):
    try: directory,payload,receipt,committed,captured=owned(token)
    except FileNotFoundError: return dict(state='missing')
    try:
        size,digest,value=filehash(token['path'],token['payloadIdentity'])
        if size==token['size'] and digest==token['sha256']: return dict(state='committed',size=size,sha256=digest,facts=value,currentMatches=True)
    except (FileNotFoundError,Failure): pass
    if committed is not None: return dict(state='committed',size=committed['size'],sha256=committed['sha256'],facts=committed['facts'],currentMatches=False)
    try:
        if captured is not None:
            if identity(os.lstat(captured['directory']))!=captured['identity']: raise Failure('version')
            payload=os.path.join(captured['directory'],'payload')
        size,digest,value=filehash(payload,token['payloadIdentity'])
        return dict(state='staged' if size==token['size'] and digest==token['sha256'] else 'receiving',size=size,sha256=digest)
    except (FileNotFoundError,Failure): return dict(state='unknown')
def cleanup_directory(token,directory,expected_directory,entries,required,verify=None,lock=None):
    if identity(os.lstat(directory))!=expected_directory: raise Failure('version')
    names={name for name,_ in entries}
    if not set(os.listdir(directory))<=names: raise Failure('version')
    for name,expected in entries:
        try:
            if identity(os.lstat(os.path.join(directory,name)))!=expected: raise Failure('version')
        except FileNotFoundError:
            if name in required: raise Failure('version')
    # 公开路径的检查不授权稍后的unlink。先原子捕获整个目录，再验证真实捕获物。
    # 子项再移到私有捕获目录，避免原目录句柄仍能在校验后替换同名子项。
    capture=private_directory('.codex-mobile-cleanup-'+token['id']+'-',os.path.dirname(directory))
    capture_identity=identity(os.lstat(capture));held=os.path.join(capture,'entry');captured=False
    try:
        check()
        if verify is not None: verify(directory)
        os.rename(directory,held);captured=True
        if identity(os.lstat(held))!=expected_directory: raise Failure('version')
        if verify is not None: verify(held)
        if not set(os.listdir(held))<=names: raise Failure('version')
        for name,expected in entries:
            source=os.path.join(held,name)
            check()
            try: before=os.lstat(source)
            except FileNotFoundError:
                if name not in required: continue
                raise Failure('version')
            if identity(before)!=expected: raise Failure('version')
            target=os.path.join(capture,name);os.rename(source,target)
            if identity(os.lstat(target))!=expected: raise Failure('version')
            os.unlink(target)
        # Windows删除共享句柄在close后完成目录项回收。锁已贯穿全部文件捕获/核验/删除。
        if lock is not None: lock.close()
        if identity(os.lstat(held))!=expected_directory: raise Failure('version')
        os.rmdir(held);captured=False
    finally:
        # 捕获到替换物时保留隔离目录并失败关闭，不向可能已替换的父目录恢复。
        if not captured and identity(os.lstat(capture))==capture_identity: os.rmdir(capture)
def cleanup(token,lock):
    directory,payload,receipt,committed,commit_capture=owned(token)
    # 用户目的文件永不触碰。未知替换物保留，排他锁贯穿两个自有目录清理。
    if commit_capture is not None:
        try: cleanup_directory(token,commit_capture['directory'],commit_capture['identity'],[('payload',token['payloadIdentity'])],set())
        except FileNotFoundError: pass
    cleanup_directory(token,directory,token['directoryIdentity'],[('payload',token['payloadIdentity']),('receipt',token['receiptIdentity']),('lock',token['lockIdentity'])],{'receipt','lock'},lambda location: owned(token,location),lock)

ready_at=time.monotonic()
sys.stdout.write('CMFILE1_READY:'+nonce+'\n');sys.stdout.flush()
try:
    request=receive();budget=request.pop('readyBudgetMs')
    if type(budget)!=int or budget<1 or budget>180000: raise Failure('protocol')
    # READY在目标先发生，网关之后测量剩余时间：无需异机时钟同步即可给出保守绝对边界。
    deadline=min(deadline,ready_at+budget/1000);check();mode=request['mode'];path=request['path']
    if type(path)!=str or not os.path.isabs(path) or '\0' in path: raise Failure('invalid-input')
    if mode=='stat':
        s=os.stat(path);finish('stat',path=path,type=kind(s),facts=facts(s))
    elif mode=='read':
        with open(path,'rb') as f:
            initial=facts(os.fstat(f.fileno()))
            if not stat.S_ISREG(os.fstat(f.fileno()).st_mode): raise Failure('invalid-input')
            same(path,initial)
            if request.get('expected') is not None and request['expected']!=initial: raise Failure('version')
            offset=request['offset'];length=request.get('length')
            if length is None: length=int(initial['size'])-offset
            if type(offset)!=int or type(length)!=int or offset<0 or length<0 or length>MAX or offset+length>int(initial['size']): raise Failure('capacity')
            f.seek(offset);emit('meta',path=path,type='file',facts=initial,length=length,offset=offset)
            total=0;h=hashlib.sha256()
            while True:
                r=receive()
                if r!={'op':'next','count':4}: raise Failure('protocol')
                for _ in range(4):
                    if total==length: break
                    check();same(path,initial)
                    if facts(os.fstat(f.fileno()))!=initial: raise Failure('version')
                    part=f.read(min(CHUNK,length-total))
                    if not part: raise Failure('integrity')
                    if facts(os.fstat(f.fileno()))!=initial: raise Failure('version')
                    same(path,initial);h.update(part);total+=len(part)
                    emit('chunk',offset=offset+total-len(part),size=len(part),sha256=hashlib.sha256(part).hexdigest(),base64=base64.b64encode(part).decode('ascii'))
                if total==length:
                    same(path,initial)
                    if facts(os.fstat(f.fileno()))!=initial: raise Failure('version')
                    finish(total=total,sha256=h.hexdigest(),facts=initial)
                emit('batch-end')
    elif mode=='list':
        initial=current(path)
        if initial is None or not stat.S_ISDIR(int(initial['mode'])): raise Failure('invalid-input')
        emit('meta',path=path,type='directory',facts=initial)
        count=0;pending=None
        with os.scandir(path) as entries:
            while True:
                r=receive();page_size=r.get('pageSize')
                if r.get('op')!='next' or type(page_size)!=int or page_size<1 or page_size>64: raise Failure('protocol')
                same(path,initial);page=[];used=0
                for _ in range(page_size):
                    if pending is None:
                        try:
                            entry=next(entries);s=entry.stat(follow_symlinks=False);pending=dict(path=entry.path,name=entry.name,type=kind(s))
                        except StopIteration:
                            same(path,initial);finish(entries=page,facts=initial)
                    size=len(json.dumps(pending,ensure_ascii=True))
                    if size>262144: raise Failure('capacity')
                    if used+size>262144: break
                    page.append(pending);pending=None;used+=size;count+=1
                    if count>100000: raise Failure('capacity')
                same(path,initial);emit('page',entries=page)
    elif mode=='upload':
        write_version(path,request['expected']);size=request['size'];digest=request['sha256']
        if type(size)!=int or size<0 or size>MAX: raise Failure('capacity')
        directory=request['directory']
        if os.path.normpath(os.path.dirname(directory))!=os.path.normpath(os.path.dirname(path)) or os.path.basename(directory)!='.codex-mobile-upload-'+request['id']: raise Failure('protocol')
        os.mkdir(directory,0o700)
        payload=os.path.join(directory,'payload');receipt=os.path.join(directory,'receipt')
        writer_lock=lock_file(os.path.join(directory,'lock'),True);writer_lock.write(b'1');writer_lock.flush();acquire_lock(writer_lock);os.fsync(writer_lock.fileno())
        with open(payload,'xb') as f:
            os.chmod(payload,0o600)
            with open(receipt,'xb') as record:
                os.chmod(receipt,0o600)
                token=dict(id=request['id'],namespace=request['namespace'],path=path,directory=directory,directoryIdentity=identity(os.lstat(directory)),receiptIdentity=identity(os.fstat(record.fileno())),payloadIdentity=identity(os.fstat(f.fileno())),lockIdentity=identity(os.fstat(writer_lock.fileno())),size=size,sha256=digest,expected=request['expected'])
                record.write((json.dumps(token,separators=(',',':'),ensure_ascii=True)+'\n').encode('ascii'));record.flush();os.fsync(record.fileno())
            emit('upload',operation=token)
            total=0;h=hashlib.sha256();staged=None
            while True:
                r=receive()
                if r.get('op')=='chunk':
                    part=data_chunk(r)
                    if not part or r['offset']!=total or total+len(part)>size: raise Failure('integrity')
                    f.write(part);h.update(part);total+=len(part);check();emit('ack',total=total,sha256=r['sha256'])
                elif r=={'op':'stage'}:
                    if total!=size or h.hexdigest()!=digest: raise Failure('integrity')
                    f.flush();os.fsync(f.fileno());check()
                    n,d,v=filehash(payload,token['payloadIdentity'])
                    if n!=size or d!=digest: raise Failure('integrity')
                    staged=v;emit('staged',total=total,sha256=digest)
                elif r=={'op':'commit'}:
                    if staged is None or total!=size or h.hexdigest()!=digest: raise Failure('integrity')
                    f.flush();os.fsync(f.fileno());check()
                    if facts(os.fstat(f.fileno()))!=staged or current(payload)!=staged: raise Failure('version')
                    owned(token)
                    if identity(os.lstat(payload))!=token['payloadIdentity']: raise Failure('version')
                    # 原子捕获后验证实际源，公开payload的stat不能授权稍后的replace。
                    # 先fsync捕获定位，进程中断后新连接仍可查目标或精确暂存事实。
                    captured=private_directory('.codex-mobile-commit-'+token['id']+'-',os.path.dirname(directory))
                    capture_record=dict(state='captured',directory=captured,identity=identity(os.lstat(captured)))
                    with open(receipt,'ab') as record:
                        if identity(os.fstat(record.fileno()))!=token['receiptIdentity']: raise Failure('version')
                        record.write((json.dumps(capture_record,separators=(',',':'))+'\n').encode('ascii'));record.flush();os.fsync(record.fileno())
                    # Windows不允许移动仍打开的文件，捕获之前显式关闭自有句柄。
                    f.close();check();private_payload=os.path.join(captured,'payload');os.rename(payload,private_payload)
                    n,d,v=filehash(private_payload,token['payloadIdentity'])
                    if n!=size or d!=digest or identity(os.lstat(captured))!=capture_record['identity']: raise Failure('integrity')
                    check();write_version(path,request['expected']);os.replace(private_payload,path);check()
                    n,d,v=filehash(path,token['payloadIdentity'])
                    if n!=size or d!=digest: raise Failure('integrity')
                    with open(receipt,'ab') as record:
                        if identity(os.fstat(record.fileno()))!=token['receiptIdentity']: raise Failure('version')
                        record.write((json.dumps(dict(state='committed',facts=v,size=total,sha256=digest),separators=(',',':'))+'\n').encode('ascii'));record.flush();os.fsync(record.fileno())
                    finish(path=path,total=total,sha256=digest,facts=v)
                else: raise Failure('protocol')
    elif mode=='query':
        try: token=resolve(request['operation'])
        except FileNotFoundError: finish('query',state='missing')
        finish('query',**inspect(token))
    elif mode=='release':
        token=resolve(request['operation'])
        with inactive_lock(token) as lock:
            if inspect(token)['state']!='committed': raise Failure('version')
            cleanup(token,lock)
        finish('cleaned')
    elif mode=='discard':
        token=resolve(request['operation'])
        with inactive_lock(token) as lock:
            if inspect(token)['state'] not in ('receiving','staged'): raise Failure('version')
            cleanup(token,lock)
        finish('cleaned')
    elif mode=='cleanup':
        token=resolve(request['operation'])
        with inactive_lock(token) as lock:
            if inspect(token)['state'] not in ('receiving','staged'): raise Failure('version')
            cleanup(token,lock)
        finish('cleaned')
    else: raise Failure('protocol')
except Failure as error:
    emit('failure',code=str(error));time.sleep(max(0,deadline-time.monotonic())+1)
except FileNotFoundError:
    emit('failure',code='not-found');time.sleep(max(0,deadline-time.monotonic())+1)
except PermissionError:
    emit('failure',code='permission');time.sleep(max(0,deadline-time.monotonic())+1)
except SystemExit: raise
except BaseException:
    emit('failure',code='protocol');time.sleep(max(0,deadline-time.monotonic())+1)
`;
