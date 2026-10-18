#!/usr/bin/env node
'use strict';

const fs = require('fs');
const path = require('path');
const { spawn } = require('child_process');
const profiles = require('../lib/profiles');

const kUsage = `
FoxDen - manage the Firefox profiles that FoxDen MCP drives.

Usage: foxden <command> [options]

  list                                 Show your Firefox profiles and FoxDen profiles
  clone [firefox-profile] [--as name]  Copy a Firefox profile (default: your main one) into FoxDen
        [--light]                      ...skipping site storage, keeping cookies and passwords
  new <name>                           Create an empty profile, e.g. for a second account
  login [name] [url...]                Open a normal Firefox window with a profile to sign in by hand
  use <name>                           Make <name> the profile FoxDen MCP uses
  remove <name>                        Delete a FoxDen profile
  doctor                               Check that everything is ready to launch
  setup [name]                         Print the MCP client config

Profiles are stored in: ${profiles.profilesRoot()}
`;

function fail(message) {
  console.error(`\nError: ${message}\n`);
  process.exit(1);
}

function takeOption(args, name) {
  const index = args.indexOf(name);
  if (index === -1)
    return undefined;
  const value = args[index + 1];
  if (!value)
    fail(`${name} needs a value.`);
  args.splice(index, 2);
  return value;
}

function takeFlag(args, name) {
  const index = args.indexOf(name);
  if (index === -1)
    return false;
  args.splice(index, 1);
  return true;
}

function existingProfileDir(name) {
  const dir = profiles.profileDir(name);
  if (!fs.existsSync(dir))
    fail(`Profile "${name}" does not exist. Create it with "foxden clone --as ${name}" or "foxden new ${name}".`);
  return dir;
}

function cmdList() {
  const active = profiles.resolveProfileName();
  console.log('\nYour Firefox profiles (sources for "foxden clone", * = default):');
  const firefoxProfiles = profiles.listFirefoxProfiles();
  if (!firefoxProfiles.length)
    console.log('  (none found)');
  for (const p of firefoxProfiles)
    console.log(`  ${p.isDefault ? '*' : ' '} ${p.name.padEnd(20)} ${profiles.isProfileInUse(p.dir) ? '[open in Firefox] ' : ''}${p.dir}`);

  console.log('\nFoxDen profiles (* = active):');
  const own = profiles.listProfiles();
  if (!own.length)
    console.log('  (none yet - run "foxden clone")');
  for (const p of own)
    console.log(`  ${p.name === active ? '*' : ' '} ${p.name.padEnd(20)} ${profiles.isProfileInUse(p.dir) ? '[in use] ' : ''}${p.dir}`);
  console.log('');
}

function cmdClone(args) {
  const name = profiles.validateName(takeOption(args, '--as') || profiles.kDefaultProfile);
  const light = takeFlag(args, '--light');
  const sourceName = args[0];
  const firefoxProfiles = profiles.listFirefoxProfiles();
  const source = sourceName
    ? firefoxProfiles.find(p => p.name === sourceName || path.basename(p.dir) === sourceName)
    : firefoxProfiles.find(p => p.isDefault) || firefoxProfiles[0];
  if (!source)
    fail(sourceName ? `Firefox profile "${sourceName}" not found. Run "foxden list".` : 'No Firefox profiles found. Open Firefox once to create one.');

  const target = profiles.profileDir(name);
  if (profiles.isProfileInUse(target))
    fail(`Profile "${name}" is in use. Close the FoxDen Firefox window first (or ask the agent to close the browser).`);
  if (profiles.isProfileInUse(source.dir)) {
    console.log(`\nNote: Firefox is running with "${source.name}". The copy will work, but for a perfectly`);
    console.log('consistent snapshot of cookies and passwords, close Firefox and run clone again.');
  }

  console.log(`\nCloning Firefox profile "${source.name}"\n  from ${source.dir}\n  to   ${target}${light ? '\n  (light: skipping site storage)' : ''}`);
  const staging = `${target}.cloning`;
  fs.rmSync(staging, { recursive: true, force: true });
  const skipped = profiles.copyProfile(source.dir, staging, { light });
  // Swap in only after a complete copy, so a failed clone never leaves a half profile behind.
  fs.rmSync(target, { recursive: true, force: true });
  fs.renameSync(staging, target);
  if (skipped.length)
    console.log(`\nSkipped ${skipped.length} file(s) that could not be read:\n  ${skipped.slice(0, 10).join('\n  ')}`);

  if (!profiles.readActiveProfile())
    profiles.writeActiveProfile(name);
  console.log(`\nDone. Profile "${name}" has your cookies, saved passwords, bookmarks and extensions.`);
  console.log('Your real Firefox profile was not modified. Run this again any time to refresh the copy.\n');
}

function cmdNew(args) {
  const name = args[0];
  if (!name)
    fail('Usage: foxden new <name>');
  const dir = profiles.profileDir(name);
  if (fs.existsSync(dir))
    fail(`Profile "${name}" already exists.`);
  fs.mkdirSync(dir, { recursive: true });
  if (!profiles.readActiveProfile())
    profiles.writeActiveProfile(name);
  console.log(`\nCreated empty profile "${name}" at ${dir}`);
  console.log(`Sign in to your sites with: foxden login ${name}\n`);
}

function cmdLogin(args) {
  const name = args[0] && !/^[a-z]+:/i.test(args[0]) ? args.shift() : profiles.resolveProfileName();
  const dir = existingProfileDir(name);
  if (profiles.isProfileInUse(dir))
    fail(`Profile "${name}" is already open (probably by FoxDen MCP). Close that window first, or ask the agent to close the browser.`);
  const executable = profiles.findFirefoxExecutable();
  if (!executable)
    fail('Firefox was not found. Install Firefox or set FIREFOX_PATH.');

  // Playwright's automation prefs live in user.js; drop it so this window behaves like normal Firefox.
  fs.rmSync(path.join(dir, 'user.js'), { force: true });
  console.log(`\nOpening a normal Firefox window with profile "${name}".`);
  console.log('Sign in to any sites you need, then close the window. The logins are saved to this profile');
  console.log('and FoxDen MCP uses them the next time it opens the browser.\n');
  const child = spawn(executable, ['-profile', dir, '-no-remote', '-new-instance', ...args], { stdio: 'ignore', detached: true });
  child.on('error', e => fail(e.message));
  child.unref();

  // On Windows firefox.exe hands off to a child process and exits right away,
  // so watch the profile lock instead of the spawned process.
  let seenOpen = false;
  const startedAt = Date.now();
  const timer = setInterval(() => {
    const open = profiles.isProfileInUse(dir);
    if (open)
      seenOpen = true;
    if (seenOpen && !open) {
      clearInterval(timer);
      console.log(`Firefox closed. Profile "${name}" saved.\n`);
    } else if (!seenOpen && Date.now() - startedAt > 30000) {
      clearInterval(timer);
      console.log('Firefox did not seem to start. Check that no other window is using this profile.\n');
    }
  }, 1000);
}

function cmdUse(args) {
  const name = args[0];
  if (!name)
    fail('Usage: foxden use <name>');
  existingProfileDir(name);
  profiles.writeActiveProfile(name);
  console.log(`\nActive profile is now "${name}". Restart the MCP server (or ask the agent to close the browser) to switch.\n`);
}

function cmdRemove(args) {
  const name = args[0];
  if (!name)
    fail('Usage: foxden remove <name>');
  const dir = existingProfileDir(name);
  if (profiles.isProfileInUse(dir))
    fail(`Profile "${name}" is in use. Close it first.`);
  fs.rmSync(dir, { recursive: true, force: true });
  if (profiles.readActiveProfile() === name)
    profiles.clearActiveProfile();
  console.log(`\nRemoved profile "${name}". Your real Firefox profile is untouched.\n`);
}

function cmdDoctor() {
  let problems = 0;
  const ok = message => console.log(`  OK    ${message}`);
  const bad = (message, hint) => {
    problems++;
    console.log(`  FAIL  ${message}${hint ? `\n        -> ${hint}` : ''}`);
  };
  console.log('\nFoxDen doctor\n');

  const nodeMajor = Number(process.versions.node.split('.')[0]);
  nodeMajor >= 18 ? ok(`Node.js ${process.versions.node}`) : bad(`Node.js ${process.versions.node}`, 'Install Node.js 18 or newer.');

  try {
    const pkg = require('@playwright/mcp/package.json');
    ok(`Playwright MCP ${pkg.version}`);
  } catch {
    bad('Playwright MCP is not installed', 'Run "npm install" in the FoxDen folder.');
  }

  const executable = profiles.findFirefoxExecutable();
  if (executable) {
    const version = profiles.firefoxVersion(executable);
    const major = Number((version || '').split('.')[0]);
    if (version && major < 135)
      bad(`Firefox ${version} at ${executable}`, 'Update Firefox. Automation over WebDriver BiDi needs a recent version.');
    else
      ok(`Firefox ${version || '(version unknown)'} at ${executable}`);
  } else {
    bad('Firefox not found', 'Install Firefox or set FIREFOX_PATH to the firefox executable.');
  }

  const name = profiles.resolveProfileName();
  const dir = profiles.profileDir(name);
  if (!fs.existsSync(dir))
    bad(`Active profile "${name}" does not exist yet`, 'Run "foxden clone" (copy your Firefox logins) or "foxden new main".');
  else if (profiles.isProfileInUse(dir))
    bad(`Active profile "${name}" is open in another window`, 'Close that Firefox window before the agent uses the browser.');
  else
    ok(`Active profile "${name}" at ${dir}`);

  console.log(problems ? `\n${problems} problem(s) found.\n` : '\nEverything is ready.\n');
  process.exitCode = problems ? 1 : 0;
}

function cmdSetup(args) {
  const server = path.resolve(__dirname, 'foxden-mcp.js');
  const extra = args[0] ? ['--profile', profiles.validateName(args[0])] : [];
  const serverConfig = { command: 'node', args: [server, ...extra] };
  console.log('\nAdd this to your MCP client config (Claude Desktop: claude_desktop_config.json):\n');
  console.log(JSON.stringify({ mcpServers: { foxden: serverConfig } }, null, 2));
  console.log('\nOr for Claude Code:\n');
  console.log(`  claude mcp add --scope user foxden -- node "${server}"${extra.length ? ' ' + extra.join(' ') : ''}\n`);
}

function main() {
  const [command, ...args] = process.argv.slice(2);
  switch (command) {
    case 'list': return cmdList();
    case 'clone': return cmdClone(args);
    case 'new': return cmdNew(args);
    case 'login': return cmdLogin(args);
    case 'use': return cmdUse(args);
    case 'remove': return cmdRemove(args);
    case 'doctor': return cmdDoctor();
    case 'setup': return cmdSetup(args);
    case '--version':
    case '-v': return console.log(require('../package.json').version);
    default: return console.log(kUsage);
  }
}

try {
  main();
} catch (e) {
  fail(e.message);
}
