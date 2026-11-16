/* Shared Entrata contact-source contract. Input evidence is immutable. */
(function(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.AtlasLeadSources = api;
})(typeof window !== 'undefined' ? window : globalThis, function() {
  const version = 'atlas-lead-source-v1';
  const normalize = value => String(value ?? '').toLowerCase().replace(/[\s_\-/]+/g, ' ').trim();
  const definitions = [
    {field:'walk_in', canonical:'Walk_In', label:'Walk In', aliases:['walk_in','walk in','walk-in','walkin']},
    {field:'off_site_event', canonical:'Off_Site_Event', label:'Off Site Event', aliases:['off_site_event','off site event','off-site event']},
    {field:'phone_calls', canonical:'Phone_Calls', label:'Phone Calls', aliases:['phone_calls','phone calls','phone call','calls','call','telephone']},
    {field:'emails_online', canonical:'Emails_Online', label:'Emails / Online', aliases:['email','emails','e-mail','online','online contact','online inquiry','internet inquiry','web inquiry','website inquiry','contact form']},
    {field:'text_chat_other', canonical:'Text_Chat_Other', label:'Text / Chat / Other', aliases:['chat','live chat','text','SMS','messaging','other']}
  ];
  const fields = definitions.map(d => d.field);
  const aliases = new Map(definitions.flatMap(d => [...d.aliases,d.field,d.label].map(a => [normalize(a),d.field])));
  const excluded = /\b(?:total|new leads?|guest cards?|tours?|visits?|applications?|apps|approvals?|approved|leases?|leased|units?|inventory|rent|ner|financial|revenue|income|cost|budget|conversion|percent|rate|occupancy|unit type|floor ?plan|sqft)\b/;
  function qualified(context = {}) {
    return normalize(context.sourceSystem) === 'entrata' &&
      ((context.reportType === 'box_score' && /^lead activity\b/.test(normalize(context.section))) || context.contactSourceMix === true);
  }
  function classify(label, context = {}) {
    const alias = normalize(label);
    if (excluded.test(alias)) return {alias,field:null,status:'excluded'};
    if (!qualified(context)) return {alias,field:null,status:'review'};
    const field = aliases.get(alias);
    if (field) return {alias,field,status:'trusted'};
    if (context.contactSourceComponent === true && alias) return {alias,field:'text_chat_other',status:'qualified_residual'};
    return {alias,field:null,status:'review'};
  }
  function numeric(raw) {
    if (raw === null || raw === undefined || String(raw).trim() === '') return {value:null,status:'missing'};
    if (typeof raw !== 'number' && (typeof raw !== 'string' || !/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(raw.trim()))) return {value:null,status:'invalid'};
    const value = Number(String(raw).replace(/,/g,''));
    return Number.isFinite(value) && value >= 0 ? {value,status:'valid'} : {value:null,status:'invalid'};
  }
  function aggregate(components = [], context = {}, controls = []) {
    const issues = [], seen = new Map();
    const evidence = components.map(component => {
      const match = classify(component.label, {...context,...component.context});
      const requested = component.destination;
      const destination = match.field && requested !== undefined ? (fields.includes(requested) ? requested : null) : match.field;
      const row = {...component,normalizedAlias:match.alias,destination,status:match.status,...numeric(component.value),rawValue:component.value,selected:false,mappingVersion:component.mappingVersion || version};
      if (component.id) {
        if (seen.has(component.id)) {
          row.duplicate = true;
          if (JSON.stringify(seen.get(component.id).rawValue) !== JSON.stringify(row.rawValue)) issues.push({type:'duplicate_conflict',component:component.id});
        } else seen.set(component.id,row);
      }
      if (destination && row.status === 'invalid') issues.push({type:'invalid_value',component:component.id,label:component.label});
      if (!match.field && match.status === 'review') issues.push({type:'unqualified_source',component:component.id,label:component.label});
      return row;
    });
    const buckets = Object.fromEntries(fields.map(field => {
      const rows = evidence.filter(r => r.destination === field && !r.duplicate);
      const combined = rows.filter(r => normalize(r.label) === normalize(field));
      if (combined.length > 1) {
        issues.push({type:'duplicate_combined',field}); return [field,null];
      }
      // A canonical combined bucket covers the whole destination; select it once.
      const selected = combined.length ? combined : rows;
      selected.forEach(r => {r.selected = true;});
      if (combined.length && rows.length > 1) {
        const parts = rows.filter(r => r !== combined[0]);
        parts.forEach(r => {r.exclusionReason = 'Covered by combined source bucket';});
        if (parts.every(r=>r.status === 'valid') && combined[0].status === 'valid' && parts.reduce((n,r)=>n+r.value,0) !== combined[0].value) issues.push({type:'combined_component_difference',field});
      }
      return [field,selected.length && selected.every(r=>r.status === 'valid') ? selected.reduce((n,r)=>n+r.value,0) : null];
    }));
    const complete = fields.every(field => buckets[field] !== null);
    const total = complete ? Object.values(buckets).reduce((a,b)=>a+b,0) : null;
    const comparisons = controls.map(control => ({...control,...numeric(control.value),rawValue:control.value})).map(control => ({...control,variance:total !== null && control.status === 'valid' ? total-control.value : null}));
    const status = issues.length ? 'review' : !complete ? 'incomplete' : !controls.length ? 'control_unavailable' : comparisons.every(c=>c.variance === 0) ? 'reconciled' : comparisons.some(c=>c.status !== 'valid') ? 'review' : 'variance';
    return {version,buckets,total,controls:comparisons,status,issues,evidence};
  }
  const storedFields = ['walkIn','offSiteEvent','phoneCalls','emailsOnline','textChatOther'];
  const count = raw => numeric(raw).value;
  function sum(values) {
    const parsed = values.map(count);
    return parsed.length && parsed.every(v=>v !== null) ? parsed.reduce((a,b)=>a+b,0) : null;
  }
  function breakdown(entry = {}) {
    const mix = entry.leadSourceReconciliation;
    return Object.fromEntries(storedFields.map((key,i)=>[key,count(mix?.version === version ? mix.buckets[fields[i]] : entry[key])]));
  }
  function combine(entries) {
    return Object.fromEntries(storedFields.map(key=>[key,sum(entries.map(entry=>breakdown(entry)[key]))]));
  }
  return {version,normalize,definitions,fields,storedFields,classify,qualified,numeric,aggregate,count,sum,breakdown,combine};
});
