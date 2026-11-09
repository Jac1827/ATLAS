import * as PDFLib from 'pdf-lib';
import {investorPdf, investorHtml} from '../docs/portfolio-operations-dashboard/features/budget-v2/investor-package.mjs';
import {RISE_REPORT_LOGO} from '../docs/portfolio-operations-dashboard/features/rise-report-brand.mjs';

async function deliveryRequestText(request) {
  const reader = request.body?.getReader();
  if (!reader) return '';
  const decoder = new TextDecoder();
  let size = 0, text = '';
  try {
    while (true) {
      const {done, value} = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > 16384) { await reader.cancel(); throw Object.assign(Error('Delivery request exceeds the size limit.'), {status: 413}); }
      text += decoder.decode(value, {stream: true});
    }
    return text + decoder.decode();
  } finally { reader.releaseLock(); }
}

/* POST /api/atlas/budget-investor/email {draftId, recipients, requestId}
 * The package is rendered from the immutable summary captured by the authorized
 * database claim. Only the request receiving sendAuthorized may contact the provider. Browser-supplied HTML or PDFs are never accepted. */
export async function handleBudgetInvestorEmail(request, env, api) {
  let claimed, access, sendAuthorized = false;
  try {
    access = await api.requireAtlasAccessUser(request, env, new Set(['admin', 'executive', 'vp', 'vice_president']));
    if (!env.EMAIL?.send || !env.ATLAS_DLR_FROM_EMAIL) return api.apiResponse({ok: false, error: 'Report email service is not configured.'}, {status: 503});
    const text = await deliveryRequestText(request);
    const body = JSON.parse(text || '{}');
    const id = /^[0-9a-f-]{36}$/i;
    if (!id.test(body.draftId || '') || !id.test(body.requestId || '') || !Array.isArray(body.recipients) || body.recipients.length < 1 || body.recipients.length > 20) throw Error('Invalid budget or recipients.');
    const result = await api.callAtlasRpcAsUser(access.config, access.token, 'atlas_claim_budget_investor_delivery_v2', {p_draft_id: body.draftId, p_request_id: body.requestId, p_recipients: body.recipients});
    const receipt = Array.isArray(result) ? result[0] : result;
    claimed = receipt?.delivery;
    sendAuthorized = receipt?.sendAuthorized === true;
    if (claimed?.status === 'sent') return api.apiResponse({ok: true, deliveryId: claimed.delivery_id, status: 'sent', replay: true});
    if (!sendAuthorized || claimed?.status !== 'claimed') return api.apiResponse({ok: false, error: 'Delivery outcome needs verification. Automatic resend is blocked to prevent duplicate email.'}, {status: 409});
    const s = claimed.locked_summary;
    if (!s) throw Error('The claimed investor summary is unavailable.');
    const logo = Uint8Array.from(atob(RISE_REPORT_LOGO.split(',')[1]), c => c.charCodeAt(0));
    const pdf = await investorPdf(s, {PDFLib, logoPng: logo});
    const filename = `${s.community} FY${s.fiscalYear} Budget.pdf`.replace(/[^\w .-]/g, '');
    const sent = await env.EMAIL.send({from: env.ATLAS_DLR_FROM_EMAIL, to: claimed.recipients, subject: `${s.community} · FY${s.fiscalYear} Operating Budget`, html: investorHtml(s),
      attachments: [{filename, type: 'application/pdf', disposition: 'attachment', content: pdf}]});
    await api.supabaseRequest(access.config, '/rest/v1/rpc/atlas_finish_budget_investor_delivery', {method: 'POST', service: true, body: {p_delivery_id: claimed.delivery_id, p_status: 'sent', p_provider_message_id: sent?.messageId || null}});
    return api.apiResponse({ok: true, deliveryId: claimed.delivery_id, status: 'sent'});
  } catch (error) {
    if (sendAuthorized && claimed?.status === 'claimed' && access) { try { await api.supabaseRequest(access.config, '/rest/v1/rpc/atlas_finish_budget_investor_delivery', {method: 'POST', service: true, body: {p_delivery_id: claimed.delivery_id, p_status: 'unknown'}}); } catch {} }
    return api.apiResponse({ok: false, error: claimed ? 'Delivery outcome needs verification. Automatic resend is blocked to prevent duplicate email.' : String(error.message || error)}, {status: error.status || 400});
  }
}
