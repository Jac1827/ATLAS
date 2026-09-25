# Manual market survey download

The [market survey helper](market_survey_sync.py) runs the existing [Outlook downloader](outlook_dashboard_sync.py) with the ApartmentIQ mailbox rules. It downloads matching Excel workbooks locally. Review and upload those files through ATLAS separately. This helper does not create a schedule.

## Setup

1. Copy `tools/market_survey_sync.config.example.json` to `tools/market_survey_sync.config.json`.
2. Replace `your.name@example.com` with the mailbox to read. Keep this local config out of Git.
3. Set `MS365_TENANT_ID`, `MS365_CLIENT_ID`, and `MS365_CLIENT_SECRET` in your environment for your existing Microsoft Graph application with mail-read access. Do not put secrets in the config.
4. Keep `post_update_commands` empty so this workflow only downloads files.

## Run manually

From the repository, inspect matches first:

```sh
python3 tools/market_survey_sync.py --dry-run
```

The dry run reads the mailbox and lists matches; it does not save attachments. To download them:

```sh
python3 tools/market_survey_sync.py
```

The defaults inspect up to 100 recent messages from the last 3 days. Use `--lookback-days` and `--limit` to adjust the scan, or `--config` to provide another local config. Repository-relative download paths resolve to this repository even if the helper is invoked from another directory.

The example configuration selects Excel filenames such as `2026_09_20_12_08_RISE_Florence_Villa_Market.xlsx` and writes them to `outputs/market_surveys/current_cycle/`. It excludes PDF summaries and path separators in attachment names. Repeated downloads of the same filename replace that file; other existing files remain in the folder.

## Import into ATLAS

Review the downloaded filenames and dates. Select only the intended cycle's files, open ATLAS Data Import, and use **APTIQ MARKET SURVEY UPLOAD**. Confirm the upload completes successfully. A download alone does not update ATLAS or publish community data.
