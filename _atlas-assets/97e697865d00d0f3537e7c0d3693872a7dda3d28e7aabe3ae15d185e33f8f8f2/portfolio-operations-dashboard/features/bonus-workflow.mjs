import { createBonusWorkflowClient } from './bonus-workflow-client.mjs?v=74c3a31ff88f9797';

const clients = new WeakMap(), mounts = new WeakMap();
const esc = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[char]));
const money = value => value === null || value === undefined ? 'Pending' : new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' }).format(Number(value));
const metrics = [['revenue', 'Revenue'], ['expenses', 'Expenses'], ['noi', 'NOI'], ['cash_flow', 'Cash flow'], ['budget_attainment', 'Budget attainment']];
const button = (text, type = 'submit') => `<button class="btn btn-blue btn-sm" type="${type}">${esc(text)}</button>`;
const field = (label, control) => `<label class="bonus-engine-field"><span>${esc(label)}</span>${control}</label>`;
const input = (name, value = '', extra = '') => `<input name="${esc(name)}" value="${esc(value)}" ${extra}>`;
const options = (rows, value, label, selected = '') => rows.map(row => `<option value="${esc(value(row))}" ${String(value(row)) === String(selected) ? 'selected' : ''}>${esc(label(row))}</option>`).join('');
const select = (name, rows, value, label, selected = '') => `<select name="${esc(name)}" required><option value="">Choose explicitly</option>${options(rows, value, label, selected)}</select>`;
const reason = () => field('Reason for this change', input('reason', '', 'required maxlength="1000"'));

export function planPayload(form, communities, previous = null) {
  const selected = metrics.filter(([key]) => form.get('include_' + key) === 'on');
  if (!selected.length) throw new Error('Choose at least one financial measure.');
  const number = key => { const raw=String(form.get(key)??'').trim(); if(!raw) throw new Error('Enter a number for '+key.replaceAll('_',' ')+'.'); const value=Number(raw); if(!Number.isFinite(value))throw new Error('Enter a finite number.'); return value; };
  const curve = [0, 1, 2, 3].map(index => ({ thresholdPct: number('threshold_' + index), payoutPct: number('payout_' + index) }));
  if (!communities.length || communities.some(id=>!id)) throw new Error('Choose at least one authorized community.');
  if(previous && new Set(previous.metrics.map(metric=>metric.metricKey)).size!==previous.metrics.length)throw new Error('This plan has multiple measures of one financial type. Its terms are retained; revise it through a supported detailed plan editor.');
  if (curve.some(item => !Number.isFinite(item.thresholdPct) || !Number.isFinite(item.payoutPct))) throw new Error('Enter a number for every threshold and payout percentage.');
  return {
    name: String(form.get('name') || '').trim(), roleId: form.get('roleId'), effectiveStart: form.get('effectiveStart'), effectiveEnd: form.get('effectiveEnd') || null,
    targetBonus: number('targetBonus'), maximumPayout: number('maximumPayout'),
    eligibilityRules: { requireBonusEligible: true, communityIds: communities },
    metrics: selected.map(([metricKey, name]) => { const old=previous?.metrics?.find(metric=>metric.metricKey===metricKey); return { id: old?.id || 'financial_' + metricKey, name: old?.name || name, metricKey, goal: number('goal_' + metricKey), weight: number('weight_' + metricKey), thresholdCurve: old && form.get('replaceCurve')!=='on' ? old.thresholdCurve : curve }; }),
    reason: String(form.get('reason') || '').trim()
  };
}

export async function mountBonusWorkflow(host, { central, periodKey, onChange = () => {} } = {}) {
  if (!host || !central) return;
  let client = clients.get(central);
  if (!client) { client = createBonusWorkflowClient(central); clients.set(central, client); }
  const mountToken={},actor=central.getSession?.()?.user?.id;mounts.set(host,mountToken);
  let data = null, notice = '', error = '', busy = false, generation = 0, pendingReadback=false,pendingFormKey=null;
  const drafts=new Map(),resetForms=new Set();
  const alive = () => host.isConnected && mounts.get(host)===mountToken;
  const formKey=form=>form.dataset.form+'|'+(form.dataset.run||'');
  const capture=()=>{if(actor!==central.getSession?.()?.user?.id)return;for(const form of host.querySelectorAll('form')){const key=formKey(form);if(resetForms.has(key)){drafts.delete(key);continue;}drafts.set(key,[...form.elements].filter(el=>el.name).map(el=>({name:el.name,value:el.value,checked:el.checked,selected:el.multiple?[...el.selectedOptions].map(option=>option.value):null})));}};
  function checkActor(){if(actor!==central.getSession?.()?.user?.id){data=null;drafts.clear();notice='';pendingReadback=false;throw new Error('Your account changed. Reopen shared Bonus approvals before continuing.');}}

  function setBusy(value) {
    busy = value;
    host.querySelectorAll('button,input,select').forEach(control => { control.disabled = value; });
    host.setAttribute('aria-busy', String(value));
  }
  async function refresh() {
    const revision = ++generation;
    setBusy(true);
    capture();
    try {
      checkActor();const result = await client.read();checkActor();
      if (!alive() || revision !== generation) return;
      if (!result || !Array.isArray(result.runs) || !Array.isArray(result.plans)) throw new Error('Shared Bonus records could not be verified.');
      data = result; error = '';if(pendingFormKey){resetForms.add(pendingFormKey);pendingFormKey=null;notice='Shared records refreshed and the saved step verified.';}pendingReadback=false;return true;
    } catch (failure) { if (revision === generation) { error = failure.message; } return false; }
    finally { if (alive() && revision === generation) { busy = false; render(); } }
  }
  async function save(operation, success, form) {
    if (busy || pendingReadback) return;
    capture();setBusy(true); error = '';notice='';
    try {
      checkActor();await operation();checkActor();
      if (!alive()) return;
      pendingReadback=true;pendingFormKey=formKey(form);
      if(await refresh()){resetForms.add(formKey(form));notice=success;render();onChange();}else{notice='The write returned successfully, but shared readback is unavailable. Refresh shared records to verify it before another write.';render();}
    } catch (failure) {
      if (alive()) { try{checkActor();}catch(changed){failure=changed;}error = failure.message; busy = false; render(); }
    }
  }
  function setup() {
    const permissions = data.permissions || {}, communities = data.communities || [], employees = data.employees || [];
    return `<details><summary style="cursor:pointer;padding:10px 0">Plan and eligibility setup</summary>
      <p>Financial scorecards use a complete quarter of approved targets and closed actuals. Choose the approved plan terms explicitly. Salary, manual adjustments, and partial-quarter calculations require their own supported source rules.</p>
      ${permissions.editPlans ? `<form data-form="plan" class="bonus-engine-card">
        ${input('planVersion', 0, 'type="hidden"')}
        <h4>Save a shared plan version</h4>
        <div class="bonus-engine-grid two">
          ${field('Plan to revise', `<select name="planId"><option value="">New plan</option>${options(data.plans, row => row.id, row => row.name + ' · version ' + row.version)}</select>`)}
          ${field('Plan name', input('name', '', 'required maxlength="160"'))}
          ${field('Eligible role', select('roleId', data.roles || [], row => row.id, row => row.title))}
          ${field('Eligible communities', `<select name="communityIds" multiple required size="3">${options(communities,row=>row.id,row=>row.name)}</select>`)}
          ${field('Effective start', input('effectiveStart', '', 'type="date" required'))}
          ${field('Effective end', input('effectiveEnd', '', 'type="date"'))}
          ${field('Quarterly target bonus ($)', input('targetBonus', '', 'type="number" min="0" step="0.01" required'))}
          ${field('Maximum quarterly payout ($)', input('maximumPayout', '', 'type="number" min="0" step="0.01" required'))}
        </div>
        <p>Selected weights must total 100%. Each measure scores achievement against its approved financial target.</p>
        <div class="bonus-engine-grid two">${metrics.map(([key, label]) => `<div>${field(label, `<span><input type="checkbox" name="include_${key}" aria-label="Include ${esc(label)}"> Include</span>`)}${field(label + ' weight (%)', input('weight_' + key, '', 'type="number" min="0" max="100" step="0.01"'))}${field(label + ' attainment goal (%)', input('goal_' + key, 100, 'type="number" min="0.000001" step="any"'))}</div>`).join('')}</div>
        <div data-plan-terms></div><label><input type="checkbox" name="replaceCurve" checked> Apply the schedule below to every selected measure. Clear this when revising to retain each measure’s existing schedule.</label>
        <p>Review the payout schedule. Each payout percentage applies to the selected measure's weighted target bonus.</p>
        <div class="bonus-engine-table-wrap"><table class="bonus-engine-table"><thead><tr><th>Achievement at least (%)</th><th>Payout (%)</th></tr></thead><tbody>${[[105,100],[100,80],[95,50],[0,0]].map(([threshold,payout],index) => `<tr><td>${input('threshold_' + index, threshold, `aria-label="Tier ${index + 1} achievement" type="number" step="0.01" required`)}</td><td>${input('payout_' + index, payout, `aria-label="Tier ${index + 1} payout" type="number" min="0" max="100" step="0.01" required`)}</td></tr>`).join('')}</tbody></table></div>
        ${reason()}<label><input name="confirm" type="checkbox" required> I have reviewed these approved plan terms and their effective dates.</label><p>${button('Save shared plan')}</p>
      </form>` : ''}
      ${permissions.editEligibility ? `<form data-form="eligibility" class="bonus-engine-card"><h4>Record employee eligibility</h4><div class="bonus-engine-grid two">
        ${field('Employee assignment', select('assignmentId', employees.filter(row => row.eligibilityEditable), row => row.assignmentId, row => row.name + ' · ' + (communities.find(c => c.id === row.communityId)?.name || 'Community')))}
        ${field('Bonus eligibility', '<select name="bonusEligible" required><option value="">Choose explicitly</option><option value="true">Eligible</option><option value="false">Not eligible</option></select>')}
        ${field('Effective date', input('bonusEffectiveDate', '', 'type="date" required'))}
      </div>${reason()}<p>${button('Save eligibility')}</p></form>` : ''}
      <p>${data.plans.length} shared plan versions · ${employees.filter(row => row.bonusEligible).length} eligible assignment records</p>
    </details>`;
  }
  function calculator() {
    if (!data.permissions?.calculate) return '';
    const employees = data.employees || [], communities = data.communities || [];
    return `<details><summary style="cursor:pointer;padding:10px 0">Create a calculation for review</summary><form data-form="draft"><div class="bonus-engine-grid two">
      ${field('Employee assignment', select('assignmentId', employees, row => row.assignmentId, row => row.name + ' · ' + (communities.find(c => c.id === row.communityId)?.name || 'Community') + (row.bonusEligible ? '' : ' · eligibility needed')))}
      ${field('Shared plan version', select('planId', data.plans, row => row.id, row => row.name + ' · version ' + row.version))}
      ${field('Quarter', input('periodKey', periodKey, 'required pattern="[0-9]{4}-Q[1-4]" placeholder="2026-Q3"'))}
    </div>${reason()}<p>${button('Calculate and save draft')}</p><p>ATLAS calculates from the shared source records. A different reviewer must approve the resulting draft.</p></form></details>`;
  }
  function runCard(run) {
    const employee = (data.employees || []).find(row => row.assignmentId === run.assignmentId), community = (data.communities || []).find(row => row.id === run.communityId);
    const permissions = data.permissions || {}, status = run.payment ? 'Payment confirmed' : run.status;
    const actions = [];
    if (['draft', 'review'].includes(run.status) && permissions.calculate) actions.push(['recalculate', 'Recalculate'], ['void', 'Void draft']);
    if (run.status === 'draft' && permissions.calculate) actions.unshift(['submit', 'Submit for review']);
    if (run.status === 'review' && permissions.approve) actions.unshift(['approve', 'Approve calculation']);
    if (run.status === 'approved' && permissions.lock) actions.push(['lock', 'Lock for payroll']);
    if (run.status === 'locked' && !run.payment && permissions.recordPayment) actions.push(['record_external_payment', 'Record payroll confirmation']);
    const calculation = run.calculation?.retainedRow || run.calculation || {};
    return `<article class="bonus-engine-card"><div class="bonus-engine-section-head"><div><h4>${esc(employee?.name || calculation.employee?.name || 'Retained employee calculation')}</h4><p>${esc(community?.name || '')} · ${esc(run.period?.periodKey || run.period?.period_key || run.period || '')} · Revision ${esc(run.revision)}</p></div><strong>${money(run.totalPayout)}</strong><span class="bonus-engine-pill info">${esc(status)}</span></div>
      ${run.stale?`<p role="alert">This calculation is stale: ${esc(run.reason||'Shared source records changed. Recalculate before approval or lock.')}</p>`:''}
      ${Array.isArray(calculation.metricResults) ? `<div class="bonus-engine-table-wrap"><table class="bonus-engine-table"><thead><tr><th>Measure</th><th>Actual</th><th>Achievement</th><th>Earned</th></tr></thead><tbody>${calculation.metricResults.map(row => `<tr><td>${esc(row.metric?.name || row.metric?.metricKey)}</td><td>${money(row.rawActual ?? row.actual)}</td><td>${(row.achievementPct ?? row.ratio) == null ? 'Pending' : esc(Number(row.achievementPct ?? row.ratio).toFixed(2)) + '%'}</td><td>${money(row.earned)}</td></tr>`).join('')}</tbody></table></div>` : ''}
      ${run.payment ? `<p>Payroll reference: ${esc(run.payment.externalReference || run.payment.external_reference)} · ${esc(run.payment.paidDate || run.payment.paid_date)} · ${money(run.payment.amount)}</p>` : ''}
      ${actions.length ? `<form data-form="transition" data-run="${esc(run.runId)}"><div class="bonus-engine-grid two">${field('Next step', `<select name="action">${options(actions, row => row[0], row => row[1])}</select>`)}${reason()}</div>
        ${actions.some(([action]) => action === 'record_external_payment') ? `<div class="bonus-engine-grid two">${field('External payroll reference', input('externalReference', '', 'required maxlength="160"'))}${field('Payment date', input('paidDate', '', 'type="date" required'))}${field('Confirmed paid amount ($)', input('amount', '', 'type="number" min="0" step="0.01" required'))}</div><label><input type="checkbox" name="confirmedPayment" required> Payroll has already processed this payment outside ATLAS.</label>` : '<label><input type="checkbox" name="confirmReview" required> I reviewed this calculation and the selected action.</label>'}
        <p>${button('Save workflow step')}</p></form>` : ''}
      <details><summary>Recorded history</summary>${(run.events || []).map(event => `<p>${esc(event.action || event.eventType || event.event_type)} · ${esc(event.createdAt || event.created_at || event.at)} · ${esc(event.reason || event.detail?.reason || '')}</p>`).join('') || '<p>No workflow events available.</p>'}</details></article>`;
  }
  function render() {
    if (!alive()) return;
    host.setAttribute('aria-busy',String(busy));capture();const openDetails=[...host.querySelectorAll('details[open]')].map(el=>el.querySelector('summary')?.textContent);
    host.innerHTML = `<div class="bonus-engine-card"><div class="bonus-engine-section-head"><div><h3>Shared approvals and payroll confirmations</h3><p>Saved plans, calculated amounts, reviewer decisions, and payment references share one history.</p></div><button data-refresh type="button" class="btn btn-gray btn-sm">Refresh shared records</button></div>
      ${error ? `<p role="alert" class="bonus-engine-warning">${esc(error)}</p>` : ''}${notice ? `<p role="status">${esc(notice)}</p>` : ''}
      ${data ? `${setup()}${calculator()}<h4>Saved calculations</h4>${data.runs.length ? data.runs.map(runCard).join('') : '<p>No shared calculations have been saved in your authorized communities.</p>'}` : '<p>Shared approval controls remain unavailable until the records load.</p>'}
      <p class="bonus-engine-secure-note">Payment confirmation records payroll processed elsewhere. It does not transfer funds.</p></div>`;
    for(const form of host.querySelectorAll('form'))for(const saved of drafts.get(formKey(form))||[]){const el=form.elements.namedItem(saved.name);if(!el)continue;if(el.multiple){for(const option of el.options)option.selected=saved.selected?.includes(option.value);}else if(el.type==='checkbox')el.checked=saved.checked;else el.value=saved.value;}
    resetForms.clear();for(const detail of host.querySelectorAll('details'))if(openDetails.includes(detail.querySelector('summary')?.textContent))detail.open=true;
    const planForm=host.querySelector('[data-form=plan]');
    function showPlanTerms(plan){const target=planForm?.querySelector('[data-plan-terms]');if(target)target.innerHTML=plan?`<details><summary>Retained schedules and metric identifiers</summary>${plan.metrics.map(metric=>`<p>${esc(metric.name)} (${esc(metric.id)}), goal ${esc(metric.goal)}%: ${metric.thresholdCurve.map(tier=>esc(tier.thresholdPct)+'% attainment → '+esc(tier.payoutPct)+'% payout').join('; ')}</p>`).join('')}</details>`:'';}
    showPlanTerms(data?.plans?.find(row=>row.id===planForm?.elements.planId.value));
    planForm?.elements.planId.addEventListener('change',()=>{const plan=data.plans.find(row=>row.id===planForm.elements.planId.value);planForm.reset();planForm.elements.planId.value=plan?.id||'';planForm.elements.planVersion.value=plan?.version??0;if(plan){for(const key of ['name','roleId','effectiveStart','effectiveEnd','targetBonus','maximumPayout'])planForm.elements[key].value=plan[key]??'';for(const option of planForm.elements.communityIds.options)option.selected=plan.eligibilityRules?.communityIds?.includes(option.value);for(const [key] of metrics){const metric=plan.metrics.find(row=>row.metricKey===key);planForm.elements['include_'+key].checked=Boolean(metric);planForm.elements['weight_'+key].value=metric?.weight??'';planForm.elements['goal_'+key].value=metric?.goal??100;}const curve=plan.metrics[0]?.thresholdCurve;for(let index=0;index<4;index++)if(curve?.[index]){planForm.elements['threshold_'+index].value=curve[index].thresholdPct;planForm.elements['payout_'+index].value=curve[index].payoutPct;}planForm.elements.replaceCurve.checked=false;}showPlanTerms(plan);capture();});
    host.querySelector('[data-refresh]')?.addEventListener('click', refresh);
    host.querySelectorAll('form').forEach(form => form.addEventListener('submit', event => {
      event.preventDefault();
      if (busy || pendingReadback || !data || !form.reportValidity()) return;
      const values = new FormData(form), type = form.dataset.form;
      try {
        checkActor();if (type === 'plan') {
          const old = data.plans.find(row => row.id === values.get('planId'));
          if ((values.get('planId') && !old) || Number(values.get('planVersion')) !== (old?.version ?? 0)) throw new Error('This plan changed after you selected it. Your entered terms are preserved. Choose the plan again to review its current version before saving.');
          const payload = planPayload(values, values.getAll('communityIds'), old);
          save(() => client.savePlan(old?.id, old?.version ?? 0, payload), 'Shared plan saved and read back.', form);
        } else if (type === 'eligibility') {
          const employee = data.employees.find(row => row.assignmentId === values.get('assignmentId'));
          if (!employee?.eligibilityEditable) throw new Error('This employee’s eligibility requires an authorized People administrator.');
          save(() => client.saveEligibility(employee.employeeId, employee.employeeVersion, { bonusEligible: values.get('bonusEligible') === 'true', bonusEffectiveDate: values.get('bonusEffectiveDate'), reason: values.get('reason') }), 'Employee eligibility saved and read back.', form);
        } else if (type === 'draft') {
          save(() => client.transition(null, 'draft', 0, { assignmentId: values.get('assignmentId'), planId: values.get('planId'), periodKey: values.get('periodKey'), reason: values.get('reason') }), 'Calculation saved for review.', form);
        } else {
          const run = data.runs.find(row => row.runId === form.dataset.run);
          if (!run) throw new Error('Refresh the calculation before continuing.');
          const action = values.get('action'), payload = { reason: values.get('reason') };
          if (action === 'record_external_payment') Object.assign(payload, { externalReference: values.get('externalReference'), paidDate: values.get('paidDate'), amount: Number(values.get('amount')) });
          save(() => client.transition(run.runId, action, run.revision, payload), 'Workflow step saved and read back.', form);
        }
      } catch (failure) { error = failure.message; render(); }
    }));
    if (busy) setBusy(true);else if(pendingReadback)host.querySelectorAll('form button').forEach(control=>control.disabled=true);
  }
  host.innerHTML = '<div class="bonus-engine-card" role="status">Loading shared Bonus approvals…</div>';
  await refresh();
}
