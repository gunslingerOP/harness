'use strict';
// canvas/pins.js is pure logic — real hand-built entry arrays, no fixtures needed. lib/canvas.js's
// device paths are exercised against REAL executables: a fake `xcrun`/`adb` shell script, written
// to a temp dir and prepended to PATH so the module's own unmodified `spawnSync` calls hit it —
// same "real temp files, no mocks" style as test/harness-test.js. Everything else (readRows,
// buildPinInfo, appendToJsonl, cursor) runs against a real better-sqlite3 file and real .jsonl
// files on disk.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const Database = require('better-sqlite3');

const { deriveInitial } = require('../canvas/pins');
const canvas = require('../lib/canvas');

function tmpDir(prefix) {
  return fs.mkdtempSync(path.join(os.tmpdir(), prefix));
}

/** Writes a real, executable fake `xcrun` or `adb` to `dir`. `body` is POSIX shell. */
function fakeBin(dir, name, body) {
  const p = path.join(dir, name);
  fs.writeFileSync(p, `#!/bin/sh\n${body}\n`);
  fs.chmodSync(p, 0o755);
}

/** Runs `fn()` with `dir` prepended to PATH, so lib/canvas.js's own (un-mocked) `spawnSync` calls
 *  resolve the fake binary first. Restores PATH afterward even if `fn` throws. */
function withFakeBinOnPath(dir, fn) {
  const original = process.env.PATH;
  process.env.PATH = `${dir}:${original}`;
  try {
    return fn();
  } finally {
    process.env.PATH = original;
  }
}

// ═══════════════════════════ canvas/pins.js — pure replay logic ═══════════════════════════

test('deriveInitial: numbers pins per (screen-implicit) variant, in first-seen order', () => {
  const entries = [
    { screen: 's', variant: 'A', kind: 'note', note: 'first', pin: 'p1', x: 0.1, y: 0.2, at: '2026-01-01T00:00:00.000Z' },
    { screen: 's', variant: 'A', kind: 'note', note: 'second', pin: 'p2', x: 0.3, y: 0.4, at: '2026-01-01T00:00:01.000Z' },
    { screen: 's', variant: 'B', kind: 'note', note: 'other variant', pin: 'p3', x: 0.5, y: 0.6, at: '2026-01-01T00:00:02.000Z' },
  ];
  const { pins } = deriveInitial(entries);
  assert.equal(pins.length, 3);
  assert.equal(pins.find((p) => p.id === 'p1').number, 1);
  assert.equal(pins.find((p) => p.id === 'p2').number, 2);
  assert.equal(pins.find((p) => p.id === 'p3').number, 1); // its own variant restarts the sequence
});

test('deriveInitial: a later entry sharing a pin id is an edit — replaces the note, keeps the number', () => {
  const entries = [
    { screen: 's', variant: 'A', kind: 'note', note: 'first', pin: 'p1', x: 0, y: 0, at: '2026-01-01T00:00:00.000Z' },
    { screen: 's', variant: 'A', kind: 'note', note: 'edited', pin: 'p1', x: 0, y: 0, at: '2026-01-01T00:00:05.000Z' },
  ];
  const { pins } = deriveInitial(entries);
  assert.equal(pins.length, 1);
  assert.equal(pins[0].note, 'edited');
  assert.equal(pins[0].number, 1);
});

test('deriveInitial: a pick with no pin counts toward `picked`, never toward `pins`', () => {
  const entries = [{ screen: 's', variant: 'C', kind: 'pick', at: '2026-01-01T00:00:00.000Z' }];
  const { pins, picked } = deriveInitial(entries);
  assert.deepEqual(pins, []);
  assert.deepEqual(picked, ['C']);
});

test('deriveInitial: legacy note entries with no `pin` field are ignored for pins (pre-2026-09-24 shape)', () => {
  const entries = [{ screen: 's', variant: 'A', kind: 'note', note: 'old style, no pin field', at: '2026-01-01T00:00:00.000Z' }];
  const { pins, picked } = deriveInitial(entries);
  assert.deepEqual(pins, []);
  assert.deepEqual(picked, []);
});

// ═══════════════════════════ lib/canvas.js — pure helpers, real files, no device ═══════════════════════════

test('bundleId: reads expo.ios.bundleIdentifier and expo.android.package', () => {
  const dir = tmpDir('canvas-appjson-');
  const appJson = path.join(dir, 'app.json');
  fs.writeFileSync(appJson, JSON.stringify({ expo: { ios: { bundleIdentifier: 'com.example.app' }, android: { package: 'com.example.app' } } }));
  assert.equal(canvas.bundleId(appJson, 'ios'), 'com.example.app');
  assert.equal(canvas.bundleId(appJson, 'android'), 'com.example.app');
  fs.rmSync(dir, { recursive: true, force: true });
});

test('bundleId: throws CanvasError with an actionable message when app.json is missing a required field', () => {
  const dir = tmpDir('canvas-appjson-');
  const appJson = path.join(dir, 'app.json');
  fs.writeFileSync(appJson, JSON.stringify({ expo: { ios: { bundleIdentifier: 'com.example.app' } } }));
  assert.throws(
    () => canvas.bundleId(appJson, 'android'),
    (e) => e instanceof canvas.CanvasError && /expo\.android\.package/.test(e.message) && /first native\/EAS build/.test(e.message),
  );
  fs.rmSync(dir, { recursive: true, force: true });
});

test('resolvePlatform: an explicit --platform wins outright; an invalid value is refused', () => {
  assert.equal(canvas.resolvePlatform(['--platform', 'ios']), 'ios');
  assert.equal(canvas.resolvePlatform(['--platform', 'android']), 'android');
  assert.throws(() => canvas.resolvePlatform(['--platform', 'blackberry']), canvas.CanvasError);
});

test('readRows + buildPinInfo + appendToJsonl + readCursor: real sqlite file, real jsonl round trip', () => {
  const dbDir = tmpDir('canvas-db-');
  const dbFile = path.join(dbDir, 'ExpoSQLiteStorage');
  const db = new Database(dbFile);
  db.exec('CREATE TABLE storage (key TEXT PRIMARY KEY NOT NULL, value TEXT)');
  const rows = [
    { key: 'dev:feedback:2026-01-01T00:00:00.000Z', entry: { screen: 'today', variant: 'A', kind: 'note', note: 'n1', pin: 'p1', x: 0.1, y: 0.2, at: '2026-01-01T00:00:00.000Z' } },
    { key: 'dev:feedback:2026-01-01T00:00:01.000Z', entry: { screen: 'today', variant: 'A', kind: 'note', note: 'n1 edited', pin: 'p1', x: 0.1, y: 0.2, at: '2026-01-01T00:00:01.000Z' } },
    { key: 'dev:feedback:2026-01-01T00:00:02.000Z', entry: { screen: 'today', variant: 'B', kind: 'pick', at: '2026-01-01T00:00:02.000Z' } },
    // a differently-prefixed key must never be pulled in
    { key: 'other:key', entry: { unrelated: true } },
  ];
  const insert = db.prepare('INSERT INTO storage (key, value) VALUES (?, ?)');
  for (const r of rows) insert.run(r.key, JSON.stringify(r.entry));
  db.close();

  const read = canvas.readRows(dbFile, 'dev:feedback:');
  assert.equal(read.length, 3);

  const pinInfo = canvas.buildPinInfo(read);
  assert.deepEqual(pinInfo.get(rows[0].key), { number: 1, edit: false });
  assert.deepEqual(pinInfo.get(rows[1].key), { number: 1, edit: true });

  const outDir = tmpDir('canvas-out-');
  canvas.appendToJsonl(read, outDir);
  const jsonlPath = path.join(outDir, 'today.jsonl');
  assert.ok(fs.existsSync(jsonlPath));
  assert.equal(fs.readFileSync(jsonlPath, 'utf8').trim().split('\n').length, 3);

  // idempotent: appending the same rows again (as `--all` does) writes nothing new
  canvas.appendToJsonl(read, outDir);
  assert.equal(fs.readFileSync(jsonlPath, 'utf8').trim().split('\n').length, 3);

  const cursorFile = path.join(outDir, '.cursor');
  assert.equal(canvas.readCursor(cursorFile), '');
  fs.writeFileSync(cursorFile, '2026-01-01T00:00:01.000Z');
  assert.equal(canvas.readCursor(cursorFile), '2026-01-01T00:00:01.000Z');

  fs.rmSync(dbDir, { recursive: true, force: true });
  fs.rmSync(outDir, { recursive: true, force: true });
});

// ═══════════════════════════ lib/canvas.js — device paths, real fake xcrun/adb on PATH ═══════════════════════════

test('bootedIosContainer: happy path against a real fake xcrun on PATH', () => {
  const bin = tmpDir('canvas-bin-');
  fakeBin(
    bin,
    'xcrun',
    [
      'if [ "$1" = simctl ] && [ "$2" = get_app_container ]; then',
      '  if [ "$4" = com.example.app ]; then echo "/fake/container"; exit 0; fi',
      'fi',
      'echo "no matching device" >&2',
      'exit 1',
    ].join('\n'),
  );
  withFakeBinOnPath(bin, () => {
    assert.equal(canvas.bootedIosContainer('com.example.app', undefined), '/fake/container');
    assert.equal(canvas.bootedIosContainer('com.example.app', 'SOME-UDID'), '/fake/container');
  });
  fs.rmSync(bin, { recursive: true, force: true });
});

test('bootedIosContainer: xcrun failing is a CanvasError naming the target', () => {
  const bin = tmpDir('canvas-bin-');
  fakeBin(bin, 'xcrun', 'echo "Unable to boot device" >&2\nexit 1');
  withFakeBinOnPath(bin, () => {
    assert.throws(
      () => canvas.bootedIosContainer('com.example.app', undefined),
      (e) => e instanceof canvas.CanvasError && /booted/.test(e.message) && /Unable to boot device/.test(e.message),
    );
  });
  fs.rmSync(bin, { recursive: true, force: true });
});

test('resolveAndroidSerial: a single connected device resolves; more than one is an ambiguous failure', () => {
  const bin = tmpDir('canvas-bin-');
  fakeBin(bin, 'adb', 'echo "List of devices attached"\necho "$FAKE_ADB_DEVICES"\n');

  withFakeBinOnPath(bin, () => {
    process.env.FAKE_ADB_DEVICES = 'emulator-5554\tdevice product:sdk_gphone model:sdk';
    delete process.env.ANDROID_SERIAL;
    assert.equal(canvas.resolveAndroidSerial(process.env), 'emulator-5554');

    process.env.FAKE_ADB_DEVICES = 'emulator-5554\tdevice product:a\nRF8N9\tdevice product:b';
    assert.throws(
      () => canvas.resolveAndroidSerial(process.env),
      (e) => e instanceof canvas.CanvasError && /Multiple Android devices/.test(e.message) && /ANDROID_SERIAL/.test(e.message),
    );

    process.env.ANDROID_SERIAL = 'RF8N9';
    assert.equal(canvas.resolveAndroidSerial(process.env), 'RF8N9'); // explicit env wins over listing
    delete process.env.FAKE_ADB_DEVICES;
    delete process.env.ANDROID_SERIAL;
  });
  fs.rmSync(bin, { recursive: true, force: true });
});

test('pullAndroidKvStore: happy path via run-as, sidecar files absent are skipped, not a failure', () => {
  const bin = tmpDir('canvas-bin-');
  const fixtures = tmpDir('canvas-fixtures-');
  const mainFixture = path.join(fixtures, 'main.db');
  fs.writeFileSync(mainFixture, Buffer.from([0x53, 0x51, 0x4c, 0x69, 0x74, 0x65, 0x00, 0x01, 0x02])); // a few binary-ish bytes
  fakeBin(
    bin,
    'adb',
    [
      '# args: -s <serial> exec-out run-as <pkg> cat <remote>',
      'serial="$2"; pkg="$5"; remote="$7"',
      `if [ "$remote" = "files/SQLite/ExpoSQLiteStorage" ] && [ "$pkg" = "com.example.app" ] && [ "$serial" = "emulator-5554" ]; then`,
      `  cat "${mainFixture}"`,
      '  exit 0',
      'fi',
      '# -wal / -shm: no sidecar files exist for this fixture — fail, as run-as would for a missing file',
      'echo "run-as: file not found" >&2',
      'exit 1',
    ].join('\n'),
  );
  withFakeBinOnPath(bin, () => {
    const { dir, file } = canvas.pullAndroidKvStore('com.example.app', 'ExpoSQLiteStorage', 'emulator-5554');
    assert.ok(fs.existsSync(file));
    assert.deepEqual(fs.readFileSync(file), fs.readFileSync(mainFixture));
    assert.ok(!fs.existsSync(`${file}-wal`), 'a genuinely absent sidecar must be skipped, not written empty');
    assert.ok(!fs.existsSync(`${file}-shm`));
    fs.rmSync(dir, { recursive: true, force: true });
  });
  fs.rmSync(bin, { recursive: true, force: true });
  fs.rmSync(fixtures, { recursive: true, force: true });
});

test('pullAndroidKvStore: run-as failing on the MAIN db file is a hard, actionable CanvasError', () => {
  const bin = tmpDir('canvas-bin-');
  fakeBin(bin, 'adb', 'echo "run-as: package not debuggable" >&2\nexit 1\n');
  withFakeBinOnPath(bin, () => {
    assert.throws(
      () => canvas.pullAndroidKvStore('com.example.app', 'ExpoSQLiteStorage', 'emulator-5554'),
      (e) => e instanceof canvas.CanvasError && /not debuggable/.test(e.message) && /dev\/internal build/.test(e.message),
    );
  });
  fs.rmSync(bin, { recursive: true, force: true });
});

// ═══════════════════════════ lib/canvas.js — canvasConfig against a REAL config file ═══════════════════════════
// Regression for the fix round on PR #7: canvasConfig() read `config.harness.canvas`, but
// templates/expo.json (and docs/canvas.md's own JSON snippet) write `canvas` as a TOP-LEVEL key,
// sibling to `harness` — so every `harness canvas pull` default a project set was silently
// ignored. This writes a real .claude/harness.config.json in the shape the template actually
// ships and asserts canvasConfig() reads it back, the way `harness canvas pull` really would.

// Minimal config satisfying lib/config.js's REQUIRED sections, so `load()` accepts it as valid —
// plus the top-level `canvas` key, exactly as templates/expo.json writes it.
function validConfigWithCanvas(canvasSection) {
  return {
    harness: { version: '0.2.4', stack: 'expo', project: 'p' },
    repo: { main_branch: 'main', protected_branches: ['main'] },
    layout: {
      top_dirs: [],
      root_files: [],
      organized_dirs: [],
      source_extensions: ['.ts'],
      test_markers: ['.test.'],
    },
    safety: { deny_patterns: [] },
    ...(canvasSection !== undefined ? { canvas: canvasSection } : {}),
  };
}

function writeConfig(root, config) {
  const dir = path.join(root, '.claude');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, 'harness.config.json'), JSON.stringify(config));
}

test('canvasConfig: reads the top-level `canvas` key from a real config file (not nested under harness)', () => {
  const root = tmpDir('canvas-cfg-');
  const canvasSection = { prefix: 'custom:prefix:', database: 'CustomDb', output_dir: 'custom/dir' };
  writeConfig(root, validConfigWithCanvas(canvasSection));
  assert.deepEqual(canvas.canvasConfig({ root }), canvasSection);
  fs.rmSync(root, { recursive: true, force: true });
});

test('canvasConfig: no `canvas` key in an otherwise-valid config falls back to {}, not an error', () => {
  const root = tmpDir('canvas-cfg-');
  writeConfig(root, validConfigWithCanvas(undefined));
  assert.deepEqual(canvas.canvasConfig({ root }), {});
  fs.rmSync(root, { recursive: true, force: true });
});

test('canvasConfig: no config file at all falls back to {}, same as HarnessConfigMissing everywhere else', () => {
  const root = tmpDir('canvas-cfg-'); // no .claude/harness.config.json written
  assert.deepEqual(canvas.canvasConfig({ root }), {});
  fs.rmSync(root, { recursive: true, force: true });
});

// ═══════════════════════════ lib/canvas.js — mergeCanvasKey, `harness init`'s per-key merge ═══════════════════════════
// Regression for PR #7: `harness init` was a whole-file no-op once .claude/harness.config.json
// existed — contradicting docs/canvas.md's own claim ("writes canvas.enabled: false … if that key
// is missing; leaves an already-present config alone"). mergeCanvasKey is the extracted, pure
// piece of that per-key merge, so it's testable without shelling out to the real CLI (which also
// registers the project as a consumer via `gh issue` — not something a test should trigger).

test('mergeCanvasKey: adds the template canvas key when the project config lacks one, touching nothing else', () => {
  const existing = { harness: { stack: 'expo' }, repo: { main_branch: 'main' }, someCustomKey: 'keep-me' };
  const tpl = { harness: { stack: 'expo' }, canvas: { enabled: false, prefix: 'dev:feedback:' } };
  const { config, added } = canvas.mergeCanvasKey(existing, tpl);
  assert.equal(added, true);
  assert.deepEqual(config.canvas, tpl.canvas);
  assert.equal(config.someCustomKey, 'keep-me'); // nothing else touched
  assert.equal(existing.canvas, undefined); // the input object itself is not mutated
});

test('mergeCanvasKey: an already-present canvas key (even a customized one) is left alone', () => {
  const existing = { harness: { stack: 'expo' }, canvas: { enabled: true, prefix: 'my:own:prefix:' } };
  const tpl = { harness: { stack: 'expo' }, canvas: { enabled: false, prefix: 'dev:feedback:' } };
  const { config, added } = canvas.mergeCanvasKey(existing, tpl);
  assert.equal(added, false);
  assert.deepEqual(config, existing); // unchanged, including the customization
});

test('mergeCanvasKey: a template with no canvas key (next.json, node.json) is a no-op', () => {
  const existing = { harness: { stack: 'node' } };
  const tpl = { harness: { stack: 'node' } }; // no canvas section, same as templates/node.json
  const { config, added } = canvas.mergeCanvasKey(existing, tpl);
  assert.equal(added, false);
  assert.deepEqual(config, existing);
});
