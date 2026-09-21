"""Run real browser functions against synthetic state; never persist or bypass auth.

Requires an already open LOCAL dashboard page in Chrome DevTools CLI.
"""
import argparse, json, re, subprocess
from pathlib import Path

p=argparse.ArgumentParser()
p.add_argument('--node', default='node')
p.add_argument('--devtools', required=True, help='Installed Chrome DevTools CLI JS entrypoint')
p.add_argument('--page', required=True)
p.add_argument('--output', required=True)
p.add_argument('--baseline', default='d06d902')
p.add_argument('--employees', type=int, default=150)
args=p.parse_args()
if not 1 <= args.employees <= 10000: p.error('--employees must be between 1 and 10000')
root=Path(__file__).resolve().parents[2]
old=subprocess.check_output(['git','show',args.baseline+':docs/portfolio-operations-dashboard/index.html'],cwd=root,text=True)
script=Path(__file__).with_name('staffing-browser-benchmark.template.js').read_text().replace('__EMPLOYEES__',str(args.employees))
for name, replacement, placeholder in [('syncAllCommunityStaffingFromPeopleRoster','originalStaffingSync','__ORIGINAL_SYNC__'),('getPeopleRosterTurnoverByQuarterForCommunity','originalTurnover','__ORIGINAL_TURNOVER__')]:
    match=re.search(r'^function '+name+r'\([^\n]*\) \{[\s\S]*?^\}',old,re.M)
    if not match: raise ValueError('Missing baseline function: '+name)
    script=script.replace(placeholder,match[0].replace('function '+name,'function '+replacement,1))
script=script.replace('() => {','() => {\nif (!["localhost","127.0.0.1"].includes(location.hostname)) throw Error("Local benchmark only");',1)
result=subprocess.run([args.node,args.devtools,'evaluate_script',script,'--pageId',args.page],capture_output=True,text=True,check=True)
match=re.search(r'```json\s*([\s\S]*?)\s*```',result.stdout)
if not match: raise RuntimeError(result.stdout+result.stderr)
payload={'baseline':args.baseline,'scope':'Synthetic browser function parity, not authenticated acceptance','results':json.loads(match[1])}
Path(args.output).write_text(json.dumps(payload,indent=2)+'\n')
print(json.dumps(payload,indent=2))
