#!/usr/bin/env python3
"""Offline native-controller orchestration tests: fake keys and tools, no real signing."""
import base64
import copy
import importlib.util
import io
import json
from pathlib import Path
import plistlib
import tarfile
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('controller', Path(__file__).with_name('macos-release-controller.py'))
c = importlib.util.module_from_spec(spec)
spec.loader.exec_module(c)
SOURCE, CONTROLLER, VERSION = 'a' * 40, 'b' * 40, '2026.10.1401'


class ControllerTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.app = self.root / c.APP
        (self.app / 'Contents/MacOS').mkdir(parents=True)
        (self.app / 'Contents/MacOS/CCTI').write_bytes(b'fixture Mach-O')
        (self.app / 'Contents/Info.plist').write_bytes(plistlib.dumps({'CFBundleIdentifier': c.BUNDLE_ID, 'CFBundleShortVersionString': VERSION, 'CFBundleExecutable': 'CCTI'}))
        # Packaged hooks are inert data even while fake signing secrets are present.
        (self.app / 'product-hook.py').write_text('raise RuntimeError("product hook executed")')
        self.archive = self.root / 'unsigned.tar.gz'
        c.pack(self.app, self.archive)
        self.output = self.root / 'signed'
        self.calls = []
        self.real_run = c.run
        c.run = self.fake_run
        self.addCleanup(setattr, c, 'run', self.real_run)
        self.env = {
            'MACOS_CERTIFICATE_P12_BASE64': base64.b64encode(b'fake P12').decode(),
            'CSC_KEY_PASSWORD': 'fake password', 'CSC_NAME': 'Developer ID Application: Fixture (ABCDEFGHIJ)',
            'APPLE_API_KEY_BASE64': base64.b64encode(b'fake P8').decode(),
            'APPLE_API_KEY_ID': 'fake-id', 'APPLE_API_ISSUER': 'fake-issuer',
        }

    def fake_run(self, *args):
        self.calls.append(args)
        if args[0] == '/usr/bin/file':
            return 'Mach-O 64-bit executable arm64'
        if args[:2] == ('/usr/bin/codesign', '-dvvv'):
            return 'Authority=Developer ID Application: Fixture (ABCDEFGHIJ)\nTeamIdentifier=ABCDEFGHIJ\n'
        if args[0] == '/usr/bin/ditto':
            Path(args[-1]).write_bytes(b'ZIP fixture bytes')
        if args[0] == '/usr/bin/hdiutil':
            Path(args[-1]).write_bytes(b'DMG fixture bytes')
        if args[:3] == ('/usr/bin/xcrun', 'notarytool', 'submit'):
            return json.dumps({'id': 'fixture-notary-id', 'status': 'Accepted'})
        return ''

    def signed(self):
        c.sign(self.archive, self.output, SOURCE, CONTROLLER, VERSION, c.sha(self.archive), self.env)
        return c.verify(self.output, SOURCE, CONTROLLER, VERSION)

    def verified(self, receipt):
        p = self.root / 'fresh-gh-output.json'
        p.write_text(json.dumps([{'verificationResult': {'statement': {
            'predicateType': c.PREDICATE, 'predicate': receipt,
            'subject': [{'name': a['name'], 'digest': {'sha256': a['sha256']}} for a in receipt['artifacts']],
        }}}]))
        return p

    def test_signer_only_uses_fixed_native_tools_and_cleans_keys(self):
        receipt = self.signed()
        self.assertEqual(c.verify(self.output, SOURCE, CONTROLLER, VERSION, self.verified(receipt)), receipt)
        self.assertTrue(self.calls)
        self.assertEqual(set(x[0] for x in self.calls), {'/usr/bin/file', '/usr/bin/security', '/usr/bin/codesign', '/usr/bin/ditto', '/usr/bin/hdiutil', '/usr/bin/xcrun', '/usr/sbin/spctl'})
        for call in self.calls:
            for arg in call:
                if arg.endswith(('identity.p12', 'key.p8')):
                    self.assertFalse(Path(arg).exists(), 'ephemeral credential survived')
        metadata_index = self.calls.index(next(x for x in self.calls if x[0] == '/usr/bin/hdiutil'))
        self.assertTrue(any(x[:3] == ('/usr/bin/xcrun', 'stapler', 'staple') for x in self.calls[:metadata_index]))

    def test_apple_id_mode(self):
        self.env = {k: v for k, v in self.env.items() if not k.startswith('APPLE_')}
        self.env.update(APPLE_ID='fixture@example.invalid', APPLE_APP_SPECIFIC_PASSWORD='fake', APPLE_TEAM_ID='ABCDEFGHIJ')
        self.signed()
        self.assertTrue(any('--apple-id' in x for x in self.calls))

    def test_existing_common_name_secret_remains_supported(self):
        self.env['CSC_NAME'] = 'Fixture (ABCDEFGHIJ)'
        self.env['MACOS_CERTIFICATE_P12_BASE64'] += '\n'
        self.env['APPLE_API_KEY_BASE64'] += '\n'
        receipt = self.signed()
        self.assertEqual(receipt['signer'], 'Developer ID Application: Fixture (ABCDEFGHIJ)')

    def test_wrong_architecture_stops_before_key_import(self):
        original = self.fake_run
        c.run = lambda *args: 'Mach-O 64-bit executable x86_64' if args[0] == '/usr/bin/file' else original(*args)
        with self.assertRaisesRegex(ValueError, 'reviewed arm64'):
            self.signed()
        self.assertFalse(any(x[0] == '/usr/bin/security' for x in self.calls))

    def test_failure_cleans_credentials_and_keychain(self):
        original = self.fake_run
        def failing(*args):
            if args[0] == '/usr/bin/codesign':
                raise RuntimeError('injected signing failure')
            return original(*args)
        c.run = failing
        with self.assertRaisesRegex(RuntimeError, 'injected'):
            self.signed()
        self.assertTrue(any(x[:2] == ('/usr/bin/security', 'delete-keychain') for x in self.calls))
        certificate = next(x[2] for x in self.calls if x[:2] == ('/usr/bin/security', 'import'))
        self.assertFalse(Path(certificate).exists())

    def test_wrong_unsigned_digest_stops_before_credentials(self):
        with self.assertRaisesRegex(ValueError, 'digest mismatch'):
            c.sign(self.archive, self.output, SOURCE, CONTROLLER, VERSION, '0' * 64, self.env)
        self.assertEqual(self.calls, [])

    def test_incomplete_auth_is_refused(self):
        self.env.pop('APPLE_API_ISSUER')
        with self.assertRaisesRegex(ValueError, 'complete API-key'):
            self.signed()
        self.assertEqual(self.calls, [])

    def test_wrong_signing_identity_is_refused(self):
        self.env['CSC_NAME'] = 'ad-hoc'
        with self.assertRaisesRegex(ValueError, 'Developer ID'):
            self.signed()

    def test_notarization_rejection_is_refused(self):
        original = self.fake_run
        def rejected(*args):
            if args[:3] == ('/usr/bin/xcrun', 'notarytool', 'submit'):
                return json.dumps({'status': 'Invalid'})
            return original(*args)
        c.run = rejected
        with self.assertRaisesRegex(ValueError, 'not accepted'):
            self.signed()
        self.assertFalse((self.output / 'macos-source-predicate.json').exists())

    def test_artifact_byte_tampering_is_refused(self):
        receipt = self.signed()
        (self.output / receipt['artifacts'][0]['name']).write_bytes(b'altered')
        with self.assertRaisesRegex(ValueError, 'digest/size'):
            c.verify(self.output, SOURCE, CONTROLLER, VERSION)

    def test_recalculated_sidecar_and_receipt_do_not_match_signed_predicate(self):
        receipt = self.signed()
        trusted = self.verified(copy.deepcopy(receipt))
        file = self.output / receipt['artifacts'][0]['name']
        file.write_bytes(b'altered')
        receipt['artifacts'][0] = c.describe(file)
        (self.output / (file.name + '.sha256')).write_text(f'{c.sha(file)}  {file.name}\n')
        metadata = self.output / 'latest-mac.yml'
        metadata.write_text(c.update_metadata(VERSION, receipt['artifacts'][:2]))
        receipt['artifacts'][2] = c.describe(metadata)
        (self.output / 'macos-source-predicate.json').write_text(json.dumps(receipt))
        with self.assertRaisesRegex(ValueError, 'predicate does not match'):
            c.verify(self.output, SOURCE, CONTROLLER, VERSION, trusted)

    def test_wrong_source_controller_and_version_are_refused(self):
        self.signed()
        for args in [('c'*40, CONTROLLER, VERSION), (SOURCE, 'c'*40, VERSION), (SOURCE, CONTROLLER, '2026.10.1402')]:
            with self.subTest(args=args), self.assertRaisesRegex(ValueError, 'Source/controller/version'):
                c.verify(self.output, *args)

    def test_wrong_signer_and_missing_native_evidence_are_refused(self):
        receipt = self.signed()
        for field, value in [('signer', 'ad-hoc'), ('verification', {}), ('notarization', {})]:
            altered = copy.deepcopy(receipt)
            altered[field] = value
            (self.output / 'macos-source-predicate.json').write_text(json.dumps(altered))
            with self.subTest(field=field), self.assertRaises(ValueError):
                c.verify(self.output, SOURCE, CONTROLLER, VERSION)

    def test_metadata_and_missing_verified_subject_are_refused(self):
        receipt = self.signed()
        trusted = self.verified(receipt)
        verified = json.loads(trusted.read_text())
        verified[0]['verificationResult']['statement']['subject'].pop()
        trusted.write_text(json.dumps(verified))
        with self.assertRaisesRegex(ValueError, 'subjects'):
            c.verify(self.output, SOURCE, CONTROLLER, VERSION, trusted)
        (self.output / 'latest-mac.yml').write_text('version: 0.0.1\n')
        with self.assertRaisesRegex(ValueError, 'digest/size'):
            c.verify(self.output, SOURCE, CONTROLLER, VERSION)

    def test_framework_internal_symlink_round_trip(self):
        framework = self.app / 'Contents/Frameworks/Example.framework'
        (framework / 'Versions/A').mkdir(parents=True)
        (framework / 'Versions/A/Example').write_bytes(b'native fixture')
        (framework / 'Versions/Current').symlink_to('A', target_is_directory=True)
        (framework / 'Example').symlink_to(Path('Versions/Current/Example'))
        c.pack(self.app, self.archive)
        app = c.safe_unpack(self.archive, self.root / 'unpacked')
        self.assertEqual((app / 'Contents/Frameworks/Example.framework/Example').read_bytes(), b'native fixture')

    def test_hostile_archive_paths_and_types_are_refused_before_writes(self):
        for label, name, kind, link in [
            ('traversal', c.APP + '/../sentinel', tarfile.REGTYPE, ''),
            ('absolute', '/tmp/sentinel', tarfile.REGTYPE, ''),
            ('external-link', c.APP + '/link', tarfile.SYMTYPE, '../../sentinel'),
            ('device', c.APP + '/device', tarfile.CHRTYPE, ''),
            ('hardlink', c.APP + '/hard', tarfile.LNKTYPE, c.APP + '/file'),
        ]:
            with self.subTest(label=label):
                archive = self.root / (label + '.tar.gz')
                with tarfile.open(archive, 'w:gz') as tf:
                    entry = tarfile.TarInfo(name)
                    entry.type, entry.linkname = kind, link
                    tf.addfile(entry)
                destination = self.root / label
                with self.assertRaises(ValueError):
                    c.safe_unpack(archive, destination)
                self.assertFalse(destination.exists())

    def test_duplicate_and_link_ancestor_are_refused(self):
        for label in ['duplicate', 'link-ancestor']:
            archive = self.root / (label + '.tar.gz')
            with tarfile.open(archive, 'w:gz') as tf:
                for index in range(2):
                    entry = tarfile.TarInfo(c.APP + ('/file' if label == 'duplicate' else '/link' + ('/file' if index else '')))
                    if label == 'link-ancestor' and index == 0:
                        entry.type, entry.linkname = tarfile.SYMTYPE, '.'
                    tf.addfile(entry)
            with self.assertRaises(ValueError):
                c.safe_unpack(archive, self.root / label)

    def test_chained_link_parent_traversal_is_refused_before_writes(self):
        archive = self.root / 'chained-escape.tar.gz'
        outside = self.root / 'outside'
        outside.write_bytes(b'outside fixture sentinel')
        with tarfile.open(archive, 'w:gz') as tf:
            for name in [c.APP, c.APP + '/Contents']:
                entry = tarfile.TarInfo(name)
                entry.type = tarfile.DIRTYPE
                tf.addfile(entry)
            decoy = tarfile.TarInfo(c.APP + '/outside')
            decoy.size = len(b'harmless decoy')
            tf.addfile(decoy, io.BytesIO(b'harmless decoy'))
            for name, target in [('shortcut', '..'), ('escape', 'shortcut/../../outside')]:
                entry = tarfile.TarInfo(c.APP + '/Contents/' + name)
                entry.type, entry.linkname = tarfile.SYMTYPE, target
                tf.addfile(entry)
        destination = self.root / 'unpacked'
        with self.assertRaisesRegex(ValueError, 'escapes app'):
            c.safe_unpack(archive, destination)
        self.assertFalse(destination.exists(), 'Reject the complete archive before any extraction writes')
        self.assertEqual(outside.read_bytes(), b'outside fixture sentinel')

    def test_safe_parent_traversal_after_link_expansion_stays_supported(self):
        archive = self.root / 'safe-chain.tar.gz'
        with tarfile.open(archive, 'w:gz') as tf:
            for name in [c.APP, c.APP + '/Contents', c.APP + '/Resources', c.APP + '/Resources/A']:
                entry = tarfile.TarInfo(name)
                entry.type = tarfile.DIRTYPE
                tf.addfile(entry)
            guide = tarfile.TarInfo(c.APP + '/Resources/A/guide')
            guide.size = len(b'guide fixture')
            tf.addfile(guide, io.BytesIO(b'guide fixture'))
            for name, target in [('shortcut', '../Resources/A'), ('guide', 'shortcut/../A/guide')]:
                entry = tarfile.TarInfo(c.APP + '/Contents/' + name)
                entry.type, entry.linkname = tarfile.SYMTYPE, target
                tf.addfile(entry)
        unpacked = c.safe_unpack(archive, self.root / 'safe-unpacked')
        self.assertEqual((unpacked / 'Contents/guide').read_bytes(), b'guide fixture')

    def test_link_cycle_is_refused_before_writes(self):
        archive = self.root / 'cycle.tar.gz'
        with tarfile.open(archive, 'w:gz') as tf:
            for name, target in [('a', 'b'), ('b', 'a')]:
                entry = tarfile.TarInfo(c.APP + '/' + name)
                entry.type, entry.linkname = tarfile.SYMTYPE, target
                tf.addfile(entry)
        destination = self.root / 'cycle-unpacked'
        with self.assertRaisesRegex(ValueError, 'Cyclic'):
            c.safe_unpack(archive, destination)
        self.assertFalse(destination.exists())


if __name__ == '__main__':
    unittest.main(verbosity=2)
