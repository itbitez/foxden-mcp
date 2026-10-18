#!/usr/bin/env node
'use strict';

// FoxDen MCP server: Playwright MCP driving your installed Firefox with a
// persistent FoxDen profile. Every Playwright MCP option is passed through.

const fs = require('fs');
const path = require('path');
const profiles = require('../lib/profiles');

// stdout carries the MCP protocol, so diagnostics go to stderr.
const log = message => process.stderr.write(`[foxden] ${message}\n`);

const optionValue = (args, name) => {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name)
      return args[i + 1];
    if (args[i].startsWith(name + '='))
      return args[i].slice(name.length + 1);
  }
  return undefined;
};
const hasOption = (args, name) => args.some(a => a === name || a.startsWith(name + '='));

function takeOption(args, name) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name)
      return args.splice(i, 2)[1];
    if (args[i].startsWith(name + '='))
      return args.splice(i, 1)[0].slice(name.length + 1);
  }
  return undefined;
}

function removeOption(args, name) {
  for (let i = 0; i < args.length; i++) {
    if (args[i] === name)
      return void args.splice(i, 2);
    if (args[i].startsWith(name + '='))
      return void args.splice(i, 1);
  }
}

function isPlainObject(value) {
  return value && typeof value === 'object' && !Array.isArray(value);
}

function deepMerge(base, override) {
  const result = { ...base };
  for (const [key, value] of Object.entries(override)) {
    result[key] = isPlainObject(value) && isPlainObject(base[key]) ? deepMerge(base[key], value) : value;
  }
  return result;
}

/** Path to a config with FoxDen's Firefox defaults, layered under the user's --config if given. */
function resolveConfig(args) {
  const ownConfig = path.join(__dirname, '..', 'lib', 'firefox-config.json');
  const userConfigPath = optionValue(args, '--config') || process.env.PLAYWRIGHT_MCP_CONFIG;
  if (!userConfigPath)
    return ownConfig;
  const base = JSON.parse(fs.readFileSync(ownConfig, 'utf8'));
  const user = JSON.parse(fs.readFileSync(path.resolve(userConfigPath), 'utf8'));
  const merged = path.join(profiles.foxdenHome(), 'merged-config.json');
  fs.mkdirSync(path.dirname(merged), { recursive: true });
  fs.writeFileSync(merged, JSON.stringify(deepMerge(base, user), null, 2));
  return merged;
}

function main() {
  const args = process.argv.slice(2);

  // Subcommands such as "install-browser" go straight to Playwright MCP.
  const passthrough = (args[0] && !args[0].startsWith('-')) ||
    hasOption(args, '--help') || hasOption(args, '-h') || hasOption(args, '--version') || hasOption(args, '-V') ||
    // Remote/extension modes connect to a browser that is already running.
    hasOption(args, '--cdp-endpoint') || hasOption(args, '--endpoint') || hasOption(args, '--extension');

  if (hasOption(args, '--version') || hasOption(args, '-V'))
    log(`FoxDen ${require('../package.json').version}`);

  const profileName = takeOption(args, '--profile');
  const browser = optionValue(args, '--browser') || process.env.PLAYWRIGHT_MCP_BROWSER;
  const usesFirefox = !browser || browser.startsWith('moz-firefox');

  if (!passthrough && !usesFirefox)
    log(`--browser ${browser} requested: running plain Playwright MCP without a FoxDen profile.`);

  if (!passthrough && usesFirefox) {
    const executable = optionValue(args, '--executable-path') || process.env.PLAYWRIGHT_MCP_EXECUTABLE_PATH || profiles.findFirefoxExecutable();
    if (!executable)
      log('Firefox was not found. Install Firefox or set FIREFOX_PATH to firefox.exe.');
    else if (!hasOption(args, '--executable-path'))
      args.push('--executable-path', executable);

    const ownUserDataDir = !hasOption(args, '--user-data-dir') && !process.env.PLAYWRIGHT_MCP_USER_DATA_DIR &&
      !hasOption(args, '--isolated') && !process.env.PLAYWRIGHT_MCP_ISOLATED;
    if (ownUserDataDir) {
      const name = profiles.resolveProfileName(profileName);
      const dir = profiles.profileDir(name);
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true });
        log(`Created empty profile "${name}". Run "foxden clone" to copy your Firefox logins into it.`);
      }
      if (profiles.isProfileInUse(dir))
        log(`Warning: profile "${name}" is open in another Firefox window. Close it, or the browser cannot start.`);
      args.push('--user-data-dir', dir);
      log(`Using profile "${name}" (${dir})`);
    }

    const config = resolveConfig(args);
    removeOption(args, '--config');
    args.push('--config', config);
    if (!browser)
      args.push('--browser', 'moz-firefox');
  }

  const cli = path.join(path.dirname(require.resolve('@playwright/mcp/package.json')), 'cli.js');
  process.argv = [process.argv[0], cli, ...args];
  require(cli);
}

try {
  main();
} catch (e) {
  log(`Error: ${e.message}`);
  process.exit(1);
}
