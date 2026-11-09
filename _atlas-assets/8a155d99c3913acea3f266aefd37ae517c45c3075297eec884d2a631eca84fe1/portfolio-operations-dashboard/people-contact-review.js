(function() {
  'use strict';
  const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const supervisorLabel = value => value ? `${esc(value.name)}${value.kind === 'employee-reference' ? ` · ${esc(value.title)} · ${esc(value.email)}` : ' (as recorded)'}` : 'None reviewed';
  const allowed = () => atlasWorkspaceAccess.validated && getAtlasCentralStatus().signedIn && isCommunitySettingsAdmin();
  window.atlasPeopleContactReviewPanel = () => {
    if (!allowed()) return '';
    const contact = window.AtlasPeopleContacts.contact(savedData[getProp().name], getProp().name), supervisor = contact?.supervisor;
    return `<div style="margin-top:12px"><button class="btn btn-gray btn-sm" type="button" onclick="atlasReviewPeopleContacts()">Review People contacts</button>
      ${contact ? `<p>GM contact source: People snapshot from ${esc(contact.sourceDate.slice(0,10))}.</p>` : ''}
      ${supervisor ? `<p><strong>${supervisor.kind === 'employee-reference' ? 'Supervisor' : 'Supervisor (as recorded)'}</strong>: ${esc(supervisor.name)}${supervisor.kind === 'employee-reference' ? ` · ${esc(supervisor.title)} · ${esc(supervisor.email)}` : ''}</p>` : ''}</div>`;
  };
  window.atlasReviewPeopleContacts = () => {
    if (!allowed()) return;
    const context = captureAtlasAuxiliaryContext(), input = document.createElement('input');
    input.type = 'file'; input.accept = '.json,application/json';
    input.onchange = async () => {
      const file = input.files?.[0]; if (!file) return;
      const current = () => context.current() && allowed();
      try {
        if (!current()) throw Error('Access changed. Open the contact review again.');
        if (file.size > 64 * 1024 * 1024) throw Error('Choose the read-only Central Snapshot export, not the full rollback archive.');
        const snapshot = JSON.parse(await file.text());
        const communities = getAtlasDashboardAuthorizedCommunityOptions().map(row => row.name).filter(name => savedData[name] && savedData[name].communityStatus !== 'inactive');
        const review = await window.AtlasPeopleContacts.review(snapshot, {communities, records: savedData, aliases: SHARED_COMMUNITY_ALIASES,
          digest: async value => [...new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(value)))].map(byte => byte.toString(16).padStart(2,'0')).join('')});
        if (!current()) throw Error('Access changed. Open the contact review again.');
        const dialog = document.createElement('dialog'); dialog.style.cssText = 'max-width:900px;width:90%;max-height:85vh;overflow:auto;padding:24px';
        const counts = type => review.rows.filter(row => row.disposition === type).length;
        dialog.innerHTML = `<h2>Review People contacts</h2><p>Source: ${esc(file.name)} · ${esc(review.sourceDate)} · ${review.employeeCount} People records.</p>
          <p>${counts('correct contact')} corrected contacts · ${counts('confirm identity')} identities to confirm · ${counts('update supervisor')} supervisor updates · ${counts('unchanged')} unchanged.</p>
          <p>Choose the GM contacts to use. Current choices remain until applied. Supervisor labels preserve the People relationship and actual title.</p>
          <table><thead><tr><th>Apply</th><th>Community</th><th>Current</th><th>From People</th><th>Change</th></tr></thead><tbody>${review.rows.map((row,i) => `<tr><td><input type="checkbox" data-contact-row="${i}" ${row.disposition !== 'unchanged' ? 'checked' : ''} aria-label="Apply ${esc(row.community)} contact"></td><td>${esc(row.community)}</td><td>${esc(row.currentName)}<br>${esc(row.currentEmail)}<br><small>Supervisor: ${supervisorLabel(row.currentSupervisor)}</small></td><td>${esc(row.candidate.name)}<br>${esc(row.candidate.email)}<br><small>Supervisor: ${supervisorLabel(row.candidate.supervisor)}</small></td><td>${esc(row.disposition)}</td></tr>`).join('')}</tbody></table>
          ${review.issues.length ? `<details><summary>${review.issues.length} source items held for review</summary><ul>${review.issues.map(issue => `<li>${esc(issue.community)}: ${esc(issue.reason)}</li>`).join('')}</ul></details>` : ''}
          <p role="status" data-contact-status></p><button type="button" data-contact-apply>Apply selected contacts</button> <button type="button" data-contact-close>Close</button>`;
        let applied = false;
        dialog.onclose = () => {dialog.remove(); if (applied && current()) renderTab();};
        dialog.querySelector('[data-contact-close]').onclick = () => dialog.close();
        dialog.querySelector('[data-contact-apply]').onclick = async event => {
          const button = event.currentTarget, status = dialog.querySelector('[data-contact-status]'); button.disabled = true;
          try {
            if (!current()) throw Error('Access changed. Open the contact review again.');
            const rows = [...dialog.querySelectorAll('[data-contact-row]:checked')].map(node => review.rows[Number(node.dataset.contactRow)]);
            const count = await persistReviewedPeopleContacts(rows); applied = true;
            status.textContent = `${count} contacts saved in this workspace. Use the central save when the workspace is ready to publish.`;
            for (const node of dialog.querySelectorAll('[data-contact-row]')) node.disabled = true;
          } catch (error) {status.textContent = error.message; button.disabled = false;}
        };
        document.body.appendChild(dialog); dialog.showModal();
      } catch (error) {alert(`People contact review: ${error.message}`);}
    };
    input.click();
  };
})();
