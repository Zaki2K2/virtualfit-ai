"""Offline CPU experiment: real SSE first-token timings and paired grounded JSON quality."""
import argparse
import ctypes
from datetime import datetime, timezone
import hashlib
import json
import os
from pathlib import Path
import socket
import statistics
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request

from runtime import CONFIG, ROOT, port_owner, local_open


def memory(pid):
    if os.name != 'nt': return {}
    class Counters(ctypes.Structure):
        _fields_ = [('cb',ctypes.c_ulong),('faults',ctypes.c_ulong)] + [(name,ctypes.c_size_t) for name in ['peak_working_set','working_set','peak_paged','paged','peak_nonpaged','nonpaged','pagefile','peak_pagefile','private_bytes']]
    kernel=ctypes.WinDLL('kernel32',use_last_error=True)
    kernel.OpenProcess.restype=ctypes.c_void_p
    kernel.CloseHandle.argtypes=[ctypes.c_void_p]
    api=ctypes.WinDLL('psapi');api.GetProcessMemoryInfo.argtypes=[ctypes.c_void_p,ctypes.c_void_p,ctypes.c_ulong]
    handle=kernel.OpenProcess(0x410,False,pid)
    if not handle:return {}
    value=Counters();value.cb=ctypes.sizeof(value)
    try:
        if not api.GetProcessMemoryInfo(handle,ctypes.byref(value),value.cb):return {}
        return {key:getattr(value,key) for key in ['working_set','peak_working_set','private_bytes']}
    finally:kernel.CloseHandle(handle)


def request(url,path,key,body=None,timeout=3):
    req=urllib.request.Request(url+path,data=json.dumps(body).encode() if body is not None else None,
        headers={'Content-Type':'application/json','Authorization':'Bearer '+key})
    return local_open(req,timeout=timeout)


def stop_console(process):
    if process.poll() is not None:return process.returncode
    if os.name == 'nt':
        helper='import ctypes,time; k=ctypes.WinDLL("kernel32"); k.FreeConsole(); assert k.AttachConsole('+str(process.pid)+'); k.SetConsoleCtrlHandler(None,True); assert k.GenerateConsoleCtrlEvent(0,0); time.sleep(.1); k.FreeConsole()'
        subprocess.run([sys.executable,'-c',helper],check=True,timeout=5)
    else:process.send_signal(2)
    return process.wait(timeout=15)


def stream(url,key,payload):
    started=time.perf_counter();first=None;parts=[];timings={};usage={};finish=None
    with request(url,'/v1/chat/completions',key,{**payload,'stream':True,'stream_options':{'include_usage':True}},60) as response:
        for raw in response:
            if time.perf_counter()-started>60:raise TimeoutError('60-second total benchmark deadline')
            if not raw.startswith(b'data:'):continue
            data=raw[5:].strip()
            if data==b'[DONE]':break
            item=json.loads(data)
            timings=item.get('timings') or timings;usage=item.get('usage') or usage
            for choice in item.get('choices',[]):
                text=choice.get('delta',{}).get('content') or ''
                if text:
                    if first is None:first=time.perf_counter()-started
                    parts.append(text)
                finish=choice.get('finish_reason') or finish
    return {'first_token_seconds':first,'total_seconds':time.perf_counter()-started,'raw':''.join(parts),'timings':timings,'usage':usage,'finish_reason':finish}


def quality(result,fixture):
    output={'schema_valid':False,'grounded':False,'exact_ids':False,'categories_exact':False}
    try:
        row=json.loads(result['raw']);ids=row['itemIds'];cats=row['categories']
        assert set(row)=={'answer','itemIds','occasion','categories'}
        assert isinstance(row['answer'],str) and 0<len(row['answer'])<=600
        assert isinstance(row['occasion'],str) and len(row['occasion'])<=80
        assert isinstance(ids,list) and len(ids)<=4 and all(isinstance(i,str) for i in ids)
        assert isinstance(cats,list) and len(cats)<=4 and all(c in ['tops','bottoms','dresses','outerwear'] for c in cats)
        assert result['finish_reason']=='stop'
        output['schema_valid']=True
        allowed={i['id'] for i in fixture['context']['wardrobe']}
        output['grounded']=len(ids)==len(set(ids)) and set(ids)<=allowed
        output['exact_ids']=set(ids)==set(fixture['expected']['itemIds'])
        output['categories_exact']=set(cats)==set(fixture['expected']['categories'])
        output['answer_words']=len(row['answer'].split())
        output['answer']=row['answer']
    except (AssertionError,ValueError,TypeError,KeyError):pass
    return output


def run(fixtures_path,output,port=8081,profiles=None):
    fixtures=json.loads(fixtures_path.read_text())
    url=f'http://127.0.0.1:{port}'
    with socket.socket() as probe:
        if probe.connect_ex(('127.0.0.1',port))==0:raise RuntimeError(f'Port {port} already occupied; stop the known SLM before exclusive CPU experiments')
    key=(ROOT/'runtime/api-key.txt').read_text().strip()
    settings=[('baseline',4,2048,'oldSystem',260),('concise',4,2048,'conciseSystem',260),('threads2',2,2048,'conciseSystem',260),('context1024',4,1024,'conciseSystem',260),('tokens180',4,2048,'conciseSystem',180),('grounded',4,2048,'groundedSystem',260),('fewshot',4,2048,'fewshotSystem',260)]
    if profiles:
        unknown=set(profiles)-{s[0] for s in settings}
        if unknown: raise ValueError('Unknown benchmark profiles: '+', '.join(sorted(unknown)))
        settings=[s for s in settings if s[0] in profiles]
    report={'time':datetime.now(timezone.utc).isoformat(),'model':CONFIG['filename'],'model_sha256':CONFIG['model_sha256'],'runtime_tag':CONFIG['runtime_tag'],'fixture_sha256':hashlib.sha256(fixtures_path.read_bytes()).hexdigest(),'logical_cpus':os.cpu_count(),'profiles':[],'limitations':'Eight public synthetic cases, one pass per setting, page-cache warm startup; small sample, not general quality proof. No other SLM instance runs during a profile.'}
    output.parent.mkdir(parents=True,exist_ok=True)
    for name,threads,context,prompt,tokens in settings:
        profile={'name':name,'threads':threads,'context':context,'max_tokens':tokens,'cases':[]}
        log=ROOT/'runs'/f'cpu-{name}.log';process=None;stop_sampling=threading.Event();sampler=None;samples=[]
        try:
            with log.open('w') as logs:
                options={}
                if os.name=='nt':
                    startup=subprocess.STARTUPINFO();startup.dwFlags|=subprocess.STARTF_USESHOWWINDOW;startup.wShowWindow=0
                    options={'creationflags':subprocess.CREATE_NEW_CONSOLE,'startupinfo':startup}
                started=time.perf_counter()
                process=subprocess.Popen([sys.executable,str(ROOT/'tools/runtime.py'),'serve','--port',str(port),'--threads',str(threads),'--context',str(context)],stdout=logs,stderr=subprocess.STDOUT,**options)
                while True:
                    if process.poll() is not None:raise RuntimeError(f'Launcher exited {process.returncode}; see {log.name}')
                    try:
                        with request(url,'/health',key) as response:
                            if json.load(response).get('status')=='ok':break
                    except OSError:
                        if time.perf_counter()-started>90:raise RuntimeError('Startup health deadline')
                        time.sleep(.05)
                profile['startup_to_health_seconds']=time.perf_counter()-started
                pid=int(json.loads(port_owner(port))['OwningProcess']) if os.name=='nt' else process.pid
                def sample():
                    while not stop_sampling.wait(.1):samples.append(memory(pid))
                sampler=threading.Thread(target=sample,daemon=True);sampler.start()
                for fixture in fixtures['fixtures']:
                    payload={'model':CONFIG['alias'],'messages':[{'role':'system','content':fixtures[prompt]}] + (fixtures.get('fewshotMessages',[]) if prompt=='fewshotSystem' else []) + [{'role':'user','content':json.dumps(fixture['context'],separators=(',',':'))}], 'temperature':.2,'seed':42,'max_tokens':tokens,'response_format':{'type':'json_object','schema':fixture['schema']},'cache_prompt':False}
                    case={'id':fixture['id'],'request_sha256':hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest()}
                    try:
                        result=stream(url,key,payload)
                        case.update(result);case.update(quality(result,fixture));case['timeout']=False
                    except (OSError,ValueError) as exc:
                        case.update(error=str(exc),timeout=isinstance(exc,TimeoutError) or isinstance(exc,urllib.error.HTTPError) and exc.code==504)
                    profile['cases'].append(case)
                    print(json.dumps({'profile':name,'id':case['id'],'seconds':case.get('total_seconds'),'exact_ids':case.get('exact_ids'),'timeout':case['timeout']}),flush=True)
                good=[c for c in profile['cases'] if 'total_seconds' in c]
                profile['summary']={'requests':len(profile['cases']),'completed':len(good),'timeouts':sum(c['timeout'] for c in profile['cases']),'schema_valid':sum(c.get('schema_valid',False) for c in profile['cases']),'exact_ids':sum(c.get('exact_ids',False) for c in profile['cases']),'categories_exact':sum(c.get('categories_exact',False) for c in profile['cases'])}
                if good:
                    profile['summary'].update(median_ttft_seconds=statistics.median(c['first_token_seconds'] for c in good if c['first_token_seconds'] is not None),median_total_seconds=statistics.median(c['total_seconds'] for c in good),median_prompt_tokens_per_second=statistics.median(c['timings'].get('prompt_per_second',0) for c in good),median_generated_tokens_per_second=statistics.median(c['timings'].get('predicted_per_second',0) for c in good))
        except (OSError,RuntimeError,ValueError) as exc:profile['error']=str(exc)
        finally:
            stop_sampling.set()
            if sampler:sampler.join(timeout=2)
            profile['peak_sampled_working_set_bytes']=max((s.get('working_set',0) for s in samples),default=0)
            profile['peak_sampled_private_bytes']=max((s.get('private_bytes',0) for s in samples),default=0)
            if process is not None:
                try:profile['wrapper_stop_code']=stop_console(process)
                except (OSError,subprocess.SubprocessError) as exc:
                    profile['cleanup_error']=str(exc)
                    if process.poll() is None:
                        subprocess.run(['taskkill','/PID',str(process.pid),'/T','/F'],capture_output=True,timeout=10);process.wait(timeout=5)
            report['profiles'].append(profile)
            output.write_text(json.dumps(report,indent=2))
    print('Saved real CPU experiment:',output)
    return bool(report['profiles']) and all('error' not in p and p.get('wrapper_stop_code') == 0 and p.get('summary',{}).get('completed') == p.get('summary',{}).get('requests') for p in report['profiles'])


if __name__=='__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--fixtures',type=Path,default=ROOT/'runs/cpu-fixtures.json')
    parser.add_argument('--output',type=Path,default=ROOT/'runs/cpu-benchmark.json')
    parser.add_argument('--port',type=int,default=8081)
    parser.add_argument('--profiles',nargs='+')
    args=parser.parse_args();raise SystemExit(0 if run(args.fixtures,args.output,args.port,args.profiles) else 1)
