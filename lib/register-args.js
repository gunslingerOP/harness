'use strict';
// REGISTER'S CLI SURFACE — pure helpers for `harness register`: which project an event belongs to
// (the attribution precedence), the `--project` filter built on that same precedence, and argv
// parsing. None of this reads the OTLP wire format, so it does not belong in guards/register.js —
// split out so that guard stays a thin reader/renderer and this policy-free parsing logic lives in
// lib/ next to ground.js, rework.js and session.js.
//
// Born from: the ~24 lines these three functions added to guards/register.js pushed
// guard_max_lines from 220 to 230 in test/budget.json — real functionality, but the wrong home; a
// budget bump to fit argv parsing and project filtering, which have nothing to do with reading an
// OTLP request apart from consuming its output.

/** PRECEDENCE: the OTel resource attribute `harness init` writes wins; a literal `project` log
 *  attribute next; then the label `lib/session.js#projectIndex` derives from the session's own
 *  transcript path (covers sessions older than `init`, or run before the env var existed);
 *  `(unknown)` only when none of those exist. `sessionProjects` is passed in, not read here, so
 *  this stays pure and testable. */
function projectOf(e, sessionProjects = new Map()) {
  const a = e.attrs;
  return e.resource.project ?? a['project'] ?? (a['session.id'] && sessionProjects.get(a['session.id'])) ?? '(unknown)';
}

/** What `--project` filters on. Pure so the CLI and the tests call the same code. */
function filterByProject(evs, project, sessionProjects = new Map()) {
  return project ? evs.filter((e) => projectOf(e, sessionProjects) === project) : evs;
}

/** `--days=30`/`--days 30`/`--project X` — pure over argv, so a test can hand it any slice. */
function parseArgs(argv) {
  const val = (name) => {
    const eq = argv.find((a) => a.startsWith(`--${name}=`));
    if (eq) return eq.slice(name.length + 3);
    const i = argv.indexOf(`--${name}`);
    return i === -1 ? undefined : argv[i + 1];
  };
  return { days: Number(val('days') ?? 14), project: val('project'), json: argv.includes('--json') };
}

module.exports = { projectOf, filterByProject, parseArgs };
