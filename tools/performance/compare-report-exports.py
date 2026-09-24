#!/usr/bin/env python3
"""Offline, non-executing comparison of ATLAS Weekly Leasing Report downloads.

Only hashes, dimensions and pass/fail flags are emitted. Inputs are local files;
there is no browser, network, spreadsheet formula execution, or credential access.
The app's Excel download is HTML .xls, not binary XLS/XLSX. Fail on other formats.
"""
import argparse
import csv
import hashlib
import io
import json
import re
import sys
from html.parser import HTMLParser
from pathlib import Path

HEADER = ["section", "property", "metric", "value", "note"]
GENERATED = re.compile(r"^Generated \d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z · ")


def compact(value):
    return re.sub(r"\s+", " ", value).strip()


def digest(value):
    body = json.dumps(value, ensure_ascii=False, separators=(",", ":"), sort_keys=True)
    return hashlib.sha256(body.encode("utf-8")).hexdigest()


class ReportHTML(HTMLParser):
    """Keep ordered table cells and complete body text, including closed details."""
    def __init__(self, body):
        super().__init__(convert_charrefs=True)
        self.tags = []
        self.body = []
        self.footer = []
        self.headings = []
        self.tables = []
        self.row = None
        self.cell = None
        self.feed(body)
        self.close()

    def handle_starttag(self, tag, attrs):
        self.tags.append(tag)
        if tag == "table":
            self.tables.append([])
        elif tag == "tr":
            self.row = []
        elif tag in ("td", "th"):
            self.cell = []

    def handle_endtag(self, tag):
        if tag in ("td", "th") and self.cell is not None:
            self.row.append(compact("".join(self.cell)))
            self.cell = None
        elif tag == "tr" and self.row is not None:
            self.tables[-1].append(self.row)
            self.row = None
        if tag in self.tags:
            del self.tags[len(self.tags) - 1 - self.tags[::-1].index(tag):]

    def handle_data(self, text):
        if any(tag in self.tags for tag in ("script", "style", "template")):
            return
        if "body" in self.tags:
            self.body.append(text)
        if "footer" in self.tags:
            self.footer.append(text)
        if "h1" in self.tags:
            self.headings.append(text)
        if self.cell is not None:
            self.cell.append(text)


def csv_rows(text):
    rows = list(csv.reader(io.StringIO(text.lstrip("\ufeff")), strict=True))
    if not rows or [compact(cell).lower() for cell in rows[0]] != HEADER:
        raise ValueError("unsupported_csv_header")
    if any(len(row) != len(HEADER) for row in rows):
        raise ValueError("incomplete_csv_row")
    return [[compact(cell) for cell in row] for row in rows[1:]]


def excel_rows(text):
    if not re.match(r"\s*(?:<!doctype html>|<html)", text, re.I):
        raise ValueError("expected_html_excel_export")
    parsed = ReportHTML(text)
    if compact("".join(parsed.headings)) != "Weekly Leasing Report" or len(parsed.tables) != 1:
        raise ValueError("unsupported_excel_report")
    rows = parsed.tables[0]
    if not rows or [compact(cell).lower() for cell in rows[0]] != HEADER:
        raise ValueError("unsupported_excel_header")
    if any(len(row) != len(HEADER) for row in rows):
        raise ValueError("incomplete_excel_row")
    return rows[1:]


def report_semantics(text):
    parsed = ReportHTML(text)
    if compact("".join(parsed.headings)) != "Weekly Leasing Report" or not parsed.tables:
        raise ValueError("unsupported_html_report")
    footer = "".join(parsed.footer)
    if not GENERATED.match(footer):
        raise ValueError("unsupported_report_footer")
    body = "".join(parsed.body).replace(footer, GENERATED.sub("Generated <export-time> · ", footer, count=1))
    return {"body": compact(body), "tables": parsed.tables}


def read_text(file):
    # Bound malformed inputs; actual reports are substantially smaller.
    if Path(file).stat().st_size > 32 * 1024 * 1024:
        raise ValueError("input_exceeds_32_mib")
    return Path(file).read_text(encoding="utf-8-sig")


def check_probe(probe):
    hashes = ["selectionHash", "reportTextHash", "cardsHash", "tablesHash", "sourceNotesHash", "runtimeHash"]
    if not isinstance(probe, dict) or probe.get("format") != 1 or probe.get("status") != "captured" or probe.get("reportType") != "rise_weekly_leasing":
        raise ValueError("invalid_dom_probe")
    if any(not re.fullmatch(r"[a-f0-9]{64}", probe.get(key, "")) for key in hashes):
        raise ValueError("invalid_probe_digest")
    source = probe.get("source", {})
    if not isinstance(source, dict) or source.get("documentKey") != "atlas_dashboard_state_v1" or not isinstance(source.get("version"), int) or not source.get("effectiveAt"):
        raise ValueError("invalid_probe_source")
    if not re.fullmatch(r"[a-f0-9]{64}", source.get("archiveHash", "")):
        raise ValueError("invalid_source_digest")
    return hashes


def compare(args):
    probes = [json.loads(read_text(file)) for file in (args.probe_a, args.probe_b)]
    keys = check_probe(probes[0])
    check_probe(probes[1])
    sources = [{key: probe["source"].get(key) for key in ["documentKey", "version", "archiveHash", "effectiveAt"]} for probe in probes]
    csvs = [csv_rows(read_text(file)) for file in (args.csv_a, args.csv_b)]
    excels = [excel_rows(read_text(file)) for file in (args.excel_a, args.excel_b)]
    html = [report_semantics(read_text(file)) for file in (args.html_a, args.html_b)]
    checks = {
        "sourceIdentityMatch": sources[0] == sources[1],
        "projectionBindingMatchIfPresent": probes[0].get("projectionBinding") == probes[1].get("projectionBinding"),
        "expectedArchiveMatch": all(source["archiveHash"] == args.archive_hash and source["version"] == args.version for source in sources),
        "freshSourceReceipts": all(probe["source"].get("verified") is True for probe in probes),
        "periodMatch": probes[0].get("period") == probes[1].get("period") and probes[0].get("through") == probes[1].get("through"),
        **{key + "Match": probes[0][key] == probes[1][key] for key in keys},
        "csvMatch": csvs[0] == csvs[1],
        "excelMatch": excels[0] == excels[1],
        "htmlReportMatch": html[0] == html[1],
        "csvExcelParityA": csvs[0] == excels[0],
        "csvExcelParityB": csvs[1] == excels[1],
        "downloadMatchesDisplayedA": digest(html[0]["body"]) == probes[0]["reportTextHash"] and digest(html[0]["tables"]) == probes[0]["tablesHash"],
        "downloadMatchesDisplayedB": digest(html[1]["body"]) == probes[1]["reportTextHash"] and digest(html[1]["tables"]) == probes[1]["tablesHash"],
    }
    local_changes = any(probe["source"].get("localChanges") is True for probe in probes)
    return {
        "format": 1, "status": "mismatch" if not all(checks.values()) else "matches_with_local_changes_review" if local_changes else "matches",
        "checks": checks, "localChangesReviewRequired": local_changes,
        "projectionBindingCompared": all(probe.get("projectionBinding") is not None for probe in probes),
        "sessions": [{
            "reportSemanticHash": digest(html[index]), "reportTextHash": digest(html[index]["body"]),
            "csvRowsHash": digest(csvs[index]), "excelRowsHash": digest(excels[index]),
            "rows": len(csvs[index]), "tables": len(html[index]["tables"]),
            "sourceIdentityHash": digest(sources[index])
        } for index in range(2)],
        "normalization": "HTML entities and displayed whitespace; exact generated-at footer timestamp only. Ordered values, zero, missing labels, source dates/references and closed details retained.",
        "limitation": "A matching pair establishes observed cross-session parity, not every financial formula or production write workflow. If projection binding is absent from DOM, retain the independent projection publication/readback receipt."
    }


def self_test():
    # Synthetic only. No user paths, browser, application scripts or network.
    cells = ['Example', '0', 'Not available', '"quoted", & <x>', '=1+2']
    csv_text = 'section,property,metric,value,note\r\n' + ','.join('"' + x.replace('"', '""') + '"' for x in cells) + '\r\n'
    from html import escape
    table = '<table><tr>' + ''.join('<th>' + cell.title() + '</th>' for cell in HEADER) + '</tr><tr>' + ''.join('<td>' + escape(cell) + '</td>' for cell in cells) + '</tr></table>'
    excel = '<!doctype html><html><head><style>ignored</style></head><body><h1>Weekly Leasing Report</h1>' + table + '</body></html>'
    a = '<!doctype html><html><body><h1>Weekly Leasing Report</h1>' + table + '<details><summary>Details</summary><p>retained evidence</p></details><footer>Generated 2026-09-24T01:02:03.456Z · Source 2026-09-19</footer></body></html>'
    b = a.replace('01:02:03.456Z', '04:05:06.789Z')
    assert csv_rows(csv_text) == excel_rows(excel) == [cells]
    assert report_semantics(a) == report_semantics(b)
    for old, new in [('>0<', '>Not available<'), ('Source 2026-09-19', 'Source 2026-09-20'), ('retained evidence', 'changed evidence'), ('=1+2', '=2+2')]:
        assert digest(report_semantics(a)) != digest(report_semantics(a.replace(old, new)))
    assert csv_rows(csv_text) != csv_rows(csv_text.replace('"0"', '""'))
    assert csv_rows(csv_text) != csv_rows(csv_text.replace('"0"', '"-1"'))
    try:
        excel_rows('PK binary workbook')
    except ValueError:
        pass
    else:
        raise AssertionError('binary_workbook_must_fail')
    from tempfile import TemporaryDirectory
    from types import SimpleNamespace
    with TemporaryDirectory(prefix="atlas-report-semantic-selftest-") as directory:
        fixture = Path(directory)
        semantic = report_semantics(a)
        probe = {"format": 1, "status": "captured", "reportType": "rise_weekly_leasing", "projectionBinding": None,
                 "source": {"documentKey": "atlas_dashboard_state_v1", "version": 1, "archiveHash": "a" * 64, "effectiveAt": "2026-09-19T00:00:00Z", "verified": True, "localChanges": False},
                 "selectionHash": "b" * 64, "reportTextHash": digest(semantic["body"]), "cardsHash": "c" * 64,
                 "tablesHash": digest(semantic["tables"]), "sourceNotesHash": "d" * 64, "runtimeHash": "e" * 64,
                 "period": "2026-09", "through": "2026-09-19"}
        args = SimpleNamespace(archive_hash="a" * 64, version=1)
        for suffix, html in [("a", a), ("b", b)]:
            for kind, text in [("html", html), ("excel", excel), ("csv", csv_text), ("probe", json.dumps(probe))]:
                file = fixture / (kind + suffix)
                file.write_text(text, encoding="utf-8")
                setattr(args, kind + "_" + suffix, str(file))
        result = compare(args)
        assert result["status"] == "matches" and all(result["checks"].values())
        assert not result["projectionBindingCompared"]
        Path(args.csv_b).write_text(csv_text.replace('"0"', '"1"'), encoding="utf-8")
        assert compare(args)["status"] == "mismatch"
        Path(args.csv_b).write_text(csv_text, encoding="utf-8")
        probe["source"]["localChanges"] = True
        Path(args.probe_b).write_text(json.dumps(probe), encoding="utf-8")
        assert compare(args)["status"] == "matches_with_local_changes_review"
        probe["source"]["archiveHash"] = "f" * 64
        Path(args.probe_b).write_text(json.dumps(probe), encoding="utf-8")
        assert compare(args)["status"] == "mismatch"
    print(json.dumps({"status": "passed", "checks": ["csv_excel_entities", "zero_missing_negative_distinct", "formula_text_not_executed", "generated_timestamp_only", "source_date_change_detected", "closed_detail_change_detected", "binary_format_rejected", "paired_probe_download_parity", "changed_archive_rejected", "local_changes_require_review"]}))


def main():
    if sys.argv[1:] == ["--self-test"]:
        self_test()
        return 0
    parser = argparse.ArgumentParser(description=__doc__)
    for name in ("probe-a", "probe-b", "csv-a", "csv-b", "excel-a", "excel-b", "html-a", "html-b", "archive-hash"):
        parser.add_argument("--" + name, required=True)
    parser.add_argument("--version", type=int, required=True)
    args = parser.parse_args()
    if not re.fullmatch(r"[a-f0-9]{64}", args.archive_hash) or args.version < 1:
        parser.error("expected archive hash/version are invalid")
    try:
        result = compare(args)
        print(json.dumps(result, indent=2, sort_keys=True))
        return 0 if result["status"] == "matches" else 1
    except (ValueError, OSError, csv.Error, KeyError, TypeError, IndexError):
        # Exception text can contain a path, source row or private JSON. Omit it.
        print(json.dumps({"format": 1, "status": "input_validation_failed"}))
        return 2


if __name__ == "__main__":
    raise SystemExit(main())
