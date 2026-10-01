import {BUDGET_OVERRIDE_REASONS,createBudgetDriverOverride} from './budget-leasing-drivers.mjs?v=8f59ae7406f56df7';
import {esc,money} from './reforecast-report.mjs?v=a3a48cdae1e4a863';

export function budgetDriverWarningDialog({check,actor,dialog,guard=()=>{},onReturn,onAdjust,onOverride}){
 if(!check?.warning)return null;
 const el=dialog('BUDGET DRIVER WARNING'),body=el.querySelector('[data-body]'),status=el.querySelector('[data-status]');
 body.innerHTML='<p role="alert">This adjustment does not reconcile with the current Leasing Schedule or underlying budget drivers.</p><dl>'+[['Current calculated amount',money(check.currentCalculatedAmount)],['Manual amount',money(check.manualAmount)],['Variance $',money(check.varianceAmount)],['Variance %',check.variancePercent===null?'Unavailable against zero':check.variancePercent.toFixed(2)+'%'],['Affected drivers',(check.affectedDrivers||[]).join(', ')],['Expected amount based on current assumptions',money(check.expectedAmount)]].map(([k,v])=>'<dt>'+esc(k)+'</dt><dd>'+esc(v)+'</dd>').join('')+'</dl><div class="rf-toolbar"><button data-return>Return to Calculated Amount</button><button data-adjust>Adjust Supporting Driver</button></div><label>Override reason<select data-reason><option value="">Choose reason</option>'+BUDGET_OVERRIDE_REASONS.map(r=>'<option>'+esc(r)+'</option>').join('')+'</select></label><label>Optional comment — required for Other<textarea data-comment></textarea></label><button data-override>Override Adjustment</button>';
 const act=async callback=>{try{guard();await callback();el.close();}catch(error){status.textContent=error.message;}};
 body.querySelector('[data-return]').onclick=()=>act(onReturn);
 body.querySelector('[data-adjust]').onclick=()=>act(onAdjust);
 body.querySelector('[data-override]').onclick=()=>act(()=>onOverride(createBudgetDriverOverride({reason:body.querySelector('[data-reason]').value,comment:body.querySelector('[data-comment]').value,userId:actor,calculatedAmount:check.currentCalculatedAmount,manualAmount:check.manualAmount,affectedDrivers:check.affectedDrivers})));
 return el;
}
