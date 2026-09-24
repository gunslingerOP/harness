'use strict';
// `harness canvas pull` — pulls the canvas package's on-device design-feedback kv rows into
// DIR/<screen>.jsonl. Generalised from an app repo's own scripts/feedback.ts (issue #6): bundle id
// and key prefix are read from the consuming project's own app.json / harness.config.json instead
// of being hardcoded, and the platform is iOS OR Android.
//
// THE FILE PULLED IS NOT the app's own database. The canvas route writes through
// `expo-sqlite/kv-store`'s default instance — `new SQLiteStorage('ExpoSQLiteStorage')`
// (node_modules/expo-sqlite/src/Storage.ts) — a different file from whatever the app's own
// Drizzle/SQLite client uses. NEVER opens the live file: it is copied out first (WAL/SHM sidecars
// included, so a row written seconds ago and not yet checkpointed is not missed), and
// better-sqlite3 reads the copy, read-only.
//
// iOS path (unchanged from the original script): `xcrun simctl get_app_container <SIM_UDID|
// booted> <bundleId> data`, then `<container>/Documents/SQLite/<db>[,-wal,-shm]` — verified from
// expo-sqlite's own source, ios/SQLiteModule.swift's `defaultDatabaseDirectory`
// (`documentDirectory/SQLite`).
//
// Android path (new): the app's INTERNAL files dir, not Documents — verified from expo-sqlite's
// own source, android/.../SQLiteModule.kt line 36: `context.filesDir.canonicalPath +
// File.separator + "SQLite"`. Pulled via `adb exec-out run-as <package> cat files/SQLite/<db>`,
// which requires a debuggable (dev/internal) build — the same limitation the iOS path already has
// implicitly (simctl only ever targets simulators, never a release build). See docs/canvas.md for
// the `adb shell run-as … + pull` fallback this does NOT implement, and why.
//
// Idempotent two ways, same as the original: PRINTING is gated by a cursor (`<dir>/.cursor`, the
// last `at` seen) — `--all` ignores it and reprints history. APPENDING to the .jsonl is gated
// separately, by `at` already present in that screen's file — so `--all` can reprint without ever
// duplicating a line.
//
// Every function here throws CanvasError on failure rather than calling process.exit — same
// pattern as lib/config.js's HarnessConfigMissing — so test/canvas-test.js can assert on the
// message without killing the test process. Only `run()`, the CLI entry point, catches and exits.
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const { load, HarnessConfigMissing } = require('./config');

class CanvasError extends Error {}

/** Runs `cmd args…`. `opts.encoding: null` returns Buffers (binary-safe) instead of a utf8
 *  string — used for the raw db pull, never for a status/listing command. Exposed as the default
 *  `sh` so tests can point PATH at a real fake `xcrun`/`adb` script instead of mocking this. */
function sh(cmd, args, opts = {}) {
  return spawnSync(cmd, args, { encoding: 'utf8', ...opts });
}

function errorText(r) {
  if (r.error) return r.error.message;
  const { stderr } = r;
  if (stderr && stderr.length) return (Buffer.isBuffer(stderr) ? stderr.toString('utf8') : String(stderr)).trim();
  return `exit ${r.status}`;
}

// ───────────────────────── platform + bundle id ─────────────────────────

function iosSimulatorBooted(shImpl) {
  const r = shImpl('xcrun', ['simctl', 'list', 'devices', 'booted']);
  return r.status === 0 && /\(Booted\)/.test(r.stdout || '');
}

function androidDeviceConnected(shImpl) {
  const r = shImpl('adb', ['devices', '-l']);
  if (r.status !== 0) return false;
  return connectedAndroidSerials(r.stdout || '').length > 0;
}

function connectedAndroidSerials(adbDevicesOutput) {
  return adbDevicesOutput
    .split('\n')
    .slice(1) // header line: "List of devices attached"
    .map((l) => l.trim())
    .filter((l) => l && /\bdevice\b/.test(l))
    .map((l) => l.split(/\s+/)[0]);
}

/** `--platform ios|android`, else auto-detect: exactly one of {a booted iOS simulator, a
 *  connected Android device} present picks it; both or neither is an error asking for the flag. */
function resolvePlatform(argv, env = process.env, shImpl = sh) {
  const i = argv.indexOf('--platform');
  if (i !== -1) {
    const p = argv[i + 1];
    if (p !== 'ios' && p !== 'android') throw new CanvasError(`--platform must be "ios" or "android", got ${JSON.stringify(p)}`);
    return p;
  }
  const ios = iosSimulatorBooted(shImpl);
  const android = androidDeviceConnected(shImpl);
  if (ios && !android) return 'ios';
  if (android && !ios) return 'android';
  if (ios && android) throw new CanvasError('both a booted iOS simulator and a connected Android device were found — pass --platform ios or --platform android.');
  throw new CanvasError('no booted iOS simulator and no connected Android device found — boot one, connect one, or pass --platform.');
}

/** Reads `expo.ios.bundleIdentifier` or `expo.android.package` from the project's app.json. */
function bundleId(appJsonPath, platform) {
  if (!fs.existsSync(appJsonPath)) throw new CanvasError(`No app.json at ${appJsonPath} — run this from an Expo project root.`);
  let app;
  try {
    app = JSON.parse(fs.readFileSync(appJsonPath, 'utf8'));
  } catch (e) {
    throw new CanvasError(`${appJsonPath} is not valid JSON: ${e.message}`);
  }
  if (platform === 'ios') {
    const id = app.expo?.ios?.bundleIdentifier;
    if (!id) throw new CanvasError('app.json has no expo.ios.bundleIdentifier — cannot resolve the simulator container.');
    return id;
  }
  const id = app.expo?.android?.package;
  if (!id) {
    throw new CanvasError(
      'app.json has no expo.android.package — cannot resolve the device package. Most Expo-managed ' +
        'apps do not set this until their first native/EAS build; that is expected on a fresh project, ' +
        'not a bug. Set it, then run this again.',
    );
  }
  return id;
}

// ───────────────────────── iOS: simulator container + copy ─────────────────────────

/** The simulator's data container for `id` — `booted`, unless `simUdid` names a specific device
 *  (two simulators booted at once otherwise makes "booted" ambiguous). */
function bootedIosContainer(id, simUdid, shImpl = sh) {
  const target = (simUdid || '').trim() || 'booted';
  const r = shImpl('xcrun', ['simctl', 'get_app_container', target, id, 'data']);
  if (r.status !== 0) {
    throw new CanvasError(
      `xcrun simctl could not find ${id}'s container on "${target}": ${errorText(r)}\n` +
        (target === 'booted'
          ? 'Boot a simulator and open the app on it at least once, or set SIM_UDID if more than one is booted.'
          : 'Check SIM_UDID and that the app is installed and has been opened on that device.'),
    );
  }
  return r.stdout.trim();
}

/** Copies the kv-store's file and its WAL/SHM sidecars (if present) into a scratch dir. The live
 *  database on the simulator is never opened directly. */
function copyIosKvStore(container, dbName) {
  const src = path.join(container, 'Documents', 'SQLite', dbName);
  if (!fs.existsSync(src)) throw new CanvasError(`No kv-store database at ${src} — open the app on the simulator at least once.`);
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-canvas-'));
  const file = path.join(dir, dbName);
  for (const suffix of ['', '-wal', '-shm']) {
    const from = `${src}${suffix}`;
    if (fs.existsSync(from)) fs.copyFileSync(from, `${file}${suffix}`);
  }
  return { dir, file };
}

// ───────────────────────── Android: device + run-as pull ─────────────────────────

/** `ANDROID_SERIAL` if set (honoured explicitly — passed as `-s <serial>` on every adb call
 *  rather than relying on adb's own env pickup, for testability and one consistent "ambiguous"
 *  message), else the sole connected device; more than one with no env var set is an error,
 *  mirroring the iOS "booted" ambiguity. */
function resolveAndroidSerial(env = process.env, shImpl = sh) {
  const explicit = env.ANDROID_SERIAL?.trim();
  if (explicit) return explicit;
  const r = shImpl('adb', ['devices', '-l']);
  if (r.status !== 0) throw new CanvasError(`adb devices failed: ${errorText(r)}`);
  const serials = connectedAndroidSerials(r.stdout || '');
  if (serials.length === 0) throw new CanvasError('No Android device or emulator connected (adb devices -l is empty). Connect one, or set ANDROID_SERIAL.');
  if (serials.length > 1) throw new CanvasError(`Multiple Android devices connected (${serials.join(', ')}) — set ANDROID_SERIAL to pick one.`);
  return serials[0];
}

/** Pulls `files/SQLite/<db>` (the app's internal files dir) off `serial` via
 *  `adb exec-out run-as <package> cat …`, stdout captured as a Buffer — no shell pipe, so it stays
 *  binary-safe. The `-wal`/`-shm` sidecars are attempted the same way; a non-zero exit on either of
 *  those two specifically means "sidecar absent" and is skipped, never a failure. A non-zero exit
 *  (or empty output) on the MAIN db file is a hard, actionable failure. */
function pullAndroidKvStore(pkg, dbName, serial, shImpl = sh) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'harness-canvas-'));
  const file = path.join(dir, dbName);
  const remote = `files/SQLite/${dbName}`;

  const main = shImpl('adb', ['-s', serial, 'exec-out', 'run-as', pkg, 'cat', remote], { encoding: null });
  if (main.status !== 0 || !main.stdout || main.stdout.length === 0) {
    throw new CanvasError(
      `adb exec-out run-as ${pkg} cat ${remote} failed on ${serial}: ${errorText(main)}\n` +
        'Two likely causes: the build is not debuggable (run-as requires a dev/internal build), or ' +
        'the app has never been opened on this device.',
    );
  }
  fs.writeFileSync(file, main.stdout);

  for (const suffix of ['-wal', '-shm']) {
    const r = shImpl('adb', ['-s', serial, 'exec-out', 'run-as', pkg, 'cat', `${remote}${suffix}`], { encoding: null });
    if (r.status === 0 && r.stdout && r.stdout.length > 0) fs.writeFileSync(`${file}${suffix}`, r.stdout);
    // non-zero / empty here just means the sidecar doesn't exist yet — not an error.
  }
  return { dir, file };
}

// ───────────────────────── shared: read, number, print, append ─────────────────────────

function readRows(dbFile, prefix) {
  let Database;
  try {
    Database = require('better-sqlite3');
  } catch {
    throw new CanvasError('better-sqlite3 is not installed — it is a peer dependency of `harness canvas pull`. `npm i -D better-sqlite3`.');
  }
  const db = new Database(dbFile, { readonly: true });
  try {
    const raw = db.prepare('SELECT key, value FROM storage WHERE key LIKE ? ORDER BY key ASC').all(`${prefix}%`);
    const rows = [];
    for (const { key, value } of raw) {
      try {
        rows.push({ key, entry: JSON.parse(value) });
      } catch {
        console.warn(`skipping unreadable row ${key}`);
      }
    }
    return rows;
  } catch (err) {
    throw new CanvasError(`Could not read the kv-store copy: ${err.message}`);
  } finally {
    db.close();
  }
}

/** Assigns each note row's pin a number, per (screen, variant), in the order pins first appear —
 *  `rows` is always the FULL history pulled this run (no LIMIT on the query), so numbering stays
 *  stable across runs regardless of which subset `printTable` ends up showing. A row whose pin id
 *  was already assigned a number is a later edit of that same pin. */
function buildPinInfo(rows) {
  const counts = new Map(); // `${screen}:${variant}` -> highest number so far
  const numbers = new Map(); // pin id -> its assigned number
  const info = new Map(); // row key -> { number, edit }
  for (const { key, entry } of rows) {
    if (entry.kind !== 'note' || !entry.pin) continue;
    const seen = numbers.get(entry.pin);
    if (seen !== undefined) {
      info.set(key, { number: seen, edit: true });
      continue;
    }
    const counterKey = `${entry.screen}:${entry.variant}`;
    const number = (counts.get(counterKey) ?? 0) + 1;
    counts.set(counterKey, number);
    numbers.set(entry.pin, number);
    info.set(key, { number, edit: false });
  }
  return info;
}

function printTable(rows, pinInfo, pullEverything) {
  if (rows.length === 0) {
    console.log(pullEverything ? 'No feedback recorded yet.' : 'Nothing new since the last pull.');
    return;
  }
  console.table(
    rows.map(({ key, entry }) => {
      const pin = entry.kind === 'note' ? pinInfo.get(key) : undefined;
      return {
        at: entry.at,
        screen: entry.screen,
        variant: entry.variant,
        kind: entry.kind,
        note: entry.kind === 'note' ? entry.note : '',
        pin: pin ? `pin #${pin.number}${pin.edit ? ' (edit)' : ''}` : '',
        x: entry.kind === 'note' && entry.x !== undefined ? entry.x.toFixed(3) : '',
        y: entry.kind === 'note' && entry.y !== undefined ? entry.y.toFixed(3) : '',
      };
    }),
  );
}

function readCursor(cursorFile) {
  return fs.existsSync(cursorFile) ? fs.readFileSync(cursorFile, 'utf8').trim() : '';
}

/** Appends only rows whose `at` is not already in that screen's .jsonl — the dedup that makes
 *  `--all` safe to run repeatedly. */
function appendToJsonl(rows, outDir) {
  const byScreen = new Map();
  for (const { entry } of rows) byScreen.set(entry.screen, [...(byScreen.get(entry.screen) ?? []), entry]);

  for (const [screen, entries] of byScreen) {
    const file = path.join(outDir, `${screen}.jsonl`);
    const existingAts = new Set();
    if (fs.existsSync(file)) {
      for (const line of fs.readFileSync(file, 'utf8').split('\n')) {
        if (!line.trim()) continue;
        try {
          existingAts.add(JSON.parse(line).at);
        } catch {
          // a corrupted line does not stop the pull
        }
      }
    }
    const fresh = entries.filter((e) => !existingAts.has(e.at));
    if (fresh.length === 0) continue;
    fs.appendFileSync(file, `${fresh.map((e) => JSON.stringify(e)).join('\n')}\n`);
  }
}

// ───────────────────────── CLI wiring ─────────────────────────

function flag(argv, name) {
  const i = argv.indexOf(`--${name}`);
  return i === -1 ? undefined : argv[i + 1];
}
const has = (argv, name) => argv.includes(`--${name}`);

/** Reads the top-level `canvas` key from .claude/harness.config.json if the project has one —
 *  `templates/expo.json` writes `canvas` as a sibling of `harness`, not nested under it, and this
 *  must match that shape or every knob documented in docs/canvas.md silently does nothing. Falls
 *  back to the same literal defaults `templates/expo.json` ships, so the command works with zero
 *  config. `opts` is passed straight through to `load()` (e.g. `{ root }` in tests). */
function canvasConfig(opts = {}) {
  try {
    return load(opts).config?.canvas ?? {};
  } catch (e) {
    if (e instanceof HarnessConfigMissing) return {};
    throw e;
  }
}

/** `harness init`'s per-key merge for the one config section canvas owns: adds the template's
 *  `canvas` key to an existing project config only if that key is missing, and never touches
 *  anything else — a project's customization of every other section survives a rerun. Matches
 *  docs/canvas.md's install step 3 exactly ("writes canvas.enabled: false … if that key is
 *  missing; leaves an already-present config alone"). Returns the (possibly unchanged) config
 *  object plus whether a merge happened, so the caller can log accordingly. */
function mergeCanvasKey(existingConfig, templateConfig) {
  if ('canvas' in existingConfig || !('canvas' in templateConfig)) return { config: existingConfig, added: false };
  return { config: { ...existingConfig, canvas: templateConfig.canvas }, added: true };
}

function pull(argv) {
  const cfg = canvasConfig();
  const prefix = flag(argv, 'prefix') ?? cfg.prefix ?? 'dev:feedback:';
  const dbName = flag(argv, 'db') ?? cfg.database ?? 'ExpoSQLiteStorage';
  const outDir = flag(argv, 'dir') ?? cfg.output_dir ?? '.design-work/feedback';
  const pullEverything = has(argv, 'all');
  const platform = resolvePlatform(argv);

  fs.mkdirSync(outDir, { recursive: true });
  const id = bundleId(path.join(process.cwd(), 'app.json'), platform);

  const pulled =
    platform === 'ios'
      ? copyIosKvStore(bootedIosContainer(id, process.env.SIM_UDID), dbName)
      : pullAndroidKvStore(id, dbName, resolveAndroidSerial());

  try {
    const rows = readRows(pulled.file, prefix);
    appendToJsonl(rows, outDir);
    const pinInfo = buildPinInfo(rows);
    const cursorFile = path.join(outDir, '.cursor');
    const cursor = readCursor(cursorFile);
    printTable(pullEverything ? rows : rows.filter((r) => r.entry.at > cursor), pinInfo, pullEverything);
    const newest = rows.at(-1)?.entry.at;
    if (newest) fs.writeFileSync(cursorFile, newest);
  } finally {
    fs.rmSync(pulled.dir, { recursive: true, force: true });
  }
}

/** Entry point dispatched from bin/harness.js: `harness canvas <argv>`. */
function run(argv) {
  if (argv[0] !== 'pull') {
    console.error(`harness canvas: unknown subcommand ${JSON.stringify(argv[0] ?? '')} — only "pull" exists.`);
    process.exit(1);
  }
  try {
    pull(argv.slice(1));
  } catch (e) {
    if (e instanceof CanvasError) {
      console.error(`harness canvas pull: ${e.message}`);
      process.exit(1);
    }
    throw e;
  }
}

module.exports = {
  CanvasError,
  sh,
  resolvePlatform,
  bundleId,
  bootedIosContainer,
  copyIosKvStore,
  resolveAndroidSerial,
  pullAndroidKvStore,
  readRows,
  buildPinInfo,
  printTable,
  appendToJsonl,
  readCursor,
  canvasConfig,
  mergeCanvasKey,
  pull,
  run,
};
