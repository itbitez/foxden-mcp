'use strict';

// Firefox discovery and FoxDen profile storage.

const fs = require('fs');
const os = require('os');
const path = require('path');

const kDefaultProfile = 'main';

// Top-level profile entries that are crash/telemetry/session leftovers or
// locks. They are useless in a copy or would confuse Firefox on startup.
const kSkipEntries = new Set([
  'parent.lock',
  'lock',
  '.parentlock',
  'user.js',
  'crashes',
  'minidumps',
  'datareporting',
  'saved-telemetry-pings',
  'sessionstore-backups',
  'sessionstore-logs',
  'sessionstore.jsonlz4',
  'sessionCheckpoints.json',
  'shader-cache',
  'startupCache',
  'cache2',
  'Telemetry.FailedProfileLocks.txt',
]);

function foxdenHome() {
  if (process.env.FOXDEN_HOME)
    return path.resolve(process.env.FOXDEN_HOME);
  if (process.platform === 'win32')
    return path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), 'AppData', 'Local'), 'FoxDen');
  if (process.platform === 'darwin')
    return path.join(os.homedir(), 'Library', 'Application Support', 'FoxDen');
  return path.join(process.env.XDG_DATA_HOME || path.join(os.homedir(), '.local', 'share'), 'foxden');
}

const profilesRoot = () => path.join(foxdenHome(), 'profiles');
const activeFile = () => path.join(foxdenHome(), 'active.json');

function firefoxDataDir() {
  if (process.platform === 'win32')
    return path.join(process.env.APPDATA || path.join(os.homedir(), 'AppData', 'Roaming'), 'Mozilla', 'Firefox');
  if (process.platform === 'darwin')
    return path.join(os.homedir(), 'Library', 'Application Support', 'Firefox');
  return path.join(os.homedir(), '.mozilla', 'firefox');
}

function findFirefoxExecutable() {
  if (process.env.FIREFOX_PATH)
    return fs.existsSync(process.env.FIREFOX_PATH) ? process.env.FIREFOX_PATH : undefined;
  const candidates = [];
  if (process.platform === 'win32') {
    for (const root of [process.env.PROGRAMFILES, process.env['PROGRAMFILES(X86)'], process.env.LOCALAPPDATA]) {
      if (root)
        candidates.push(path.join(root, 'Mozilla Firefox', 'firefox.exe'));
    }
  } else if (process.platform === 'darwin') {
    candidates.push('/Applications/Firefox.app/Contents/MacOS/firefox');
  } else {
    candidates.push('/usr/bin/firefox', '/usr/lib/firefox/firefox', '/snap/bin/firefox', '/opt/firefox/firefox');
  }
  return candidates.find(c => fs.existsSync(c));
}

/** Reads "Version=" from application.ini next to the executable, if present. */
function firefoxVersion(executable) {
  const dirs = [path.dirname(executable), path.join(path.dirname(executable), '..', 'Resources')];
  for (const dir of dirs) {
    try {
      const match = fs.readFileSync(path.join(dir, 'application.ini'), 'utf8').match(/^Version=(.+)$/m);
      if (match)
        return match[1].trim();
    } catch {
    }
  }
  return undefined;
}

function parseIni(text) {
  const sections = [];
  let current;
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith(';') || line.startsWith('#'))
      continue;
    const header = line.match(/^\[(.+)\]$/);
    if (header) {
      current = { name: header[1], values: {} };
      sections.push(current);
      continue;
    }
    const eq = line.indexOf('=');
    if (current && eq > 0)
      current.values[line.slice(0, eq)] = line.slice(eq + 1);
  }
  return sections;
}

/** Profiles of the user's own Firefox, as listed in profiles.ini. */
function listFirefoxProfiles() {
  const dataDir = firefoxDataDir();
  const iniPath = path.join(dataDir, 'profiles.ini');
  if (!fs.existsSync(iniPath))
    return [];
  const sections = parseIni(fs.readFileSync(iniPath, 'utf8'));
  const installDefaults = new Set(sections.filter(s => s.name.startsWith('Install')).map(s => s.values.Default));
  return sections.filter(s => /^Profile\d+$/.test(s.name) && s.values.Path).map(s => {
    const relative = s.values.IsRelative === '1';
    const dir = relative ? path.join(dataDir, ...s.values.Path.split('/')) : s.values.Path;
    return {
      name: s.values.Name || path.basename(dir),
      dir,
      // The profile Firefox actually opens is the [Install...] default; Default=1 is the legacy marker.
      isDefault: installDefaults.has(s.values.Path) || (installDefaults.size === 0 && s.values.Default === '1'),
    };
  });
}

function validateName(name) {
  if (!/^[\w.-]+$/.test(name) || name === '.' || name === '..')
    throw new Error(`Invalid profile name "${name}". Use letters, digits, "-", "_" or ".".`);
  return name;
}

const profileDir = name => path.join(profilesRoot(), validateName(name));

function listProfiles() {
  if (!fs.existsSync(profilesRoot()))
    return [];
  return fs.readdirSync(profilesRoot(), { withFileTypes: true })
      .filter(e => e.isDirectory())
      .map(e => ({ name: e.name, dir: path.join(profilesRoot(), e.name) }));
}

function readActiveProfile() {
  try {
    return JSON.parse(fs.readFileSync(activeFile(), 'utf8')).profile || undefined;
  } catch {
    return undefined;
  }
}

function writeActiveProfile(name) {
  fs.mkdirSync(foxdenHome(), { recursive: true });
  fs.writeFileSync(activeFile(), JSON.stringify({ profile: validateName(name) }, null, 2) + '\n');
}

function clearActiveProfile() {
  fs.rmSync(activeFile(), { force: true });
}

const resolveProfileName = explicit => explicit || process.env.FOXDEN_PROFILE || readActiveProfile() || kDefaultProfile;

/** True when a running Firefox holds this profile's lock. */
function isProfileInUse(dir) {
  if (process.platform === 'win32') {
    const lockFile = path.join(dir, 'parent.lock');
    if (!fs.existsSync(lockFile))
      return false;
    try {
      fs.closeSync(fs.openSync(lockFile, 'r+'));
      return false;
    } catch (e) {
      return e.code === 'EBUSY' || e.code === 'EPERM';
    }
  }
  // On macOS/Linux "lock" is a symlink to "<ip>:+<pid>" while Firefox runs.
  try {
    const target = fs.readlinkSync(path.join(dir, 'lock'));
    const pid = Number(target.split('+').pop());
    if (!pid)
      return false;
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

/** Copies a Firefox profile, returning the entries that could not be read. */
function copyProfile(source, target, { light = false } = {}) {
  const skipped = [];
  const copyDir = (from, to, depth) => {
    fs.mkdirSync(to, { recursive: true });
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      if (depth === 0 && kSkipEntries.has(entry.name))
        continue;
      if (depth === 0 && light && entry.name === 'storage')
        continue;
      // SQLite shared-memory index is rebuilt from the -wal file on open.
      if (entry.name.endsWith('.sqlite-shm'))
        continue;
      const src = path.join(from, entry.name);
      const dst = path.join(to, entry.name);
      try {
        if (entry.isDirectory())
          copyDir(src, dst, depth + 1);
        else if (entry.isFile())
          fs.copyFileSync(src, dst);
      } catch (e) {
        skipped.push(`${path.relative(source, src)} (${e.code || e.message})`);
      }
    }
  };
  copyDir(source, target, 0);
  return skipped;
}

module.exports = {
  kDefaultProfile,
  foxdenHome,
  profilesRoot,
  firefoxDataDir,
  findFirefoxExecutable,
  firefoxVersion,
  listFirefoxProfiles,
  listProfiles,
  profileDir,
  validateName,
  readActiveProfile,
  writeActiveProfile,
  clearActiveProfile,
  resolveProfileName,
  isProfileInUse,
  copyProfile,
};
