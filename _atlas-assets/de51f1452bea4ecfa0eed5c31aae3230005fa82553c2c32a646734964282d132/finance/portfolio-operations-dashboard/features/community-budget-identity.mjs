// Community Settings and approved aliases are the only identity/calendar authority.
const normal=value=>String(value??'').normalize('NFKC').trim().toLowerCase().replace(/\s+/g,' ');
const classification=value=>({'student housing':'Student Housing','multifamily':'Multifamily'})[normal(value)]||null;
export function readBudgetCalendar(community){
 const saved=community?.budget_calendar;
 const unverified=community?.review_status==='review_required'&&/market|property_type|classification|financial/i.test(JSON.stringify(community.review_flags||[]));
 const candidates=[classification(community?.market),classification(community?.property_type)].filter(Boolean);
 const kind=saved?.verified===true&&saved.source?classification(saved.classification):!unverified&&new Set(candidates).size===1?candidates[0]:null;
 const startMonth=kind==='Student Housing'?8:kind==='Multifamily'?1:null;
 if(!kind||saved?.verified===true&&Number(saved.startMonth)!==startMonth)return {verified:false,reason:'Verify the community financial classification in Community Settings before import.',startMonth:null,basis:null};
 return {verified:true,classification:kind,startMonth,basis:startMonth===1?'calendar':'fiscal',settingsVersion:saved?.version||community.version||null,source:saved?.source||'Community Settings',schoolYear:kind==='Student Housing',summerTurnMonths:kind==='Student Housing'?[6,7,8]:[]};
}
export function budgetYearPeriods(year,calendar){
 if(!calendar?.verified||!Number.isInteger(year)||year<2000||year>2099)throw Error('A verified calendar and budget starting year are required.');
 return Array.from({length:12},(_,i)=>new Date(Date.UTC(year,calendar.startMonth-1+i,1)).toISOString().slice(0,7));
}
export function fiscalYtdPeriods(period,calendar){
 if(!/^20\d{2}-(0[1-9]|1[0-2])$/.test(period||'')||!calendar?.verified)throw Error('A verified calendar and accounting month are required.');
 const year=Number(period.slice(0,4))-(Number(period.slice(5))<calendar.startMonth?1:0);
 return budgetYearPeriods(year,calendar).filter(month=>month<=period);
}
export function resolveImportCommunity({fileName='',embeddedNames=[],selectedCommunityId=null,confirmed=false,reason=''},communities,aliases=[]){
 const names=communities.flatMap(c=>[c.display_name,c.canonical_name,...aliases.filter(a=>a.active&&a.community_id===c.community_id).map(a=>a.alias)].filter(Boolean).map(name=>({name:normal(name),id:c.community_id})));
 const exact=value=>{const text=normal(value),entity=text.match(/^\d+\s*\(([^()]+)\)$/),label=entity?entity[1]:text;return [...new Set(names.filter(row=>row.name===label).map(row=>row.id))];};
 // Match complete approved names within filenames. A filename is corroboration,
 // never a reason to create a property or infer its financial model.
 const file=' '+normal(fileName).replace(/[^\p{L}\p{N}]+/gu,' ')+' ';
 const fileIds=[...new Set(names.filter(row=>file.includes(' '+row.name.replace(/[^\p{L}\p{N}]+/gu,' ')+' ')).map(row=>row.id))];
 const embedded=embeddedNames.filter(value=>normal(value)).map(value=>({name:value,matches:exact(value)}));
 const ids=[...new Set([...fileIds,...embedded.flatMap(row=>row.matches)])];
 const ambiguous=ids.length!==1||embedded.some(row=>row.matches.length!==1)||selectedCommunityId&&ids[0]!==selectedCommunityId;
 if(confirmed&&communities.some(c=>c.community_id===selectedCommunityId)&&(!ambiguous||reason.trim().length>=3))return {communityId:selectedCommunityId,status:'resolved',reviewed:true,evidence:{fileName,embeddedNames,reason,matchedCommunityIds:ids}};
 if(ambiguous)return {communityId:null,status:'mapping_required',reason:'Select the canonical community and resolve conflicting or unknown source names.',matchedCommunityIds:ids};
 return {communityId:ids[0],status:'resolved',reviewed:false,evidence:{fileName,embeddedNames,matchedCommunityIds:ids}};
}
