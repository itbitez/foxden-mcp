# 🦊 FoxDen MCP

**Let your AI agent use _your_ Firefox: your logins, saved passwords, bookmarks and extensions.**

FoxDen is an MCP server for AI agents (Claude, Cursor, VS Code, ...). It has every tool and option of
[Playwright MCP](https://github.com/microsoft/playwright-mcp), but it drives the Firefox already installed on your
computer, not a fresh Chrome with no logins. FoxDen copies your real Firefox profile into its own "den", so the
agent starts out signed in to your sites, and your everyday Firefox is never touched.

- **Same tools:** navigate, click, type, fill forms, snapshots, screenshots, tabs, network, PDF, vision, devtools,
  and every other Playwright MCP tool and command-line flag.
- **Your sessions:** cookies, saved passwords (with autofill), bookmarks and extensions come along.
- **Safe for your daily browser:** FoxDen works on a copy. Your real profile is never modified or locked, and you can
  keep browsing in Firefox while the agent works.
- **Multiple accounts:** keep a separate profile per client or account and switch with one command.

## Requirements

- [Node.js](https://nodejs.org) 18 or newer
- [Firefox](https://www.mozilla.org/firefox/) (a recent release; checked with `foxden doctor`)
- Windows, macOS or Linux

## Install

```bash
git clone https://github.com/itbitez/foxden-mcp.git
cd foxden-mcp
npm install
npm link           # optional: makes the "foxden" command available everywhere
```

Copy your Firefox profile into FoxDen and check the setup:

```bash
foxden clone       # or: npm run foxden -- clone
foxden doctor
```

## Add it to your MCP client

Run `foxden setup` to print the exact config with your local path. For example:

**Claude Desktop** (`claude_desktop_config.json`):

```json
{
  "mcpServers": {
    "foxden": {
      "command": "node",
      "args": ["C:/path/to/foxden-mcp/bin/foxden-mcp.js"]
    }
  }
}
```

**Claude Code:**

```bash
claude mcp add --scope user foxden -- node "C:/path/to/foxden-mcp/bin/foxden-mcp.js"
```

**VS Code / Cursor / others:** use the same `command` and `args`.

## Profiles

| Command | What it does |
|---|---|
| `foxden list` | Show your Firefox profiles and FoxDen profiles |
| `foxden clone` | Copy your default Firefox profile into the `main` FoxDen profile (run again to refresh) |
| `foxden clone <firefox-profile> --as <name>` | Copy a specific Firefox profile under another name |
| `foxden clone --light` | Copy without site storage (smaller), keeping cookies and passwords |
| `foxden new <name>` | Create an empty profile, for example for a second account |
| `foxden login [name] [url]` | Open a normal Firefox window with that profile to sign in by hand |
| `foxden use <name>` | Choose the profile FoxDen MCP uses |
| `foxden remove <name>` | Delete a FoxDen profile (your real Firefox is untouched) |
| `foxden doctor` | Check Node.js, Firefox and the active profile |
| `foxden setup [name]` | Print the MCP client config |

### Signing in to a site

1. Ask the agent to close the browser (or close the FoxDen Firefox window).
2. Run `foxden login`, sign in, then close the window.
3. Next time the agent opens the browser, it is already signed in.

Sign in by hand rather than letting the agent do it. Some sites, like Google, refuse to sign in while a browser is
being automated.

### Several accounts at once

```bash
foxden new client-a
foxden login client-a https://example.com/login
```

Then run one server per profile:

```json
{
  "mcpServers": {
    "foxden": { "command": "node", "args": ["C:/path/to/foxden-mcp/bin/foxden-mcp.js"] },
    "foxden-client-a": { "command": "node", "args": ["C:/path/to/foxden-mcp/bin/foxden-mcp.js", "--profile", "client-a"] }
  }
}
```

## Options

FoxDen passes **every Playwright MCP option** straight through, so `--headless`, `--caps=vision,pdf,devtools`,
`--viewport-size`, `--proxy-server`, `--config`, `--port` and the rest work exactly as documented in the
[Playwright MCP README](https://github.com/microsoft/playwright-mcp#configuration). If you pass your own `--config`
file, it is merged on top of FoxDen's Firefox defaults.

FoxDen adds:

| Option / variable | Meaning |
|---|---|
| `--profile <name>` / `FOXDEN_PROFILE` | Profile to use (default: the one chosen with `foxden use`, else `main`) |
| `FIREFOX_PATH` | Path to the Firefox executable if it is not in a standard location |
| `FOXDEN_HOME` | Where profiles are stored (default below) |

Profiles are stored in:

- Windows: `%LOCALAPPDATA%\FoxDen\profiles`
- macOS: `~/Library/Application Support/FoxDen/profiles`
- Linux: `~/.local/share/foxden/profiles`

Chrome-only modes (`--extension`, `--cdp-endpoint`) and `--browser chrome|msedge|webkit` still work. FoxDen then runs
as plain Playwright MCP without a FoxDen profile. `--mobile` is not available with Firefox.

## How it works

- FoxDen starts Playwright MCP with `--browser moz-firefox`. Playwright then controls your installed Firefox over
  WebDriver BiDi, Firefox's standard automation protocol, so no patched browser download is needed.
- Your profile is **copied**, never used directly. Firefox locks a profile while it runs, and Playwright writes
  automation prefs into whatever profile it opens.
- Playwright turns off password saving/autofill and safe browsing for testing. FoxDen turns them back on
  (`lib/firefox-config.json`).

## Troubleshooting

- **Browser does not start:** run `foxden doctor`. The most common cause is a `foxden login` window still open with
  the same profile.
- **Not signed in somewhere:** run `foxden clone` again to refresh the copy from your Firefox (close Firefox first
  for the cleanest copy), or sign in with `foxden login`. Cloning replaces logins you made inside the copy.
- **Primary Password:** if you use one, Firefox asks for it before filling saved passwords.

## Test

```bash
npm test                                  # tool parity with Playwright MCP + launches Firefox
npm test -- --caps=vision,pdf,devtools    # with optional tool groups
```

## Security

Profiles contain your cookies and saved passwords. They live outside this repository and are git-ignored. Never
share or commit a profile folder. Anyone with the agent's browser can act as you on signed-in sites.

## License

MIT © itbitez. See [LICENSE](LICENSE).

FoxDen uses Playwright MCP by Microsoft (Apache-2.0) as an unmodified dependency; see [NOTICE](NOTICE). FoxDen is
not affiliated with Microsoft or Mozilla.
