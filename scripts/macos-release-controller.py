#!/usr/bin/env python3
"""Fixed macOS release controller. Never imports or executes packaged application code.

Only Python's standard library and Apple's system signing/packaging tools are used.
The build, signer and attestor run on separate hosted runners; this file is checked
out from the workflow controller commit, never loaded from the build artifact.
"""
import argparse
import base64
from collections import deque
import hashlib
import json
import os
from pathlib import Path, PurePosixPath
import plistlib
import re
import secrets
import shutil
import stat
import subprocess
import tarfile
import tempfile

APP = 'Claude Code Tools Installer.app'
BUNDLE_ID = 'com.skamerica.claudecodetoolsinstaller'
PREDICATE = 'https://claudetool.app/attestations/macos-source/v1'
ENTITLEMENTS = {'com.apple.security.cs.allow-jit': True,
                'com.apple.security.cs.allow-unsigned-executable-memory': True}


def require(condition, message):
    if not condition:
        raise ValueError(message)


def sha(file, algorithm='sha256'):
    h = hashlib.new(algorithm)
    with Path(file).open('rb') as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b''):
            h.update(chunk)
    return h.hexdigest()


def identity(source, controller, version):
    require(re.fullmatch(r'[a-f0-9]{40}', source or ''), 'Require full source commit')
    require(re.fullmatch(r'[a-f0-9]{40}', controller or ''), 'Require full controller commit')
    require(re.fullmatch(r'(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)\.(?:0|[1-9][0-9]*)', version or ''), 'Require canonical package version')


def safe_unpack(archive, destination):
    """Validate every member before writing; reject traversal, aliases and special files."""
    destination = Path(destination)
    require(not destination.exists(), 'Extraction destination must be new')
    with tarfile.open(archive, 'r:gz') as tf:
        members = tf.getmembers()
        require(0 < len(members) <= 30000, 'Invalid archive entry count')
        require(sum(m.size for m in members) <= 2 * 1024**3, 'Archive exceeds size limit')
        names, links, link_directories = set(), {}, {}
        by_name = {m.name: m for m in members}
        for m in members:
            p = PurePosixPath(m.name)
            require(m.name == str(p) and not p.is_absolute() and '..' not in p.parts
                    and p.parts[0] == APP and not any(ord(c) < 32 for c in m.name), 'Unsafe archive path')
            require(m.name not in names, 'Duplicate archive path')
            names.add(m.name)
            require(m.isdir() or m.isfile() or m.issym(), 'Archive special files and hard links are refused')
            if m.issym():
                target = PurePosixPath(m.linkname)
                require(not target.is_absolute() and '\\' not in m.linkname, 'Unsafe symbolic link')
                links[m.name] = target.parts
        # No member may be written through an archived symbolic-link ancestor.
        for name in names:
            require(not any(str(p) in links for p in PurePosixPath(name).parents), 'Linked archive ancestor')
        directories = {m.name for m in members if m.isdir()}
        directories.update(str(parent) for name in names for parent in PurePosixPath(name).parents if str(parent) != '.')
        # Expand an encountered link immediately, before processing later .. components.
        # Lexically collapsing a/../.. first can hide that a itself redirects traversal.
        for name, raw_target in links.items():
            pending = deque((*PurePosixPath(name).parent.parts, *raw_target))
            resolved, expansions = [], 0
            while pending:
                component = pending.popleft()
                if component in ['', '.']:
                    continue
                if component == '..':
                    require(len(resolved) > 1, 'Symbolic link escapes app')
                    resolved.pop()
                    continue
                resolved.append(component)
                current = '/'.join(resolved)
                if current in links:
                    expansions += 1
                    require(expansions <= 40, 'Cyclic or excessively chained symbolic link')
                    resolved.pop()
                    pending.extendleft(reversed(links[current]))
                elif pending:
                    require(current in directories, 'Symbolic link traverses a non-directory')
            target = '/'.join(resolved)
            require(target in names, 'Dangling symbolic link')
            link_directories[name] = by_name[target].isdir()
        destination.mkdir(mode=0o700)
        try:
            for m in sorted(members, key=lambda x: (len(PurePosixPath(x.name).parts), x.name)):
                path = destination / m.name
                if m.isdir():
                    path.mkdir(parents=True, exist_ok=True, mode=0o755)
                elif m.isfile():
                    path.parent.mkdir(parents=True, exist_ok=True)
                    with tf.extractfile(m) as src, path.open('xb') as dst:
                        shutil.copyfileobj(src, dst)
                    path.chmod(m.mode & 0o777)
            for m in members:
                if m.issym():
                    # The archive uses POSIX spelling, while Windows reparse points
                    # require native separators and an explicit directory-link type.
                    target = Path(*PurePosixPath(m.linkname).parts)
                    (destination / m.name).symlink_to(target, target_is_directory=link_directories[m.name])
        except BaseException:
            shutil.rmtree(destination)
            raise
    return destination / APP


def pack(app, archive):
    require(Path(app).name == APP and Path(app).is_dir() and not Path(app).is_symlink(), 'Require the expected app bundle')
    with tarfile.open(archive, 'w:gz', dereference=False) as tf:
        def portable_link(entry):
            if entry.issym():
                entry.linkname = entry.linkname.replace(os.sep, '/')
            return entry
        tf.add(app, arcname=APP, filter=portable_link)


def run(*args):
    # Do not echo command arguments: security/notarytool arguments can contain credentials.
    result = subprocess.run(args, check=False, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    if result.returncode:
        raise RuntimeError(f'{Path(args[0]).name} failed (exit {result.returncode}); release stopped')
    return result.stdout.decode('utf-8', errors='strict') + result.stderr.decode('utf-8', errors='strict')


def describe(file):
    p = Path(file)
    return {'name': p.name, 'size': p.stat().st_size, 'sha256': sha(p),
            'sha512': base64.b64encode(bytes.fromhex(sha(p, 'sha512'))).decode()}


def update_metadata(version, artifacts):
    dmg, zipfile = artifacts
    lines = [f'version: {version}', 'files:']
    for file in [zipfile, dmg]:
        lines.extend([f'  - url: {file["name"]}', f'    sha512: {file["sha512"]}', f'    size: {file["size"]}'])
    return '\n'.join(lines + [f'path: {zipfile["name"]}', f'sha512: {zipfile["sha512"]}', ''])


def sign(archive, output, source, controller, version, input_digest, env=None):
    env = dict(os.environ if env is None else env)
    identity(source, controller, version)
    require(sha(archive) == input_digest, 'Unsigned input digest mismatch')
    name = env.get('CSC_NAME', '')
    # Existing CCTI secrets store the certificate common name without this prefix.
    if name and not name.startswith('Developer ID Application: '):
        name = 'Developer ID Application: ' + name
    team = re.search(r'\(([A-Z0-9]{10})\)$', name)
    require(name.startswith('Developer ID Application: ') and team, 'Require an explicit Developer ID Application identity with team ID')
    team = team.group(1)
    require(env.get('CSC_KEY_PASSWORD'), 'Missing signing password')
    api_mode = all(env.get(x) for x in ['APPLE_API_KEY_BASE64', 'APPLE_API_KEY_ID', 'APPLE_API_ISSUER'])
    apple_mode = all(env.get(x) for x in ['APPLE_ID', 'APPLE_APP_SPECIFIC_PASSWORD', 'APPLE_TEAM_ID'])
    require(api_mode or apple_mode, 'Require complete API-key or Apple ID notarization credentials')
    require(not env.get('APPLE_TEAM_ID') or env['APPLE_TEAM_ID'] == team, 'Notarization and signing team mismatch')
    output = Path(output)
    output.mkdir(mode=0o700, parents=True, exist_ok=False)
    # Temporary directories and keychains are private and destroyed even on signing failure.
    with tempfile.TemporaryDirectory(prefix='ccti-fixed-signer-') as scratch:
        scratch = Path(scratch)
        app = safe_unpack(archive, scratch / 'input')
        with (app / 'Contents/Info.plist').open('rb') as stream:
            info = plistlib.load(stream)
        require(info.get('CFBundleIdentifier') == BUNDLE_ID and info.get('CFBundleShortVersionString') == version,
                'Unsigned bundle identity mismatch')
        executable = info.get('CFBundleExecutable', '')
        require(executable and Path(executable).name == executable, 'Invalid bundle executable')
        architecture = run('/usr/bin/file', '-b', str(app / 'Contents/MacOS' / executable))
        require('arm64' in architecture and 'x86_64' not in architecture, 'Require the reviewed arm64 application')
        p12, p8, keychain = [scratch / x for x in ['identity.p12', 'key.p8', 'signing.keychain-db']]
        p12.write_bytes(base64.b64decode(''.join(env['MACOS_CERTIFICATE_P12_BASE64'].split()), validate=True))
        p12.chmod(0o600)
        entitlement = scratch / 'entitlements.plist'
        entitlement.write_bytes(plistlib.dumps(ENTITLEMENTS))
        password = secrets.token_hex(32)
        try:
            run('/usr/bin/security', 'create-keychain', '-p', password, str(keychain))
            run('/usr/bin/security', 'unlock-keychain', '-p', password, str(keychain))
            run('/usr/bin/security', 'set-keychain-settings', '-lut', '3600', str(keychain))
            run('/usr/bin/security', 'import', str(p12), '-k', str(keychain), '-P', env['CSC_KEY_PASSWORD'], '-T', '/usr/bin/codesign')
            run('/usr/bin/security', 'set-key-partition-list', '-S', 'apple-tool:,apple:,codesign:', '-s', '-k', password, str(keychain))
            # Sign native leaves first, then nested bundles from inside out. No deep-sign
            # shortcut, application launch, npm, build hooks, or artifact-supplied scripts.
            for file in sorted(app.rglob('*')):
                if file.is_symlink() or not file.is_file():
                    continue
                description = run('/usr/bin/file', '-b', str(file))
                if 'Mach-O' in description:
                    run('/usr/bin/codesign', '--force', '--sign', name, '--keychain', str(keychain),
                        '--options', 'runtime', '--timestamp', '--entitlements', str(entitlement), str(file))
            bundles = [p for p in app.rglob('*') if not p.is_symlink() and p.is_dir()
                       and p.suffix in ['.app', '.framework', '.xpc', '.bundle']]
            for bundle in sorted(bundles, key=lambda p: len(p.parts), reverse=True) + [app]:
                run('/usr/bin/codesign', '--force', '--sign', name, '--keychain', str(keychain),
                    '--options', 'runtime', '--timestamp', '--entitlements', str(entitlement), str(bundle))
            run('/usr/bin/codesign', '--verify', '--deep', '--strict', str(app))
            signature = run('/usr/bin/codesign', '-dvvv', str(app))
            require(f'TeamIdentifier={team}' in signature.splitlines() and f'Authority={name}' in signature.splitlines(), 'Unexpected signed identity')
            if api_mode:
                p8.write_bytes(base64.b64decode(''.join(env['APPLE_API_KEY_BASE64'].split()), validate=True))
                p8.chmod(0o600)
                auth = ['--key', str(p8), '--key-id', env['APPLE_API_KEY_ID'], '--issuer', env['APPLE_API_ISSUER']]
            else:
                auth = ['--apple-id', env['APPLE_ID'], '--password', env['APPLE_APP_SPECIFIC_PASSWORD'], '--team-id', team]
            def notarize(file):
                result = json.loads(run('/usr/bin/xcrun', 'notarytool', 'submit', str(file), *auth, '--wait', '--output-format', 'json'))
                require(result.get('status') == 'Accepted', 'Notarization was not accepted')
                return result['id']
            request = scratch / 'application.zip'
            run('/usr/bin/ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(app), str(request))
            zip_notary = notarize(request)
            run('/usr/bin/xcrun', 'stapler', 'staple', str(app))
            run('/usr/bin/xcrun', 'stapler', 'validate', str(app))
            run('/usr/sbin/spctl', '-a', '-t', 'execute', str(app))
            prefix = f'Claude-Code-Tools-Installer-{version}-mac-arm64'
            zipfile, dmg = output / f'{prefix}.zip', output / f'{prefix}.dmg'
            run('/usr/bin/ditto', '-c', '-k', '--sequesterRsrc', '--keepParent', str(app), str(zipfile))
            image = scratch / 'image'
            image.mkdir()
            shutil.move(str(app), image / APP)
            (image / 'Applications').symlink_to('/Applications', target_is_directory=True)
            run('/usr/bin/hdiutil', 'create', '-volname', 'Claude Code Tools Installer', '-srcfolder', str(image), '-format', 'UDZO', str(dmg))
            run('/usr/bin/codesign', '--force', '--sign', name, '--keychain', str(keychain), '--timestamp', str(dmg))
            dmg_notary = notarize(dmg)
            run('/usr/bin/xcrun', 'stapler', 'staple', str(dmg))
            run('/usr/bin/xcrun', 'stapler', 'validate', str(dmg))
            artifacts = [describe(dmg), describe(zipfile)]
            metadata = output / 'latest-mac.yml'
            metadata.write_text(update_metadata(version, artifacts))
            artifacts.append(describe(metadata))
            for a in artifacts[:2]:
                (output / f'{a["name"]}.sha256').write_text(f'{a["sha256"]}  {a["name"]}\n')
            receipt = {'source_commit': source, 'controller_commit': controller, 'version': version,
                       'architecture': 'arm64', 'bundle_id': BUNDLE_ID, 'signer': name, 'team_id': team,
                       'unsigned_input_sha256': input_digest, 'notarization': {'app': zip_notary, 'dmg': dmg_notary},
                       'verification': {'code_signature': True, 'gatekeeper': True, 'stapled_app': True, 'stapled_dmg': True},
                       'artifacts': artifacts}
            (output / 'macos-source-predicate.json').write_text(json.dumps(receipt, indent=2) + '\n')
        finally:
            try:
                run('/usr/bin/security', 'delete-keychain', str(keychain))
            finally:
                for secret in [p12, p8]:
                    secret.unlink(missing_ok=True)


def verify(directory, source, controller, version, verified=None):
    """Byte/source/metadata validation; trust comes only from fresh gh verification output."""
    identity(source, controller, version)
    directory = Path(directory)
    receipt = json.loads((directory / 'macos-source-predicate.json').read_text())
    require(receipt['source_commit'] == source and receipt['controller_commit'] == controller and receipt['version'] == version,
            'Source/controller/version mismatch')
    require(receipt['architecture'] == 'arm64' and receipt['bundle_id'] == BUNDLE_ID, 'Bundle scope mismatch')
    require(re.fullmatch(r'[A-Z0-9]{10}', receipt['team_id']), 'Invalid signing team')
    require(receipt['signer'].startswith('Developer ID Application: ') and receipt['signer'].endswith(f'({receipt["team_id"]})'), 'Invalid signing identity')
    require(receipt['verification'] == {'code_signature': True, 'gatekeeper': True, 'stapled_app': True, 'stapled_dmg': True}, 'Missing native verification')
    require(all(isinstance(receipt['notarization'].get(x), str) and receipt['notarization'][x] for x in ['app', 'dmg']), 'Missing notarization record')
    prefix = f'Claude-Code-Tools-Installer-{version}-mac-arm64'
    names = [prefix + '.dmg', prefix + '.zip', 'latest-mac.yml']
    require([a['name'] for a in receipt['artifacts']] == names, 'Unexpected artifact set/version')
    expected_subjects = []
    for a in receipt['artifacts']:
        file = directory / a['name']
        require(file.is_file() and not file.is_symlink() and a == describe(file), 'Artifact digest/size mismatch')
        expected_subjects.append({'name': a['name'], 'digest': {'sha256': a['sha256']}})
        if file.suffix in ['.dmg', '.zip']:
            require((directory / (a['name'] + '.sha256')).read_text() == f'{a["sha256"]}  {a["name"]}\n', 'Invalid checksum sidecar')
    require((directory / 'latest-mac.yml').read_text() == update_metadata(version, receipt['artifacts'][:2]), 'Updater metadata mismatch')
    # When signing/staging is complete, publication MUST pass fresh trusted verifier output.
    if verified is not None:
        verified = json.loads(Path(verified).read_text())
        statements = [entry['verificationResult']['statement'] for entry in verified
                      if entry.get('verificationResult', {}).get('statement', {}).get('predicateType') == PREDICATE]
        require(len(statements) == 1 and statements[0]['predicate'] == receipt, 'Verified predicate does not match receipt')
        subjects = statements[0]['subject']
        require(sorted(subjects, key=lambda x: x['name']) == sorted(expected_subjects, key=lambda x: x['name']), 'Verified subjects do not match exact artifacts')
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('mode', choices=['pack', 'sign', 'verify'])
    parser.add_argument('--archive')
    parser.add_argument('--app')
    parser.add_argument('--directory')
    parser.add_argument('--source')
    parser.add_argument('--controller')
    parser.add_argument('--version')
    parser.add_argument('--input-digest')
    parser.add_argument('--verified')
    args = parser.parse_args()
    if args.mode == 'pack':
        pack(args.app, args.archive)
    elif args.mode == 'sign':
        sign(args.archive, args.directory, args.source, args.controller, args.version, args.input_digest)
    else:
        require(args.verified, 'Require fresh cryptographic verification output')
        verify(args.directory, args.source, args.controller, args.version, args.verified)
    print(f'macOS {args.mode} completed; packaged code was not executed by the controller.')


if __name__ == '__main__':
    main()
