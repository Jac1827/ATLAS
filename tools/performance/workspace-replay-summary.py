import collections,json,math,pathlib,statistics,sys
if len(sys.argv)!=2:
    raise SystemExit('Usage: python3 tools/performance/workspace-replay-summary.py RESULTS.json')
result_path=pathlib.Path(sys.argv[1]).resolve()
root=result_path.parent
x=json.loads(result_path.read_text())
metadata_errata=[]
old_limit='Historical 4263a58 predates AtlasReskin history and performance diagnostics; those unavailable probes are null, not fabricated. Home-history parity compares baseline and repaired only.'
new_limit='Historical 4263a58 predates AtlasReskin.history; only that optional probe is unavailable. Historical performance diagnostic counters are present and retained. Home-history parity compares baseline and repaired only.'
if old_limit in x['limits']:
    x['limits']=[new_limit if item==old_limit else item for item in x['limits']]
    metadata_errata.append('Corrected the overly broad historical-diagnostics limitation. Raw measurements are unchanged; diagnostic counters were recorded correctly.')
MiB=1024**2

def stats(values):
    values=[v for v in values if isinstance(v,(int,float)) and math.isfinite(v)]
    return {'samples':values,'median':statistics.median(values),'max':max(values)} if values else {'samples':[],'median':None,'max':None}

def budget(s,limit):
    return {**s,'limit':limit,'allSamplesPass':s['max'] is not None and s['max']<=limit}

groups=[]
for g in x['results']:
    mobile=g['device']=='mobile';d={'build':g['build'],'device':g['device'],'startup':{},'navigation':{},'parity':g['parity'],'errors':g['errors']}
    for cache in ['cold','warm']:
        rows=[r for r in g['startup'] if r['cache']==cache]
        d['startup'][cache]={'usableMs':budget(stats([r['readyElapsed'] for r in rows]),(5000 if mobile else 3000) if cache=='cold' else (2000 if mobile else 1000)), 'longestTaskMs':budget(stats([r['longestTask'] for r in rows]),200 if mobile else 100),'blockingTimeThroughObservationMs':budget(stats([r['blockingTime'] for r in rows]),600 if mobile else 300),'firstTenSecondsBlockingTimeMs':budget(stats([sum(max(0,min(t['duration'],10000-t['start'])-50)for t in r['longTasks'] if t['start']<10000)for r in rows]),600 if mobile else 300),'renderCount':stats([r.get('renderCount')for r in rows]),'apiRequests':stats([r['apiRequests'] for r in rows]),'cdpCacheHits':stats([r['cdpCacheHits'] for r in rows])}
        shell=stats([r.get('authenticatedShellMs') for r in rows])
        shell['availableCount']=len(shell['samples']);shell['unavailableCount']=len(rows)-len(shell['samples'])
        shell['basis']='Navigation timeOrigin to post-authorization interactive-shell paint; loading placeholders are excluded'
        if cache=='warm':
            shell['limit']=600 if mobile else 300
            shell['allSamplesPass']=(shell['max']<=shell['limit'] if shell['samples'] and not shell['unavailableCount'] else None)
        d['startup'][cache]['authenticatedShellMs']=shell
    for tab,label in [(0,'Home'),(8,'Reports'),(7,'Import'),(2,'Command'),(9,'Bonus')]:
        first=[r for r in g['navigation'] if r['tab']==tab and r['stage']=='first-loop'];repeated=[r for r in g['navigation'] if r['tab']==tab and r['stage']=='repeated']
        d['navigation'][label]={'firstLoopMs':budget(stats([r['ms'] for r in first]),1000 if mobile else 500),'firstLoopLongestTaskMs':budget(stats([r['longestTask'] for r in first]),200 if mobile else 100),'repeatedMs':budget(stats([r['ms'] for r in repeated]),400 if mobile else 200),'repeatedLongestTaskMs':budget(stats([r['longestTask'] for r in repeated]),200 if mobile else 100),'repeatedRenderCount':stats([r['renders'] for r in repeated]),'apiRequests':stats([r['apiRequests'] for r in repeated])}
    heap=g['heap'];start=heap['before']['usedSize'];end=heap['after']['usedSize'];sampled=[r.get('heap',0) or 0 for r in g['startup']+g['navigation']]
    d['memory']={'beforeRepeatedLoopsMiB':start/MiB,'afterRepeatedLoopsMiB':end/MiB,'retainedGrowthMiB':(end-start)/MiB,'retainedGrowthPass':end-start<=10*MiB,'steadyPass':end<=150*MiB,'peakSampledMiB':max(sampled)/MiB,'sampledHeapPass':max(sampled)<=250*MiB,'sampledHeapLimitMiB':250,'transientPeakMeasured':False,'domBefore':heap['domBefore'],'domAfter':heap['dom']}
    d['variants']=g.get('variants',[])
    d['renderIssues']=[{'tab':r['tab'],'cycle':r['cycle']}for r in g['navigation'] if r['renderIssue']]
    groups.append(d)
keys=['homeHistoryHash','homeValue','monthlyNormalizationMatchesBaseline','communityProgressHash','communityDocumentHash','operatingDataHash','reportAggregateHash','exportRowsHash','reportDetailCount','exportRowCount','period']
parity={k:{'allEqual':len({json.dumps(g['parity'][k],sort_keys=True)for g in x['results'] if g['parity'][k]is not None})==1,'availableCount':sum(g['parity'][k]is not None for g in x['results']),'unavailableCount':sum(g['parity'][k]is None for g in x['results']),'values':[{'build':g['build'],'device':g['device'],'value':g['parity'][k]}for g in x['results']]}for k in keys}
shared_keys=['homeValue','monthlyNormalizationMatchesBaseline','operatingDataHash','reportAggregateHash','exportRowsHash','reportDetailCount','exportRowCount','period']
repaired_reference=[g for g in x['results']if g['build']in ['baseline','repaired']]
reference_complete={g['build']for g in repaired_reference}=={'baseline','repaired'}
reference_parity={k:(len({json.dumps(g['parity'][k],sort_keys=True)for g in repaired_reference})==1 if reference_complete else None) for k in keys}
comparison={'sharedOperatingDataAllBuilds':all(parity[k]['allEqual']for k in shared_keys),'baselineRepairedComplete':reference_complete,'baselineRepaired':reference_parity}
blocked=collections.Counter((r['build'],r['device'],r['method'],r['path'])for r in x['blocked'])
api_groups=collections.defaultdict(list)
for r in x.get('clientApi',[]):
    api_groups[(r['build'],r['device'],r['method'],r['path'])].append(r)
api_summary=[dict(zip(['build','device','method','endpoint'],key),count=len(rows),statuses=dict(collections.Counter(str(r.get('status','unavailable'))for r in rows)),outcomes=dict(collections.Counter(r.get('outcome','pending_at_capture')for r in rows)),durationMs=stats([r.get('durationMs')for r in rows]))for key,rows in api_groups.items()]
quality={'monthlyNormalizationPass':all(g['parity']['monthlyNormalizationMatchesBaseline']is True for g in x['results']),'noPageErrors':all(not g['errors']for g in x['results']),'noRenderIssues':all(not r['renderIssue']for g in x['results']for r in g['navigation']),'noExternalResponses':all(g.get('externalResponseCount',0)==0 for g in x['results']),'repairedOperationalWriteAttempts':[r for r in x['blocked']if r['build']=='repaired' and not r['path'].endswith(('/atlas_upsert_live_session','/atlas_end_live_session'))]}
summary={'metadataErrata':metadata_errata,'comparison':comparison,'quality':quality,'apiRequests':api_summary,'kind':x['kind'],'browser':x['browser'],'date':x['date'],'fixture':x['fixture'],'configuration':x['configuration'],'limits':x['limits'],'groups':groups,'parity':parity,'blockedWrites':[dict(zip(['build','device','method','endpoint'],k),count=v)for k,v in blocked.items()]}
(root/'summary.json').write_text(json.dumps(summary,indent=2)+'\n')
lines=['# Isolated three-build replay','',f"Browser: {x['browser']}. This is local read-only replay, not authenticated production acceptance.",'', 'All metrics are milliseconds unless marked otherwise; median / maximum.']
lines+=['','| Build / device | Cold usable | Warm usable | Home repeated | Reports repeated | Import repeated | Command repeated | Bonus repeated | Heap growth MiB |','|---|---:|---:|---:|---:|---:|---:|---:|---:|']
def pair(s):return 'unavailable' if s['median']is None else f"{s['median']:g} / {s['max']:g}"
for g in groups:lines.append('| '+g['build']+' / '+g['device']+' | '+' | '.join([pair(g['startup']['cold']['usableMs']),pair(g['startup']['warm']['usableMs'])]+[pair(g['navigation'][t]['repeatedMs'])for t in ['Home','Reports','Import','Command','Bonus']]+[f"{g['memory']['retainedGrowthMiB']:.2f}"])+' |')
reference_status=str(all(reference_parity.values())) if reference_complete else 'unavailable (both control and candidate were not measured in this run)'
lines+=['','Shared operating-data parity across measured groups: '+str(comparison['sharedOperatingDataAllBuilds'])+'. Baseline/repaired report and data parity: '+reference_status+'. Historical Community Progress differences remain separately recorded when measured in summary.json.','','Heap maxima are sampled checkpoints; transient peak acceptance remains unmeasured.','','Limits:']+['- '+v for v in x['limits']]
(root/'summary.md').write_text('\n'.join(lines)+'\n')
print(json.dumps({'groups':len(groups),'parityAllEqual':all(r['allEqual']for r in parity.values()),'output':str(root/'summary.json')}))
