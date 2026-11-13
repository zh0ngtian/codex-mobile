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
class CleanupLocks:
    def __init__(self,journal): self.journal=journal;self.writer=None
    def __enter__(self): return self
    def close_writer(self):
        if self.writer is not None: self.writer.close();self.writer=None
    def __exit__(self,*args): self.close_writer();self.journal.close()
def inactive_lock(token):
    cleanup_record(token);handle=lock_file(cleanup_journal(token));locks=CleanupLocks(handle)
    try:
        if identity(os.fstat(handle.fileno()))!=token['cleanupLockIdentity']: raise Failure('version')
        acquire_lock(handle);intent=cleanup_record(token)
        # 清理锁稳定保留到最后；写者锁即使已被清理，也由持久intent证明先前已结束。
        paths=[os.path.join(token['directory'],'lock'),os.path.join(cleanup_path(token),'entry','lock'),os.path.join(cleanup_path(token),'files','writer-lock')]
        for candidate in paths:
            try: s=os.lstat(candidate)
            except FileNotFoundError: continue
            if identity(s)!=token['lockIdentity']: raise Failure('version')
            locks.writer=lock_file(candidate)
            if identity(os.fstat(locks.writer.fileno()))!=token['lockIdentity']: raise Failure('version')
            acquire_lock(locks.writer);break
        if locks.writer is None and intent is None: raise Failure('version')
        owned(token);return locks
    except BaseException:
        locks.__exit__();raise
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
def receipt_lines(path,expected):
    check();s=os.lstat(path)
    if identity(s)!=expected or not stat.S_ISREG(s.st_mode) or s.st_size>131072: raise Failure('version')
    with open(path,'rb') as f:
        if identity(os.fstat(f.fileno()))!=expected: raise Failure('version')
        raw=f.read(131073)
        if identity(os.lstat(path))!=expected or identity(os.fstat(f.fileno()))!=expected: raise Failure('version')
    if len(raw)>131072: raise Failure('version')
    return [json.loads(line) for line in raw.decode('utf-8','strict').split('\n')[:-1]]
def commit_records(token,entries):
    committed=None;captured=None
    for entry in entries:
        if entry.get('state')=='captured' and captured is None and committed is None:
            if set(entry)!={'state','directory','identity'} or type(entry['directory'])!=str or os.path.dirname(entry['directory'])!=os.path.dirname(token['directory']) or not os.path.basename(entry['directory']).startswith('.codex-mobile-commit-'+token['id']+'-') or set(entry['identity'])!={'dev','ino','mode'}: raise Failure('version')
            captured=entry
        elif entry.get('state')=='committed' and committed is None:
            if set(entry)!={'state','facts','size','sha256'} or entry['size']!=token['size'] or entry['sha256']!=token['sha256'] or {k:entry['facts'][k] for k in ('dev','ino','mode')}!=token['payloadIdentity']: raise Failure('version')
            committed=entry
        else: raise Failure('version')
    return committed,captured
def cleanup_path(token): return os.path.join(os.path.dirname(token['directory']),'.codex-mobile-cleanup-'+token['id'])
def cleanup_names(path):
    # 自有控制目录最多七个名字；未知内容也不能触发整目录无界加载。
    names=set()
    with os.scandir(path) as entries:
        for entry in entries:
            check()
            if len(names)>=8: raise Failure('version')
            names.add(entry.name)
    return names
def cleanup_journal(token):
    original=cleanup_path(token)+'.receipt';captured=original+'.captured'
    if os.path.lexists(original):
        if os.path.lexists(captured): raise Failure('version')
        return original
    return captured
def capture_journal(source,target):
    # 最后收据位于容器之外；系统原语原子拒绝覆盖并发出现的未知同名文件。
    check()
    if os.name=='nt':
        try: os.rename(source,target)
        except FileExistsError: raise Failure('version')
    else:
        import ctypes,errno
        library=ctypes.CDLL(None,use_errno=True)
        try:
            if sys.platform=='darwin':
                function=library.renamex_np;function.argtypes=[ctypes.c_char_p,ctypes.c_char_p,ctypes.c_uint];function.restype=ctypes.c_int
                result=function(os.fsencode(source),os.fsencode(target),4)
            elif sys.platform.startswith('linux'):
                function=library.renameat2;function.argtypes=[ctypes.c_int,ctypes.c_char_p,ctypes.c_int,ctypes.c_char_p,ctypes.c_uint];function.restype=ctypes.c_int
                result=function(-100,os.fsencode(source),-100,os.fsencode(target),1)
            else: raise Failure('capability')
        except AttributeError: raise Failure('capability')
        if result!=0:
            code=ctypes.get_errno()
            if code in (errno.ENOSYS,errno.EOPNOTSUPP,errno.ENOTSUP,errno.EINVAL): raise Failure('capability')
            if code==errno.EEXIST: raise Failure('version')
            raise OSError(code,'capture')
    check()
def cleanup_record(token):
    root=cleanup_path(token)
    try: lines=receipt_lines(cleanup_journal(token),token['cleanupLockIdentity'])
    except FileNotFoundError:
        # 可认证收据最后才删除；还有任何容器都不能靠token删除或误报missing。
        if os.path.lexists(root) or os.path.lexists(token['directory']): raise Failure('version')
        raise
    if len(lines) not in (1,2) or lines[0]!=token: raise Failure('version')
    intent=None if len(lines)==1 else lines[1]
    if intent is not None:
        if set(intent)!={'state','mode','records'} or intent['state']!='cleaning' or intent['mode'] not in ('release','discard') or type(intent['records'])!=list: raise Failure('version')
        commit_records(token,intent['records'])
    if os.path.lexists(root):
        if identity(os.lstat(root))!=token['cleanupIdentity'] or not stat.S_ISDIR(os.lstat(root).st_mode): raise Failure('version')
        files=os.path.join(root,'files')
        if os.path.lexists(files):
            if identity(os.lstat(files))!=token['cleanupFilesIdentity']: raise Failure('version')
        elif intent is None or cleanup_names(root): raise Failure('version')
    elif intent is None: raise Failure('version')
    return intent
# 首次持久收据已绑定固定清理位置及其锁inode。移动原operation也不丢恢复入口。
def owned(token,location=None):
    intent=cleanup_record(token)
    if intent is not None and location is None:
        committed,captured=commit_records(token,intent['records'])
        root=cleanup_path(token);directory=os.path.join(root,'entry')
        if os.path.lexists(directory):
            if identity(os.lstat(directory))!=token['directoryIdentity']: raise Failure('version')
        else:
            directory=token['directory']
            if os.path.lexists(directory) and identity(os.lstat(directory))!=token['directoryIdentity']: raise Failure('version')
        return directory,os.path.join(directory,'payload'),os.path.join(directory,'receipt'),committed,captured
    directory=token['directory'] if location is None else location
    # 固定入口仍有自有收据时，原暂存路径缺失是所有权异常，不是操作已清完。
    if not os.path.lexists(directory) or not os.path.lexists(os.path.join(directory,'receipt')) or not os.path.lexists(os.path.join(directory,'lock')): raise Failure('version')
    if identity(os.lstat(directory))!=token['directoryIdentity'] or not stat.S_ISDIR(os.lstat(directory).st_mode): raise Failure('version')
    locked=os.lstat(os.path.join(directory,'lock'))
    if identity(locked)!=token['lockIdentity'] or not stat.S_ISREG(locked.st_mode): raise Failure('version')
    record_path=os.path.join(directory,'receipt');lines=receipt_lines(record_path,token['receiptIdentity'])
    if len(lines) not in (1,2,3) or lines[0]!=token: raise Failure('version')
    committed,captured=commit_records(token,lines[1:])
    return directory,os.path.join(directory,'payload'),record_path,committed,captured

def resolve(token):
    if 'directoryIdentity' in token:
        owned(token);return token
    # begin响应丢失只留下locator时也只查两个固定位置，无扫描和同名猜测。
    receipt=cleanup_journal(token)
    try: s=os.lstat(receipt)
    except FileNotFoundError:
        if os.path.lexists(cleanup_path(token)) or os.path.lexists(token['directory']): raise Failure('version')
        raise
    lines=receipt_lines(receipt,identity(s))
    if not lines: raise Failure('version')
    actual=lines[0]
    if any(actual.get(k)!=v for k,v in token.items()) or set(actual)!=set(token)|{'directoryIdentity','receiptIdentity','payloadIdentity','lockIdentity','cleanupIdentity','cleanupLockIdentity','cleanupFilesIdentity'}: raise Failure('version')
    owned(actual);return actual

def inspect(token):
    try: directory,payload,receipt,committed,captured=owned(token)
    except FileNotFoundError: return dict(state='missing')
    try:
        size,digest,value=filehash(token['path'],token['payloadIdentity'])
        if size==token['size'] and digest==token['sha256']:
            if committed is not None: return dict(state='committed',size=committed['size'],sha256=committed['sha256'],facts=committed['facts'],currentMatches=value==committed['facts'])
            return dict(state='committed',size=size,sha256=digest,facts=value,currentMatches=True)
    except (FileNotFoundError,Failure): pass
    if committed is not None: return dict(state='committed',size=committed['size'],sha256=committed['sha256'],facts=committed['facts'],currentMatches=False)
    try:
        if captured is not None:
            if identity(os.lstat(captured['directory']))!=captured['identity']: raise Failure('version')
            payload=os.path.join(captured['directory'],'payload')
        size,digest,value=filehash(payload,token['payloadIdentity'])
        return dict(state='staged' if size==token['size'] and digest==token['sha256'] else 'receiving',size=size,sha256=digest)
    except (FileNotFoundError,Failure): return dict(state='unknown')
def cleanup_directory(token,directory,expected_directory,slot,entries,locks):
    root=cleanup_path(token);held=os.path.join(root,slot);cleanup_record(token)
    if not os.path.lexists(held) and os.path.lexists(directory):
        if identity(os.lstat(directory))!=expected_directory: raise Failure('version')
        if not cleanup_names(directory)<={name for name,_,_ in entries}: raise Failure('version')
        os.rename(directory,held)
    if os.path.lexists(held):
        if identity(os.lstat(held))!=expected_directory or not cleanup_names(held)<={name for name,_,_ in entries}: raise Failure('version')
    for name,target_name,expected in entries:
        check();cleanup_record(token);source=os.path.join(held,name);target=os.path.join(root,'files',target_name)
        if os.path.lexists(source):
            if identity(os.lstat(source))!=expected or os.path.lexists(target): raise Failure('version')
            os.rename(source,target)
        if os.path.lexists(target):
            if identity(os.lstat(target))!=expected: raise Failure('version')
            os.unlink(target)
            if name=='lock': locks.close_writer()
    if os.path.lexists(held):
        if identity(os.lstat(held))!=expected_directory: raise Failure('version')
        os.rmdir(held)
def cleanup(token,locks,mode):
    directory,payload,receipt,committed,commit_capture=owned(token);intent=cleanup_record(token)
    if intent is None:
        observed=inspect(token)
        if (mode=='release' and observed['state']!='committed') or (mode=='discard' and observed['state'] not in ('receiving','staged')): raise Failure('version')
        records=receipt_lines(receipt,token['receiptIdentity'])[1:]
        if mode=='release' and committed is None: records.append(dict(state='committed',facts=observed['facts'],size=observed['size'],sha256=observed['sha256']))
        intent=dict(state='cleaning',mode=mode,records=records)
        handle=locks.journal;handle.seek(0);raw=handle.read(131073)
        # 只截去未完成的末行；原始token始终保留，完整intent在任何捕获前fsync。
        end=raw.rfind(b'\n')+1;handle.seek(end);handle.truncate()
        handle.write((json.dumps(intent,separators=(',',':'))+'\n').encode('ascii'));handle.flush();os.fsync(handle.fileno())
        cleanup_record(token)
    elif intent['mode']!=mode: raise Failure('version')
    root=cleanup_path(token)
    if os.path.lexists(root):
        if not cleanup_names(root)<={'entry','commit','files'}: raise Failure('version')
        if os.path.lexists(os.path.join(root,'files')) and not cleanup_names(os.path.join(root,'files'))<={'payload','receipt','writer-lock','commit-payload'}: raise Failure('version')
    # 所有中断位置都固定且有原始inode证明；未知替换物留在原地，绝不恢复到用户路径。
    if commit_capture is not None:
        cleanup_directory(token,commit_capture['directory'],commit_capture['identity'],'commit',[('payload','commit-payload',token['payloadIdentity'])],locks)
    cleanup_directory(token,token['directory'],token['directoryIdentity'],'entry',[('payload','payload',token['payloadIdentity']),('receipt','receipt',token['receiptIdentity']),('lock','writer-lock',token['lockIdentity'])],locks)
    cleanup_record(token)
    if os.path.lexists(root):
        names=cleanup_names(root);files=os.path.join(root,'files')
        if names=={'files'}:
            if identity(os.lstat(files))!=token['cleanupFilesIdentity'] or cleanup_names(files): raise Failure('version')
            os.rmdir(files)
        elif names: raise Failure('version')
        cleanup_record(token)
        if identity(os.lstat(root))!=token['cleanupIdentity']: raise Failure('version')
        os.rmdir(root)
    # 最后收据/清理锁在容器之外，全部自有目录移除后才原子捕获和删除。
    original=root+'.receipt';journal=original+'.captured'
    if os.path.lexists(original):
        if os.path.lexists(journal): raise Failure('version')
        capture_journal(original,journal)
    cleanup_record(token)
    os.unlink(journal);locks.journal.close()

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
        cleanup_directory_path=cleanup_path(request);os.mkdir(cleanup_directory_path,0o700)
        cleanup_files=os.path.join(cleanup_directory_path,'files');os.mkdir(cleanup_files,0o700)
        cleanup_lock=lock_file(cleanup_directory_path+'.receipt',True)
        payload=os.path.join(directory,'payload');receipt=os.path.join(directory,'receipt')
        writer_lock=lock_file(os.path.join(directory,'lock'),True);writer_lock.write(b'1');writer_lock.flush();acquire_lock(writer_lock);os.fsync(writer_lock.fileno())
        with open(payload,'xb') as f:
            os.chmod(payload,0o600)
            with open(receipt,'xb') as record:
                os.chmod(receipt,0o600)
                token=dict(id=request['id'],namespace=request['namespace'],path=path,directory=directory,directoryIdentity=identity(os.lstat(directory)),receiptIdentity=identity(os.fstat(record.fileno())),payloadIdentity=identity(os.fstat(f.fileno())),lockIdentity=identity(os.fstat(writer_lock.fileno())),cleanupIdentity=identity(os.lstat(cleanup_directory_path)),cleanupLockIdentity=identity(os.fstat(cleanup_lock.fileno())),cleanupFilesIdentity=identity(os.lstat(cleanup_files)),size=size,sha256=digest,expected=request['expected'])
                token_bytes=(json.dumps(token,separators=(',',':'),ensure_ascii=True)+'\n').encode('ascii')
                record.write(token_bytes);record.flush();os.fsync(record.fileno())
                cleanup_lock.write(token_bytes);cleanup_lock.flush();os.fsync(cleanup_lock.fileno());cleanup_lock.close()
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
            cleanup(token,lock,'release')
        finish('cleaned')
    elif mode=='discard':
        token=resolve(request['operation'])
        with inactive_lock(token) as lock:
            cleanup(token,lock,'discard')
        finish('cleaned')
    elif mode=='cleanup':
        token=resolve(request['operation'])
        with inactive_lock(token) as lock:
            cleanup(token,lock,'discard')
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
