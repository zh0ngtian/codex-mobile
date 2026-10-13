"""真实 localhost HTTP 的渠道替身：检查 HEAD/完整 GET 与缺失阶段恢复。"""
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import importlib.util
import json
from pathlib import Path
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch

ROOT=Path(__file__).resolve().parents[2]
sys.path.insert(0,str(ROOT/'scripts'))


def load():
    spec=importlib.util.spec_from_file_location('channel_adapter',ROOT/'scripts/codex_mobile_release_adapter.py')
    module=importlib.util.module_from_spec(spec);spec.loader.exec_module(module)
    return module


class Channels:
    def __init__(self):
        self.files={}
        owner=self
        class Handler(BaseHTTPRequestHandler):
            def log_message(self,*args):pass
            def reply(self,head=False):
                body=owner.files.get(self.path)
                self.send_response(200 if body is not None else 404)
                self.send_header('Content-Length',str(len(body) if body is not None else 0));self.end_headers()
                if body is not None and not head:self.wfile.write(body)
            def do_GET(self):self.reply()
            def do_HEAD(self):self.reply(True)
        self.server=ThreadingHTTPServer(('127.0.0.1',0),Handler)
        self.thread=threading.Thread(target=self.server.serve_forever,daemon=True);self.thread.start()
        self.url=f'http://127.0.0.1:{self.server.server_port}'
    def close(self):self.server.shutdown();self.server.server_close();self.thread.join()


class ChannelAcceptance(unittest.TestCase):
    def setUp(self):
        self.temp=tempfile.TemporaryDirectory();root=Path(self.temp.name);self.module=load()
        try:self.channels=Channels()
        except PermissionError:self.temp.cleanup();self.skipTest('sandbox blocks local HTTP; run acceptance unsandboxed')
        self.patch=patch.object(self.module,'LAN',self.channels.url);self.patch.start()
        self.context={'id':'batch-http','project':'codex-mobile-lan-production','scope':'codex-mobile-main-production',
                      'workspace':str(root),'progressPath':str(root/'progress/http.json'),
                      'config':{'options':{'kind':'mobile','github_repository':'test/repo','lan_publisher':'/test/publisher.py'},'branch':'main'},
                      'tasks':[{'id':'task-http','sha':'a'*40}],
                      'frozen':{'sha':'b'*40,'version':'0.2.164','buildNumber':'2164'}}
        self.adapter=self.module.Adapter(self.context);self.adapter.progress('build',runId=123,attempt=1)
        self.artifacts=self.adapter.root/'ci-artifacts';self.artifacts.mkdir()
        for platform,filename in [('android','CodexMobile-v0.2.164.apk'),('ios','CodexMobile-v0.2.164-unsigned.ipa')]:
            path=self.artifacts/filename;path.write_bytes((platform+'-frozen').encode())
            self.module.atomic_json(self.artifacts/f'{platform}-build.json',{'platform':platform,'version':'0.2.164','buildNumber':'2164',
                'sourceCommit':'b'*40,'batchId':'batch-http','tasks':[{'id':'task-http','sha':'a'*40}],'runId':'123','runAttempt':'1',
                'sha256':self.module.sha256(path),'size':path.stat().st_size})
        signed=self.adapter.local_ipa(True);signed.write_bytes(b'signed-frozen-ipa')
        self.signed={'path':str(signed),'sha256':self.module.sha256(signed),'size':signed.stat().st_size,'version':'0.2.164',
                     'sourceCommit':'b'*40,'batchId':'batch-http','signed':True}
        self.sign_patch=patch.object(self.adapter,'sign_check',return_value={'done':True,'result':self.signed});self.sign_patch.start()
        self.original_command=self.adapter.command;self.published=[];self.lose=False;self.fail_ipa=False
        def command(args,**kwargs):
            if len(args)>1 and args[1]=='/test/publisher.py':
                path=Path(args[4]);ext=path.suffix[1:];self.published.append(ext)
                if ext=='ipa' and self.fail_ipa:raise OSError('single-channel outage')
                payload=path.read_bytes();suffix='-ios' if ext=='ipa' else ''
                self.channels.files['/latest.'+ext]=payload
                self.channels.files['/latest'+suffix+'.json']=json.dumps({'version':'0.2.164','size':len(payload),'sha256':self.module.sha256(path)}).encode()
                if self.lose:raise OSError('response lost after successful external write')
                return '{}'
            return self.original_command(args,**kwargs)
        self.command_patch=patch.object(self.adapter,'command',side_effect=command);self.command_patch.start()
    def tearDown(self):
        self.command_patch.stop();self.sign_patch.stop();self.patch.stop();self.channels.close();self.temp.cleanup()
    def test_lost_response_uses_real_http_state_without_second_publish(self):
        self.lose=True
        self.assertTrue(self.adapter.run_phase('apk')['done'])
        self.assertTrue(self.adapter.run_phase('apk')['done'])
        self.assertEqual(self.published,['apk'])
        self.assertEqual((self.adapter.root/'verified-lan.apk').read_bytes(),b'android-frozen')
    def test_single_channel_failure_preserves_successful_other_channel(self):
        self.assertTrue(self.adapter.run_phase('apk')['done']);self.fail_ipa=True
        with self.assertRaisesRegex(OSError,'single-channel'):self.adapter.run_phase('ipa')
        self.assertTrue(self.adapter.run_phase('apk')['done'])
        self.assertEqual(self.published,['apk','ipa'])
    def test_same_version_wrong_hash_is_rejected_without_overwrite(self):
        self.channels.files['/latest.json']=json.dumps({'version':'0.2.164','size':14,'sha256':'0'*64}).encode()
        with self.assertRaisesRegex(ValueError,'散列|大小'):self.adapter.run_phase('apk')
        self.assertEqual(self.published,[])


if __name__=='__main__':unittest.main()
