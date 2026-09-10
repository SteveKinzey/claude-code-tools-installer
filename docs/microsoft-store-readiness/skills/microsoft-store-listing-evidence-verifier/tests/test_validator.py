#!/usr/bin/env python3
from __future__ import annotations

import json
import subprocess
import sys
import tempfile
import zipfile
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
VALIDATOR = ROOT / "scripts" / "validate_listing_evidence.py"
TEMPLATE = ROOT / "templates" / "capture-manifest.template.json"


def make_appx(path: Path, architecture: str) -> None:
    manifest = f'''<?xml version="1.0" encoding="utf-8"?>
<Package xmlns="http://schemas.microsoft.com/appx/manifest/foundation/windows10">
  <Identity Name="ExampleIdentity" Publisher="CN=Example Publisher" Version="1.0.0.0" ProcessorArchitecture="{architecture}" />
  <Properties><DisplayName>Example</DisplayName><PublisherDisplayName>Example Publisher</PublisherDisplayName></Properties>
  <Applications><Application Id="Example" Executable="Example.exe" EntryPoint="Windows.FullTrustApplication" /></Applications>
  <Capabilities><Capability Name="runFullTrust" /></Capabilities>
</Package>'''
    with zipfile.ZipFile(path, "w", zipfile.ZIP_DEFLATED) as package:
        package.writestr("AppxManifest.xml", manifest)


def main() -> None:
    with tempfile.TemporaryDirectory() as directory:
        root = Path(directory)
        x64 = root / "example_x64.appx"
        arm64 = root / "example_arm64.appx"
        make_appx(x64, "x64")
        make_appx(arm64, "arm64")
        bundle = root / "example.msixbundle"
        with zipfile.ZipFile(bundle, "w", zipfile.ZIP_DEFLATED) as archive:
            archive.write(x64, x64.name)
            archive.write(arm64, arm64.name)
        checksum = root / "example.msixbundle.sha256"
        import hashlib
        digest = hashlib.sha256(bundle.read_bytes()).hexdigest()
        checksum.write_text(f"{digest}  {bundle.name}\n", encoding="utf-8")
        report = root / "report.json"
        completed = subprocess.run(
            [
                sys.executable, str(VALIDATOR), "--manifest", str(TEMPLATE), "--bundle", str(bundle),
                "--checksum-file", str(checksum), "--allow-template", "--report", str(report),
            ],
            check=False,
            text=True,
            capture_output=True,
        )
        assert completed.returncode == 0, completed.stderr
        result = json.loads(report.read_text(encoding="utf-8"))
        assert result["result"] == "pass", result
        assert result["checksum_verification"]["status"] == "verified", result
        assert result["checksum_verification"]["sha256_match"] is True, result
        assert result["checksum_verification"]["filename_match"] is True, result
        assert result["bundle"]["package_count"] == 2, result
        assert {item["architecture"] for item in result["packages"]} == {"x64", "arm64"}, result

        # Test failure on missing temporary_certificate_removed
        import copy
        bad_manifest = copy.deepcopy(json.loads(TEMPLATE.read_text(encoding="utf-8")))
        bad_manifest["capture_mode"] = "submission"
        bad_manifest["submission_status"] = "final_tested_windows_msix"
        bad_manifest["source_commit"] = "f62ef8b55e9aaabadb336f8677c588c0fbc5b2e4"
        bad_manifest["package_sha256"] = digest
        bad_manifest["architecture"] = "x64,arm64"
        bad_manifest["windows_version"] = "10.0.22631"
        bad_manifest["native_resolution"] = "1920x1080"
        bad_manifest["captured_at_utc"] = "2026-09-09T23:30:00Z"
        bad_manifest["candidate_evidence"]["msix_bundle_file"] = bundle.name
        bad_manifest["candidate_evidence"]["package_identity_name"] = "ExampleIdentity"
        bad_manifest["candidate_evidence"]["package_full_name"] = "ExampleIdentity_1.0.0.0_neutral__b45526a7a486862f"
        bad_manifest["candidate_evidence"]["package_manifests"] = [
            {"sha256": item["manifest_sha256"]} for item in result["packages"]
        ]
        bad_manifest["candidate_evidence"]["clean_windows_test"]["test_record_id"] = "sim-win-test-20260909-01"
        bad_manifest["candidate_evidence"]["clean_windows_test"]["tested_at_utc"] = "2026-09-09T23:30:00Z"
        bad_manifest["candidate_evidence"]["clean_windows_test"]["install_passed"] = True
        bad_manifest["candidate_evidence"]["clean_windows_test"]["launch_passed"] = True
        bad_manifest["candidate_evidence"]["clean_windows_test"]["real_workflow_adapters_passed"] = True
        bad_manifest["candidate_evidence"]["clean_windows_test"]["clean_uninstall_passed"] = True
        # Omit the field entirely to prove a missing cleanup attestation fails.
        bad_manifest["candidate_evidence"]["clean_windows_test"].pop("temporary_certificate_removed", None)
        bad_manifest_path = root / "bad_manifest.json"
        bad_manifest_path.write_text(json.dumps(bad_manifest), encoding="utf-8")

        completed_bad = subprocess.run(
            [
                sys.executable, str(VALIDATOR), "--manifest", str(bad_manifest_path), "--bundle", str(bundle),
                "--checksum-file", str(checksum), "--screenshots-dir", str(root), "--report", str(report),
            ],
            check=False,
            text=True,
            capture_output=True,
        )
        assert completed_bad.returncode == 2, completed_bad.stderr
        assert "clean_windows_test.temporary_certificate_removed must be true" in completed_bad.stderr, completed_bad.stderr

    print("PASS validator smoke test")


if __name__ == "__main__":
    main()
