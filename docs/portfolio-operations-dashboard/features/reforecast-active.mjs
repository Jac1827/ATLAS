import {retainForecast} from './financial-snapshot.mjs?v=848d058bdec07b4e';
// Active targets are immutable verified publications. Historical reads preserve the
// retained vintage but never establish current active coverage.
export function effectiveActiveSnapshot(publication){
 if(!publication?.snapshot)throw Error('An active publication snapshot is required.');
 if(publication.isPublicationHistory===true){if(publication.activePeriods?.length)throw Error('A historical vintage cannot designate active periods.');return retainForecast(publication.snapshot);}
 if(publication.verified!==true||publication.approved!==true||publication.locked!==true||!publication.contentHash||!publication.publicationId)throw Error('Active baseline unavailable: verified approval and lock evidence are required.');
 return retainForecast(publication.snapshot);
}
