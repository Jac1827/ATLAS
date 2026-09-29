// Reuse the governed saved JSON lifecycle with a retained STR Builder schedule.
// All writes stay inside the isolated PGlite fixture.
process.env.ATLAS_STR_SUPPORTING_FIXTURE='1';
require('./reforecast-str-saved-programme-db.test.cjs');
