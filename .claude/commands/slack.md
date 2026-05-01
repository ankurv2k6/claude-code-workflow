# /slack

Unified Slack integration command for managing project registration and session connections.

## Usage

```
/slack <subcommand> [options]
```

## Daemon Connection

The daemon runs on **Unix socket by default** (not TCP). Always try Unix socket first:

```bash
# Unix socket (preferred)
SOCKET_PATH="$HOME/.claude/slack_integration/data/daemon.sock"
curl -s --unix-socket "$SOCKET_PATH" http://localhost/<endpoint>

# TCP fallback (if TRANSPORT_MODE=tcp)
curl -s http://localhost:3847/<endpoint>
```

**Get DAEMON_SECRET**:
```bash
DAEMON_SECRET=$(grep DAEMON_SECRET ~/.claude/slack_integration/.env | cut -d'=' -f2)
```

## Subcommands

| Subcommand | Description |
|------------|-------------|
| `enable [channel-id]` | Register/enable project for Slack integration |
| `connect` | Connect current session to Slack (creates thread) |
| `disconnect` | Disconnect session from Slack (archives thread) |
| `status` | Show current Slack integration status |
| `disable` | Disable Slack for project without unregistering |

---

## /slack enable [channel-id]

Register the current project for Slack integration or re-enable a disabled project.

### Instructions

1. Determine project root:
   - Use the current working directory
   - Validate it's an absolute path

2. Get channel ID:
   - If `$ARGUMENTS` contains a channel ID (starts with "C"), use it
   - If project already registered and no channel provided, call `/project/enable`
   - If not registered and no channel provided, ask user for channel ID

3. Call daemon API (use Unix socket):
   ```bash
   SOCKET="$HOME/.claude/slack_integration/data/daemon.sock"

   # For new registration:
   curl -s -X POST --unix-socket "$SOCKET" http://localhost/project/register \
     -H "Authorization: Bearer $DAEMON_SECRET" \
     -H "Content-Type: application/json" \
     -H "X-Caller-UID: $(id -u)" \
     -d '{"cwd": "<project-root>", "channelId": "<channel-id>"}'

   # For re-enabling existing project:
   curl -s -X POST --unix-socket "$SOCKET" http://localhost/project/enable \
     -H "Authorization: Bearer $DAEMON_SECRET" \
     -H "Content-Type: application/json" \
     -H "X-Caller-UID: $(id -u)" \
     -d '{"cwd": "<project-root>"}'
   ```

4. Report result:
   - Success (new): "Project registered! Use /slack connect to create a thread."
   - Success (re-enabled): "Slack re-enabled. Use /slack connect to create a thread."
   - Already registered: "Project already registered. Use /slack connect."
   - Unauthorized channel: "Channel not authorized. Contact admin."

### Examples

```
/slack enable C0123456789    # Register with specific channel
/slack enable                # Re-enable existing registration
```

---

## /slack connect

Connect this session to Slack (creates thread in project's channel).

### Prerequisites

- Project must be registered with `/slack enable` first
- Project must not be disabled

### Instructions

1. **Get current session ID** using this resolution order:

   a. List session files and check for matching PIDs:
      ```bash
      ls -la .claude/sessions/*.session_id
      ```
      Session files are named `<terminal-pid>.session_id` and contain:
      - Line 1: Session UUID
      - Line 2: Timestamp (epoch ms)

      **Note**: Shell's `$$` gives the current shell PID, not the Claude terminal PID.
      The session file PID corresponds to the terminal that launched Claude Code.

   b. If no matching file, query daemon for sessions in this project:
      ```bash
      curl -s --unix-socket ~/.claude/slack_integration/data/daemon.sock \
        "http://localhost/sessions/by-cwd?cwd=$(pwd)" \
        -H "Authorization: Bearer $DAEMON_SECRET" \
        -H "X-Caller-UID: $(id -u)"
      ```
      Response: `{"sessions": [{"sessionId": "...", "startedAt": "...", "slackConnected": true/false, ...}]}`

      - If exactly one session: use its sessionId
      - If multiple sessions: use most recent by `startedAt` timestamp
      - If no sessions: "No active session found. Session may not have started correctly."

2. Call daemon API:
   ```bash
   curl -s -X POST --unix-socket ~/.claude/slack_integration/data/daemon.sock \
     http://localhost/session/connect \
     -H "Authorization: Bearer $DAEMON_SECRET" \
     -H "Content-Type: application/json" \
     -H "X-Caller-UID: $(id -u)" \
     -d '{"sessionId": "<session-id>"}'
   ```

   Response examples:
   ```json
   // Success (new connection)
   {"sessionId": "...", "threadTs": "1771919535.086199", "channelId": "C0AHK1JSE8G", "status": "CONNECTED"}

   // Already connected
   {"sessionId": "...", "threadTs": "1771919535.086199", "channelId": "C0AHK1JSE8G", "status": "ALREADY_CONNECTED"}
   ```

3. Report result:
   - `status: "CONNECTED"`: "Connected! Thread created in Slack."
   - `status: "ALREADY_CONNECTED"`: "Already connected to Slack thread." (include threadTs and channelId)
   - Not registered: "Project not registered. Run /slack enable first."
   - Disabled: "Slack disabled for this project. Run /slack enable to re-enable."

### Error Handling

- Exit code 7 (connection refused): Daemon not running on TCP, try Unix socket
- Daemon unavailable on both: "Daemon not running. Start with: npm start"
- Thread creation failed: "Failed to create Slack thread. Check permissions."
- No session found: "No active session found. The session-start hook may not have run."

### Examples

```
/slack connect
```

---

## /slack disconnect

Disconnect this session from Slack (archives thread).

### Instructions

1. **Get current session ID** using the same resolution as `/slack connect`:
   - First check `.claude/sessions/<pid>.session_id` files
   - Fall back to `/sessions/by-cwd` API (use most recent by `startedAt`)

2. Call daemon API (use Unix socket):
   ```bash
   curl -s -X POST --unix-socket ~/.claude/slack_integration/data/daemon.sock \
     http://localhost/session/disconnect \
     -H "Authorization: Bearer $DAEMON_SECRET" \
     -H "Content-Type: application/json" \
     -H "X-Caller-UID: $(id -u)" \
     -d '{"sessionId": "<session-id>"}'
   ```

3. Report result:
   - Success: "Disconnected. Thread archived."
   - Already disconnected: "Not connected to Slack."

### Error Handling

- Daemon unavailable: "Daemon not running."
- Archive failed: "Failed to archive thread."
- Ownership mismatch: "Cannot disconnect session owned by another user."
- No session found: "No active session found."

### Examples

```
/slack disconnect
```

This archives the current Slack thread but keeps the session active.
You can reconnect later with `/slack connect`.

---

## /slack status

Show current Slack integration status for this session.

### Instructions

1. Get current working directory and session ID:
   - Session ID: Use the same resolution as `/slack connect`
   - CWD: Use current working directory

2. Call daemon APIs (use Unix socket):
   ```bash
   SOCKET="$HOME/.claude/slack_integration/data/daemon.sock"

   # Get project status
   curl -s --unix-socket "$SOCKET" "http://localhost/project/status?cwd=<cwd>" \
     -H "Authorization: Bearer $DAEMON_SECRET" \
     -H "X-Caller-UID: $(id -u)"

   # Get session status (or use /sessions/by-cwd for all sessions)
   curl -s --unix-socket "$SOCKET" "http://localhost/session/<session-id>/status" \
     -H "Authorization: Bearer $DAEMON_SECRET" \
     -H "X-Caller-UID: $(id -u)"
   ```

   The `/sessions/by-cwd` response includes useful fields:
   - `slackConnected`: boolean indicating if session has a Slack thread
   - `threadTs`: Slack thread timestamp (if connected)
   - `channelId`: Slack channel ID
   - `status`: Session status (e.g., "ACTIVE")

3. Display status:
   ```
   Slack Integration Status
   ========================
   Project: <path>
   Registered: Yes/No
   Enabled: Yes/No
   Channel: #channel-id (or "Not set")

   Session: <session-id>
   Connected: Yes/No
   Thread: <thread-ts> (or "None")
   ```

### Error Handling

- Daemon unavailable: "Daemon not running."
- Project not registered: Show "Registered: No"
- Session not found: Show "Session: Not registered"

### Examples

```
/slack status
```

---

## /slack disable

Disable Slack integration for this project without unregistering.
The project remains registered but won't create new threads.

### Instructions

1. Get project path from current directory

2. Call daemon API (use Unix socket):
   ```bash
   curl -s -X POST --unix-socket ~/.claude/slack_integration/data/daemon.sock \
     http://localhost/project/disable \
     -H "Authorization: Bearer $DAEMON_SECRET" \
     -H "Content-Type: application/json" \
     -H "X-Caller-UID: $(id -u)" \
     -d '{"cwd": "<project-root>"}'
   ```

3. Report result:
   - Success: "Slack disabled for this project. Run /slack enable to re-enable."
   - Not registered: "Project not registered. Use /slack enable first."
   - Ownership mismatch: "Cannot disable project registered by another user."

### Examples

```
/slack disable
```

This is useful when you want to temporarily stop Slack notifications without fully unregistering the project.

---

## Argument Parsing

The `$ARGUMENTS` variable contains everything after `/slack `. Parse it to determine the subcommand:

```
$ARGUMENTS = "enable C123456"  → subcommand="enable", channel="C123456"
$ARGUMENTS = "connect"         → subcommand="connect"
$ARGUMENTS = "disconnect"      → subcommand="disconnect"
$ARGUMENTS = "status"          → subcommand="status"
$ARGUMENTS = "disable"         → subcommand="disable"
$ARGUMENTS = ""                → Show usage help
```

If no subcommand provided or unrecognized, display usage:

```
Usage: /slack <subcommand>

Subcommands:
  enable [channel-id]  Register/enable project for Slack
  connect              Connect session to Slack thread
  disconnect           Disconnect from Slack thread
  status               Show integration status
  disable              Disable Slack for project

Examples:
  /slack enable C0123456789
  /slack connect
  /slack status
```

---

## Error Codes

| Code | Description | Recovery |
|------|-------------|----------|
| `DAEMON_UNAVAILABLE` | Daemon not running | Start with: npm start |
| `PROJECT_NOT_FOUND` | Project not registered | Run /slack enable |
| `PROJECT_DISABLED` | Slack disabled for project | Run /slack enable |
| `CHANNEL_NOT_AUTHORIZED` | Channel not in allowed list | Contact admin |
| `SESSION_NOT_CONNECTED` | Session not connected | Run /slack connect |
| `SESSION_ALREADY_CONNECTED` | Already has a thread | Use existing thread |
| `OWNERSHIP_MISMATCH` | Cannot modify another's resource | Switch user |
