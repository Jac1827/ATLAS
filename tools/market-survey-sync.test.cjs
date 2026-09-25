// Include the helper's isolated Python tests in the discovered release suite.
const { execFileSync } = require('node:child_process');
const path = require('node:path');
execFileSync('python3', [path.join(__dirname, 'market_survey_sync_test.py')], { stdio: 'inherit' });
