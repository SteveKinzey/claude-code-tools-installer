#!/usr/bin/env python3
"""Validate Microsoft Store screenshot evidence against an MSIX/AppX candidate.

This validator never prints Partner Center identity or publisher values. It is safe to
run locally or in CI with a final capture manifest, an unsigned MSIX/MSIXBundle, and
optionally the final screenshot directory.
"""
from __future__ import annotations

import argparse
import hashlib
import io
import json
import sys
import zipfile
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from xml.etree import ElementTree as ET

PNG_SIGNATURE = b"\x89PNG\r\n\x1a\n"
MAX_FILE_SIZE = 50 * 1024 * 1024
REQUIRED_STATES = ["readiness/setup", "curated catalog", "project library", "plan/review flow"]
REQUIRED_SCREENSHOT_FIELDS = {
    "file", "state", "caption", "capture_origin", "captured_at_utc",
    "native_window_title", "sha256", "pixel_dimensions", "file_size_bytes", "status",
}


def sha256_bytes(payload: bytes) -> str:
    return hashlib.sha256(payload).hexdigest()


def sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as source:
        for block in iter(lambda: source.read(1024 * 1024), b""):
            digest.update(block)
    return digest.hexdigest()


def is_nonempty(value: Any) -> bool:
    return isinstance(value, str) and bool(value.strip())


def parse_utc(value: str) -> bool:
    try:
        datetime.fromisoformat(value.replace("Z", "+00:00"))
        return True
    except (AttributeError, ValueError):
        return False


def identity_fingerprint(name: str, publisher: str) -> str:
    return hashlib.sha256(f"{name}\n{publisher}".encode("utf-8")).hexdigest()[:16]


def read_manifest(path: Path) -> dict[str, Any]:
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError) as error:
        raise ValueError(f"manifest cannot be read as JSON: {error}") from error
    if not isinstance(payload, dict):
        raise ValueError("manifest root must be a JSON object")
    return payload


def png_dimensions(path: Path) -> tuple[int, int]:
    with path.open("rb") as source:
        header = source.read(24)
    if len(header) != 24 or not header.startswith(PNG_SIGNATURE):
        raise ValueError("not a PNG file")
    return int.from_bytes(header[16:20], "big"), int.from_bytes(header[20:24], "big")


def xml_local_name(tag: str) -> str:
    return tag.rsplit("}", 1)[-1]


def parse_appx_manifest(payload: bytes, package_name: str) -> dict[str, Any]:
    try:
        root = ET.fromstring(payload)
    except ET.ParseError as error:
        raise ValueError(f"{package_name}: invalid AppxManifest.xml: {error}") from error
    identity = next((node for node in root.iter() if xml_local_name(node.tag) == "Identity"), None)
    if identity is None:
        raise ValueError(f"{package_name}: AppxManifest.xml has no Identity node")
    properties = next((node for node in root.iter() if xml_local_name(node.tag) == "Properties"), None)
    publisher_display = ""
    if properties is not None:
        publisher_node = next((node for node in properties if xml_local_name(node.tag) == "PublisherDisplayName"), None)
        publisher_display = (publisher_node.text or "").strip() if publisher_node is not None else ""
    capabilities = sorted({node.attrib.get("Name", "") for node in root.iter() if xml_local_name(node.tag) == "Capability" and node.attrib.get("Name")})
    return {
        "package_file": package_name,
        "identity_name": identity.attrib.get("Name", ""),
        "publisher": identity.attrib.get("Publisher", ""),
        "version": identity.attrib.get("Version", ""),
        "architecture": identity.attrib.get("ProcessorArchitecture", "").lower(),
        "publisher_display_name": publisher_display,
        "capabilities": capabilities,
        "manifest_sha256": sha256_bytes(payload),
    }


def inspect_bundle(path: Path) -> list[dict[str, Any]]:
    try:
        with zipfile.ZipFile(path) as bundle:
            entries = [entry for entry in bundle.namelist() if entry.lower().endswith((".appx", ".msix"))]
            if entries:
                packages: list[dict[str, Any]] = []
                for entry in entries:
                    nested = bundle.read(entry)
                    with zipfile.ZipFile(io.BytesIO(nested)) as package:
                        manifest_name = next((name for name in package.namelist() if name.lower().endswith("appxmanifest.xml")), None)
                        if manifest_name is None:
                            raise ValueError(f"{entry}: package has no AppxManifest.xml")
                        packages.append(parse_appx_manifest(package.read(manifest_name), Path(entry).name))
                return packages
            manifest_name = next((name for name in bundle.namelist() if name.lower().endswith("appxmanifest.xml")), None)
            if manifest_name is None:
                raise ValueError("archive is neither an MSIX/AppX package nor an MSIXBundle with nested packages")
            return [parse_appx_manifest(bundle.read(manifest_name), path.name)]
    except zipfile.BadZipFile as error:
        raise ValueError(f"candidate is not a readable MSIX/AppX ZIP container: {error}") from error


def require(condition: bool, message: str, errors: list[str]) -> None:
    if not condition:
        errors.append(message)


def validate_template(manifest: dict[str, Any], errors: list[str]) -> None:
    require(manifest.get("capture_mode") == "template_only", "template must set capture_mode to template_only", errors)
    require(manifest.get("submission_status") == "not_captured_not_for_upload", "template must set a non-uploadable submission_status", errors)
    for key in ("source_commit", "package_sha256", "architecture", "windows_version", "native_resolution", "captured_at_utc"):
        require(manifest.get(key) is None, f"template field {key} must remain null until evidence exists", errors)
    candidate = manifest.get("candidate_evidence")
    require(isinstance(candidate, dict), "template must include candidate_evidence", errors)
    gates = manifest.get("truthfulness_gates")
    require(isinstance(gates, dict), "template must include truthfulness_gates", errors)
    if isinstance(gates, dict):
        require(gates.get("required_capture_origin") == "native_app_window_from_exact_installed_clean_windows_tested_msix", "template must require captures from the exact installed clean-Windows-tested MSIX", errors)
        file_rules = gates.get("file_requirements")
        require(isinstance(file_rules, dict), "template must include PNG file requirements", errors)
        if isinstance(file_rules, dict):
            require(file_rules.get("format") == "png", "template must require PNG screenshots", errors)
            require(file_rules.get("minimum_width_px") == 1366 and file_rules.get("minimum_height_px") == 768, "template must require at least 1366x768 screenshots", errors)
            require(file_rules.get("maximum_file_size_bytes") == MAX_FILE_SIZE, "template must require a 50 MB screenshot limit", errors)
        prohibited = set(gates.get("prohibited_sources", []))
        for source in ("browser_preview_or_web_page", "fixture_or_mocked_ipc", "composited_or_ai_generated_mockup", "older_release_build", "macos_or_linux_session"):
            require(source in prohibited, f"template must prohibit {source}", errors)
    screenshots = manifest.get("screenshots")
    require(isinstance(screenshots, list) and len(screenshots) >= 4, "template must plan at least four core screenshots", errors)
    if isinstance(screenshots, list):
        states = [item.get("state") for item in screenshots if isinstance(item, dict)]
        for state in REQUIRED_STATES:
            require(state in states, f"template is missing core screenshot state: {state}", errors)
        for item in screenshots:
            if not isinstance(item, dict):
                errors.append("template screenshot entry must be an object")
                continue
            require(REQUIRED_SCREENSHOT_FIELDS.issubset(item), "template screenshot entry lacks a required provenance field", errors)
            for key in ("capture_origin", "captured_at_utc", "native_window_title", "sha256", "pixel_dimensions", "file_size_bytes"):
                require(item.get(key) is None, f"template screenshot field {key} must remain null until capture", errors)


def validate_final_manifest(
    manifest: dict[str, Any], bundle: Path, packages: list[dict[str, Any]], screenshots_dir: Path | None,
    build_commit: str | None, errors: list[str], warnings: list[str]
) -> None:
    require(manifest.get("capture_mode") == "submission", "final manifest must set capture_mode to submission", errors)
    require(manifest.get("submission_status") == "final_tested_windows_msix", "final manifest must set final_tested_windows_msix status", errors)
    for key in ("source_commit", "package_sha256", "architecture", "windows_version", "native_resolution", "captured_at_utc"):
        require(is_nonempty(manifest.get(key)), f"final manifest needs {key}", errors)
    if is_nonempty(manifest.get("captured_at_utc")):
        require(parse_utc(manifest["captured_at_utc"]), "captured_at_utc must be ISO-8601", errors)
    if build_commit:
        require(manifest.get("source_commit") == build_commit, "source_commit does not match the externally recorded build commit", errors)
    computed_bundle_sha = sha256_file(bundle)
    require(manifest.get("package_sha256") == computed_bundle_sha, "package_sha256 does not match the supplied bundle", errors)
    candidate = manifest.get("candidate_evidence")
    require(isinstance(candidate, dict), "final manifest must include candidate_evidence", errors)
    if isinstance(candidate, dict):
        for key in ("msix_bundle_file", "package_identity_name", "package_full_name"):
            require(is_nonempty(candidate.get(key)), f"candidate_evidence needs {key}", errors)
        require(candidate.get("msix_bundle_file") == bundle.name, "candidate bundle filename does not match the supplied bundle", errors)
        package_manifests = candidate.get("package_manifests")
        require(isinstance(package_manifests, list) and len(package_manifests) == len(packages), "candidate_evidence.package_manifests must record every package manifest", errors)
        if isinstance(package_manifests, list):
            actual_manifest_hashes = {item["manifest_sha256"] for item in packages}
            claimed_hashes = {item.get("sha256") for item in package_manifests if isinstance(item, dict)}
            require(actual_manifest_hashes == claimed_hashes, "recorded package manifest hashes do not match the supplied bundle", errors)
        expected_name = candidate.get("package_identity_name")
        if is_nonempty(expected_name):
            require(all(item["identity_name"] == expected_name for item in packages), "package identity name does not match all package manifests", errors)
        test = candidate.get("clean_windows_test")
        require(isinstance(test, dict), "candidate_evidence must include clean_windows_test", errors)
        if isinstance(test, dict):
            for key in ("test_record_id", "tested_at_utc"):
                require(is_nonempty(test.get(key)), f"clean_windows_test needs {key}", errors)
            if is_nonempty(test.get("tested_at_utc")):
                require(parse_utc(test["tested_at_utc"]), "clean_windows_test.tested_at_utc must be ISO-8601", errors)
            for key in ("install_passed", "launch_passed", "real_workflow_adapters_passed", "clean_uninstall_passed", "temporary_certificate_removed"):
                require(test.get(key) is True, f"clean_windows_test.{key} must be true", errors)
    actual_architectures = {item["architecture"] for item in packages}
    require({"x64", "arm64"}.issubset(actual_architectures), "supplied bundle must contain both x64 and arm64 packages", errors)
    identity_pairs = {(item["identity_name"], item["publisher"]) for item in packages}
    require(len(identity_pairs) == 1, "all packages in the bundle must share one identity and publisher", errors)
    if identity_pairs:
        name, publisher = next(iter(identity_pairs))
        warnings.append(f"inspected package identity fingerprint: {identity_fingerprint(name, publisher)} (exact value redacted)")
    if screenshots_dir is None:
        errors.append("final manifest validation requires --screenshots-dir")
        return
    screenshots = manifest.get("screenshots")
    require(isinstance(screenshots, list) and len(screenshots) >= 1, "final manifest needs at least one screenshot", errors)
    if isinstance(screenshots, list):
        for item in screenshots:
            if not isinstance(item, dict):
                errors.append("final screenshot entry must be an object")
                continue
            require(REQUIRED_SCREENSHOT_FIELDS.issubset(item), "final screenshot entry lacks a required field", errors)
            file_name = item.get("file")
            if not is_nonempty(file_name):
                errors.append("final screenshot file must be named")
                continue
            screenshot_path = screenshots_dir / file_name
            require(screenshot_path.is_file(), f"screenshot file is missing: {file_name}", errors)
            if not screenshot_path.is_file():
                continue
            try:
                width, height = png_dimensions(screenshot_path)
            except ValueError as error:
                errors.append(f"{file_name}: {error}")
                continue
            size = screenshot_path.stat().st_size
            require(width >= 1366 and height >= 768, f"{file_name}: dimensions must be at least 1366x768", errors)
            require(size <= MAX_FILE_SIZE, f"{file_name}: file size must be no larger than 50 MB", errors)
            require(item.get("pixel_dimensions") == f"{width}x{height}", f"{file_name}: recorded pixel_dimensions do not match PNG", errors)
            require(item.get("file_size_bytes") == size, f"{file_name}: recorded file_size_bytes do not match PNG", errors)
            require(item.get("sha256") == sha256_file(screenshot_path), f"{file_name}: recorded SHA-256 does not match PNG", errors)
            for key in ("capture_origin", "native_window_title"):
                require(is_nonempty(item.get(key)), f"{file_name}: {key} must be recorded", errors)
            require(is_nonempty(item.get("captured_at_utc")) and parse_utc(item.get("captured_at_utc")), f"{file_name}: captured_at_utc must be ISO-8601", errors)
            caption = item.get("caption", "")
            require(isinstance(caption, str) and len(caption) <= 200, f"{file_name}: caption must be factual Partner Center text of 200 characters or fewer", errors)
            require(item.get("capture_origin") == "native_app_window_from_exact_installed_clean_windows_tested_msix", f"{file_name}: capture_origin is not permitted", errors)


def verify_checksum_file(bundle: Path, checksum_file: Path | None, errors: list[str]) -> dict[str, Any]:
    actual_hash = sha256_file(bundle)
    if checksum_file is None:
        return {
            "status": "not_provided",
            "actual_sha256": actual_hash,
            "recorded_sha256": None,
            "sha256_match": None,
            "filename_match": None,
        }
    try:
        line = checksum_file.read_text(encoding="utf-8").strip()
        recorded_hash, recorded_name = line.split(maxsplit=1)
        recorded_name = recorded_name.strip().lstrip("*")
    except (OSError, ValueError) as error:
        errors.append(f"checksum file is malformed: {error}")
        return {
            "status": "malformed",
            "actual_sha256": actual_hash,
            "recorded_sha256": None,
            "sha256_match": None,
            "filename_match": None,
        }
    hash_matches = recorded_hash.lower() == actual_hash
    filename_matches = recorded_name == bundle.name
    require(hash_matches, "checksum file SHA-256 does not match the supplied bundle", errors)
    require(filename_matches, "checksum file filename does not match the supplied bundle", errors)
    return {
        "status": "verified" if hash_matches and filename_matches else "mismatch",
        "actual_sha256": actual_hash,
        "recorded_sha256": recorded_hash.lower(),
        "sha256_match": hash_matches,
        "filename_match": filename_matches,
    }


def build_report(
    mode: str, bundle: Path, packages: list[dict[str, Any]], checksum_verification: dict[str, Any],
    errors: list[str], warnings: list[str]
) -> dict[str, Any]:
    return {
        "validated_at_utc": datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z"),
        "mode": mode,
        "bundle": {"file": bundle.name, "sha256": sha256_file(bundle), "package_count": len(packages)},
        "checksum_verification": checksum_verification,
        "packages": [
            {
                "file": item["package_file"],
                "architecture": item["architecture"],
                "version": item["version"],
                "capabilities": item["capabilities"],
                "manifest_sha256": item["manifest_sha256"],
                "identity_fingerprint": identity_fingerprint(item["identity_name"], item["publisher"]),
            }
            for item in packages
        ],
        "result": "pass" if not errors else "fail",
        "errors": errors,
        "warnings": warnings,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Validate a capture manifest against an actual MSIX/AppX candidate without printing identity values.")
    parser.add_argument("--manifest", type=Path, required=True, help="Capture manifest JSON")
    parser.add_argument("--bundle", type=Path, required=True, help="MSIX, AppX, or MSIXBundle candidate")
    parser.add_argument("--checksum-file", type=Path, help="Optional SHA-256 companion file")
    parser.add_argument("--screenshots-dir", type=Path, help="Final PNG directory; required for submission manifests")
    parser.add_argument("--build-commit", help="Optional externally recorded commit to match against final manifest source_commit")
    parser.add_argument("--allow-template", action="store_true", help="Validate a non-uploadable template against an inspected candidate")
    parser.add_argument("--report", type=Path, help="Write a machine-readable JSON report")
    args = parser.parse_args()

    errors: list[str] = []
    warnings: list[str] = []
    try:
        manifest = read_manifest(args.manifest)
        packages = inspect_bundle(args.bundle)
    except ValueError as error:
        print(f"FAIL: {error}", file=sys.stderr)
        return 2
    template_mode = manifest.get("capture_mode") == "template_only"
    if not template_mode and args.checksum_file is None:
        errors.append("final manifest validation requires --checksum-file")
    checksum_verification = verify_checksum_file(args.bundle, args.checksum_file, errors)
    if checksum_verification["status"] == "not_provided":
        warnings.append("checksum companion not supplied; digest was computed but not independently compared")
    if template_mode:
        if not args.allow_template:
            errors.append("template manifest requires --allow-template and is never upload-ready")
        validate_template(manifest, errors)
        warnings.append("template validated against candidate metadata only; it is not linked to the candidate and cannot be uploaded")
        mode = "template_evidence_check"
    else:
        validate_final_manifest(manifest, args.bundle, packages, args.screenshots_dir, args.build_commit, errors, warnings)
        mode = "final_submission_evidence_check"
    report = build_report(mode, args.bundle, packages, checksum_verification, errors, warnings)
    if args.report:
        args.report.parent.mkdir(parents=True, exist_ok=True)
        args.report.write_text(json.dumps(report, indent=2) + "\n", encoding="utf-8")
    print(f"RESULT: {report['result'].upper()} ({mode})")
    print(f"BUNDLE: {bundle_label(args.bundle)}")
    for package in report["packages"]:
        print(f"PACKAGE: {package['file']} architecture={package['architecture']} manifest_sha256={package['manifest_sha256']}")
    for warning in warnings:
        print(f"WARNING: {warning}")
    for error in errors:
        print(f"ERROR: {error}", file=sys.stderr)
    return 0 if not errors else 2


def bundle_label(path: Path) -> str:
    return f"{path.name} sha256={sha256_file(path)}"


if __name__ == "__main__":
    raise SystemExit(main())
