# CCUnpacked Reference Book

A comprehensive dump of all expanded data from CCUnpacked.

## Architecture

### utils directory, 564 files. Shared utility modules — the largest directory by far

1,882
514
52
94

### components directory, 389 files. React (`Ink`) components for the terminal UI

1,871
511
52
94

### commands directory, 189 files. 95 CLI command handlers — from `/init` to `/ultraplan`

1,870
511
52
93

### tools directory, 184 files. 42 built-in tool implementations plus 11 feature-gated tools registered in `tools.ts`

1,871
511
52
94

### services directory, 130 files. Core service layer — API, MCP, compaction, streaming, analytics

1,871
511
52
94

### hooks directory, 104 files. React hooks for terminal UI state management

1,871
511
52
94

### ink directory, 96 files. `Ink` framework extensions — React rendering in the terminal via `Yoga` flexbox

1,872
511
52
94

### bridge directory, 31 files. Remote control infrastructure — control Claude Code from phone or browser

1,871
511
52
94

### constants directory, 21 files. Configuration constants, feature flags, default values

1,871
511
52
94

### skills directory, 20 files. Skill system — loadable prompt modules for specialized tasks

1,874
512
52
94

### cli directory, 19 files. CLI transport layer — `stdin`/`stdout`, `NDJSON`, remote IO

1,871
511
52
94

### keybindings directory, 14 files. Terminal keyboard shortcuts and Vim mode bindings

1,871
511
52
94

### tasks directory, 12 files. Background task management for agent sub-tasks

1,869
510
52
93

### types directory, 11 files. Shared TypeScript type definitions

1,871
511
52
94

### migrations directory, 11 files. Data migration scripts between versions

1,873
512
52
94

### context directory, 9 files. Context assembly — `CLAUDE.md`, tools, memory, system prompt

1,871
511
52
94

### memdir directory, 8 files. Persistent memory directory — session-to-session knowledge

1,874
512
52
94

### entrypoints directory, 8 files. CLI bootstrap — main entry points for the `claude` command

1,871
511
52
94

### state directory, 6 files. Global state management stores

1,873
512
52
94

state/
Global state management stores
6 files

### buddy directory, 6 files. AI companion pet — an easter egg with species, rarity, and personality

1,871
511
52
94

buddy/
AI companion pet — an easter egg with species, rarity, and personality
6 files

### vim directory, 5 files. Vim mode — modal editing keybindings for the terminal UI

1,872
511
52
94

vim/
Vim mode — modal editing keybindings for the terminal UI
5 files

### remote directory, 4 files. Remote session management

1,871
511
52
94

remote/
Remote session management
4 files

### query directory, 4 files. Query processing pipeline

1,871
511
52
94

query/
Query processing pipeline
4 files

### native-ts directory, 4 files. Native TypeScript compilation helpers

1,871
511
52
94

native-ts/
Native TypeScript compilation helpers
4 files

### server directory, 3 files. `HTTP`/`WebSocket` server for bridge and remote modes

1,872
511
52
94

server/
HTTP
/
WebSocket
server for bridge and remote modes
3 files

### screens directory, 3 files. Full-screen terminal UI views

1,871
511
52
94

screens/
Full-screen terminal UI views
3 files

### upstreamproxy directory, 2 files. `HTTP` proxy for API request interception

1,871
511
52
94

upstreamproxy/
HTTP
proxy for API request interception
2 files

### plugins directory, 2 files. Plugin system — external extension loading

1,871
511
52
94

plugins/
Plugin system — external extension loading
2 files

### voice directory, 1 files. Voice mode — microphone input for hands-free coding

1,873
512
52
94

### schemas directory, 1 files. `Zod` schemas for configuration validation

1,871
511
52
94

schemas/
Zod
schemas for configuration validation
1 files

### outputStyles directory, 1 files. Terminal output formatting styles

1,874
512
52
94

outputStyles/
Terminal output formatting styles
1 files

### moreright directory, 1 files. Extended permission rule helpers

1,873
512
52
94

moreright/
Extended permission rule helpers
1 files

### coordinator directory, 1 files. Multi-agent mode toggle — actual orchestration lives in `utils/swarm/`

1,871
511
52
94

coordinator/
Multi-agent mode toggle — actual orchestration lives in
utils/swarm/
1 files

### bootstrap directory, 1 files. Application bootstrap state

1,874
512
52
94

bootstrap/
Application bootstrap state
1 files

### assistant directory, 1 files. Session history for assistant mode

1,871
511
52
94

assistant/
Session history for assistant mode
1 files

## Tools

### FileRead: Read the contents of a file from the filesystem

1,872
511
52
94

### FileEdit: Make targeted edits to existing files using search and replace

### FileWrite: Create new files or overwrite existing ones

### Glob: Find files matching a glob pattern across the project

### Grep: Search file contents using regular expressions

### NotebookEdit: Replace, insert, or delete Jupyter notebook cells

### Bash: Execute shell commands in the user's terminal with safety analysis

×
Bash
Execution
Execute shell commands in the user's terminal with safety analysis
How It Works
Runs commands through a safety analyzer that detects destructive operations (
rm -rf
,
git push --force
). Commands run in the user's shell environment with full access to installed tools.
Parameters
command
timeout?
src/tools/BashTool

### PowerShell: Execute PowerShell commands on Windows systems

×
PowerShell
Execution
Execute PowerShell commands on Windows systems
How It Works
Windows-specific execution environment. Runs PowerShell scripts and commands with the same safety analysis as Bash. Handles PowerShell-specific syntax and modules.
Parameters
command
timeout?
src/tools/PowerShellTool

### REPL: Run code in an interactive REPL session (Python, Node, etc.)

×
REPL
Execution
Run code in an interactive REPL session (Python, Node, etc.)
How It Works
Maintains a persistent REPL session that preserves state between calls. Variables, imports, and definitions persist across invocations within the same session.
Parameters
language
code
src/tools/REPLTool

### WebBrowser: Control a headless browser for web interaction (feature-gated)

×
WebBrowser
Search & Fetch
🔒 Feature-gated
Control a headless browser for web interaction
How It Works
Needs
WEB_BROWSER_TOOL
. Renders a browser panel in the REPL UI via
WebBrowserPanel
component. Implementation stripped from the public source.
Parameters
action
url?
selector?
src/tools.ts

### WebFetch: Fetch a URL and process it with an AI model

×
WebFetch
Search & Fetch
Fetch a URL and process it with an AI model
How It Works
Takes a URL and a prompt. Fetches the page, converts HTML to markdown, then runs the prompt against the content using a small, fast model. Returns the model's response.
Parameters
url
prompt
src/tools/WebFetchTool

### WebSearch: Search the web and return results

×
WebSearch
Search & Fetch
Search the web and return results
How It Works
Queries a search engine and returns structured results with titles, URLs, and snippets. Used when Claude needs current information not in its training data.
Parameters
query
maxResults?
src/tools/WebSearchTool

### ToolSearch: Search for available MCP tools by name or description

×
ToolSearch
Search & Fetch
Search for available MCP tools by name or description
How It Works
Searches the registry of available tools (both built-in and MCP) by name or description. Returns matching tools with their schemas. Used for tool discovery at runtime.
Parameters
query
src/tools/ToolSearchTool

### Agent: Spawn a sub-agent to handle complex tasks autonomously

×
Agent
Agents & Tasks
Spawn a sub-agent to handle complex tasks autonomously
How It Works
Creates an independent Claude instance with its own context window. The sub-agent can use tools, read files, and execute commands. Results are returned to the parent when complete.
Parameters
prompt
tools?
model?
src/tools/AgentTool

### SendMessage: Send messages between agents in multi-agent orchestration

×
SendMessage
Agents & Tasks
Send messages between agents in multi-agent orchestration
How It Works
Inter-process communication between Claude Code sessions via Unix domain sockets. Agents and background daemons on the same codebase can coordinate through this.
Parameters
target
message
src/tools/SendMessageTool

### TaskCreate: Create a new task in the task list

×
TaskCreate
Agents & Tasks
Create a new task in the task list
How It Works
Spawns a task that runs in its own execution context. Tasks can be monitored, updated, or stopped.
Parameters
prompt
taskId?
src/tools/TaskCreateTool

### TaskGet: Get a task by ID from the task list

×
TaskGet
Agents & Tasks
Get a task by ID from the task list
How It Works
Retrieves a task's current state and output by its ID.
Parameters
taskId
src/tools/TaskGetTool

### TaskList: List all tasks in the task list

×
TaskList
Agents & Tasks
List all tasks in the task list
How It Works
Returns an overview of all tasks in the current session with their IDs, statuses, and creation times.
src/tools/TaskListTool

### TaskUpdate: Update a task in the task list

×
TaskUpdate
Agents & Tasks
Update a task in the task list
How It Works
Modifies a task's configuration or adds context.
Parameters
taskId
update
src/tools/TaskUpdateTool

### TaskStop: Stop a running background task

×
TaskStop
Agents & Tasks
Stop a running background task
How It Works
Gracefully terminates a background task. Any partial output generated before stopping is kept. The task's final state is marked as stopped.
Parameters
taskId
src/tools/TaskStopTool

### TaskOutput: [Deprecated] Get the output from a task

×
TaskOutput
Agents & Tasks
[Deprecated] Get the output from a task
How It Works
Deprecated — the source says to prefer
Read
on the task output file path instead.
Parameters
taskId
src/tools/TaskOutputTool

### TeamCreate: Create a team of agents with defined roles and capabilities

×
TeamCreate
Agents & Tasks
Create a team of agents with defined roles and capabilities
How It Works
Sets up a multi-agent team with a lead coordinator and specialized workers. Each member gets a defined role and agent type.
Parameters
roles
configuration
src/tools/TeamCreateTool

### TeamDelete: Remove a team and clean up its resources

×
TeamDelete
Agents & Tasks
Remove a team and clean up its resources
How It Works
Tears down a multi-agent team, stopping all member agents and cleaning up scratch directories. Collects final outputs before deletion.
Parameters
teamId
src/tools/TeamDeleteTool

### ListPeers: Discover other running Claude Code sessions (feature-gated)

×
ListPeers
Agents & Tasks
🔒 Feature-gated
Discover other running Claude Code sessions
How It Works
Scans for local sessions via Unix domain sockets and remote ones via Bridge. Returns peer addresses that
SendMessage
can target. Referenced in the
SendMessage
prompt.
src/tools.ts

### EnterPlanMode: Switch to plan mode — outline steps before executing

×
EnterPlanMode
Planning
Switch to plan mode — outline steps before executing
How It Works
Activates a structured planning phase where Claude outlines steps before taking action. Prevents premature execution on complex tasks that need architectural thinking first.
src/tools/EnterPlanModeTool

### ExitPlanMode: Prompt the user to exit plan mode and start coding

×
ExitPlanMode
Planning
Prompt the user to exit plan mode and start coding
How It Works
Signals that the plan is written and ready for user review. Does not take the plan as a parameter — it reads from the plan file. Only for code implementation tasks, not research.
src/tools/ExitPlanModeTool

### EnterWorktree: Create or enter an isolated git worktree for safe experimentation

×
EnterWorktree
Planning
Create or enter an isolated git worktree for safe experimentation
How It Works
Creates a
git worktree
— a separate working directory linked to the same repo. Changes here don't affect the main branch.
Parameters
branchName?
src/tools/EnterWorktreeTool

### ExitWorktree: Exit the current worktree and return to the main branch

×
ExitWorktree
Planning
Exit the current worktree and return to the main branch
How It Works
Leaves the worktree and returns to the original working directory. Can optionally merge changes back or discard them entirely.
Parameters
merge?
src/tools/ExitWorktreeTool

### VerifyPlanExecution: Check whether a plan step was executed correctly (feature-gated)

×
VerifyPlanExecution
Planning
🔒 Feature-gated
Check whether a plan step was executed correctly
How It Works
Triggers background verification that a plan step was completed.
AppStateStore
and the attachment system reference it — a reminder attachment is injected if the model hasn't called it yet.
Parameters
stepId
src/tools.ts

### mcp: Invoke a tool from a connected MCP (Model Context Protocol) server

×
mcp
MCP
Invoke a tool from a connected MCP (Model Context Protocol) server
How It Works
Generic wrapper for MCP tools — name and schema are dynamically overridden per invocation. Routes tool calls through the MCP protocol, handling serialization, auth, and error mapping.
Parameters
serverName
toolName
arguments
src/tools/MCPTool

### ListMcpResources: List available resources from connected MCP servers

×
ListMcpResources
MCP
List available resources from connected MCP servers
How It Works
Queries connected MCP servers for their available resources (files, databases, APIs). Returns URIs and descriptions that can be read with
ReadMcpResource
.
Parameters
serverName?
src/tools/ListMcpResourcesTool

### ReadMcpResource: Read data from a specific MCP resource

×
ReadMcpResource
MCP
Read data from a specific MCP resource
How It Works
Fetches content from an MCP resource URI. Resources can be files, database records, API responses, or any data the MCP server exposes. Returns structured content.
Parameters
uri
src/tools/ReadMcpResourceTool

### McpAuth: Authenticate with an MCP server using OAuth or tokens

×
McpAuth
MCP
Authenticate with an MCP server using OAuth or tokens
How It Works
Handles authentication flows for MCP servers that require credentials. Supports
OAuth 2.0
authorization code flow, token-based auth, and credential storage.
Parameters
serverName
authType
src/tools/McpAuthTool

### AskUserQuestion: Prompt the user for input or confirmation

×
AskUserQuestion
System
Prompt the user for input or confirmation
How It Works
Presents a question to the user and waits for a response. Used for disambiguation, confirmation of destructive actions, or gathering information Claude can't infer.
Parameters
question
options?
src/tools/AskUserQuestionTool

### TodoWrite: Create and manage a persistent to-do list file

×
TodoWrite
System
Create and manage a persistent to-do list file
How It Works
Writes a structured task list to a file that persists across sessions. Each item has an ID, status (not-started, in-progress, completed), and description. Used for task tracking.
Parameters
items
src/tools/TodoWriteTool

### Skill: Load and execute a specialized skill module

×
Skill
System
Load and execute a specialized skill module
How It Works
Reads a
SKILL.md
file that contains domain-specific instructions, workflows, and constraints. Skills modify Claude's behavior for specialized tasks like testing or debugging.
Parameters
skillPath
src/tools/SkillTool

### Config: Read and update Claude Code configuration settings

×
Config
System
Read and update Claude Code configuration settings
How It Works
Accesses the Claude Code settings system. Can read current values, update preferences, and manage project-level or global configuration files.
Parameters
key
value?
scope?
src/tools/ConfigTool

### RemoteTrigger: Trigger an action on a remote Claude Code instance (feature-gated)

×
RemoteTrigger
System
🔒 Feature-gated
Trigger an action on a remote Claude Code instance
How It Works
Sends a command to another Claude Code instance running on a different machine or session. Used with Bridge for remote control workflows. Requires network connectivity.
Parameters
target
action
src/tools/RemoteTriggerTool

### CronCreate: Schedule a new recurring cron job (feature-gated)

×
CronCreate
System
🔒 Feature-gated
Schedule a new recurring cron job
How It Works
Takes a standard 5-field cron expression and a prompt. Creates persistent or in-memory scheduled tasks.
Parameters
cron
prompt
recurring?
durable?
src/tools/ScheduleCronTool

### CronDelete: Cancel a scheduled cron job (feature-gated)

×
CronDelete
System
🔒 Feature-gated
Cancel a scheduled cron job
How It Works
Removes a scheduled cron job by its ID. Stops the recurring execution and cleans up the job entry.
Parameters
id
src/tools/ScheduleCronTool

### CronList: List all active cron jobs (feature-gated)

×
CronList
System
🔒 Feature-gated
List all active cron jobs
How It Works
Returns all currently scheduled cron jobs with their schedules, prompts, and IDs. No parameters required.
src/tools/ScheduleCronTool

### Snip: Trim old conversation turns to free context space (feature-gated)

×
Snip
System
🔒 Feature-gated
Trim old conversation turns to free context space
How It Works
Marks earlier turns as snipped and replaces them with compact summaries. Part of
QueryEngine
's message handling and the compaction pipeline.
Parameters
messageIds
src/tools.ts

### Workflow: Run a named workflow script (feature-gated)

×
Workflow
System
🔒 Feature-gated
Run a named workflow script
How It Works
Requires
WORKFLOW_SCRIPTS
. Initializes bundled workflows on load, then executes them by name. Referenced in the permissions classifier. Implementation stripped from the public source.
Parameters
name
args?
src/tools.ts

### TerminalCapture: Capture the current state of a terminal panel (feature-gated)

×
TerminalCapture
System
🔒 Feature-gated
Capture the current state of a terminal panel
How It Works
Requires
TERMINAL_PANEL
. Captures content from a terminal panel. Referenced in the permissions classifier. Implementation stripped from the public source.
Parameters
panelId?
src/tools.ts

### Sleep: Pause execution for a specified duration

×
Sleep
Experimental
Pause execution for a specified duration
How It Works
Suspends the current execution for a given number of milliseconds. Used for rate limiting, waiting for external processes, or pacing multi-step operations.
Parameters
durationMs
src/tools/SleepTool

### SendUserMessage: Send a message to the user

×
SendUserMessage
Experimental
Send a message to the user
How It Works
How Claude sends its replies. Text outside this tool is only visible if the user expands the detail view. Legacy name:
Brief
.
Parameters
message
attachments?
status
src/tools/BriefTool

### StructuredOutput: Return structured output in the requested format (feature-gated)

×
StructuredOutput
Experimental
🔒 Feature-gated
Return structured output in the requested format
How It Works
Takes any input object and returns structured JSON. Only active in non-interactive sessions where consumers need machine-readable output.
Parameters
content
format?
src/tools/SyntheticOutputTool

### LSP: Query Language Server Protocol for code intelligence (feature-gated)

×
LSP
Experimental
🔒 Feature-gated
Query Language Server Protocol for code intelligence
How It Works
Talks to running language servers for type information, go-to-definition, find references, and diagnostics.
Parameters
action
filePath
position?
src/tools/LSPTool

### SendUserFile: Send a file to the user's connected device (feature-gated)

×
SendUserFile
Experimental
🔒 Feature-gated
Send a file to the user's connected device
How It Works
File-delivery communication channel paired with
Brief
. Requires the
KAIROS
flag. Implementation stripped from the public source.
Parameters
filePath
src/tools.ts

### PushNotification: Push a notification to the user's device (feature-gated)

×
PushNotification
Experimental
🔒 Feature-gated
Push a notification to the user's device
How It Works
Config settings show three modes: notify when Claude finishes while idle, notify when a permission prompt is waiting, and allow Claude to push when it deems appropriate. All require
Remote Control
.
Parameters
title
body
src/tools.ts

### Monitor: Stream events from a background process (feature-gated)

×
Monitor
Experimental
🔒 Feature-gated
Stream events from a background process
How It Works
Receives each stdout line from a background process as a notification. When active, sleep commands over 2 seconds are blocked in
BashTool
's
validateInput
.
Parameters
processId
src/tools.ts

### SubscribePR: Subscribe to GitHub pull request events (feature-gated)

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts

## Commands

### /init: Initialize a project with a CLAUDE.md file

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/init
Setup & Config
Initialize a project with a CLAUDE.md file
How It Works
Scans the repository for build scripts, linters, and test commands, then generates a
CLAUDE.md
with project conventions. Runs init verifiers to detect common configurations and pre-populates instructions for Claude.
Related Commands
/doctor
/onboarding
src/commands/init.ts

### /login: Authenticate with your Anthropic account

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/login
Setup & Config
Authenticate with your Anthropic account
How It Works
Opens an OAuth flow to authenticate with the Anthropic API. Stores credentials securely and validates the session. Supports both direct API keys and OAuth-based authentication.
Related Commands
/logout
src/commands/login/

### /logout: Sign out of your Anthropic account

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/logout
Setup & Config
Sign out of your Anthropic account
How It Works
Clears stored credentials and invalidates the current session. After logout, Claude Code will prompt for re-authentication on the next request.
Related Commands
/login
src/commands/logout/

### /config: View or modify Claude Code configuration

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/config
Setup & Config
View or modify Claude Code configuration
How It Works
Manages user and project-level settings stored in configuration files. Supports viewing current values, setting new ones, and resetting to defaults. Configuration is layered: global → project → session.
Related Commands
/permissions
/theme
src/commands/config/

### /permissions: View and manage tool permissions

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/permissions
Setup & Config
View and manage tool permissions
How It Works
Controls which tools Claude can use without asking. Uses a 3-layer permission model:
deny
→
check
→
prompt
. Permissions can be set globally or per-project in
CLAUDE.md
or
.claude/settings.json
.
Related Commands
/config
src/commands/permissions/

### /model: Switch the active AI model

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/model
Setup & Config
Switch the active AI model
How It Works
Changes which model Claude Code uses for the current session. Shows available models with their capabilities and pricing. Supports Anthropic models and compatible providers.
Flags / Options
--list
Related Commands
/cost
/usage
src/commands/model/

### /theme: Change the terminal color theme

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/theme
Setup & Config
Change the terminal color theme
How It Works
Switches between built-in color themes that control the appearance of Claude Code in the terminal. Themes affect syntax highlighting, status indicators, and UI chrome.
Related Commands
/color
src/commands/theme/

### /terminal-setup: Install terminal key bindings

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/terminal-setup
Setup & Config
Install terminal key bindings
How It Works
Configures terminal keybindings for multi-line input. Sets up Shift+Enter for newlines on VS Code, Cursor, Windsurf, and Alacritty; Option+Enter on Apple Terminal.
Related Commands
/config
src/commands/terminalSetup/

### /doctor: Diagnose common setup issues

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/doctor
Setup & Config
Diagnose common setup issues
How It Works
Runs a series of health checks on your Claude Code installation. Verifies API connectivity, authentication status,
git
configuration, shell environment, and project setup. Reports issues with suggested fixes.
Related Commands
/init
/status
src/commands/doctor/

### /onboarding: Disabled stub

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/onboarding
Setup & Config
Disabled stub
How It Works
Disabled stub command.
isEnabled
returns false and
isHidden
is true. No implementation.
Related Commands
/init
/help
src/commands/onboarding/

### /mcp: Manage Model Context Protocol servers

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/mcp
Setup & Config
Manage Model Context Protocol servers
How It Works
Lists, adds, removes, and configures
MCP
servers that extend Claude's tool capabilities. MCP servers run as separate processes and expose tools over
stdio
or
SSE
transports.
Related Commands
/plugin
src/commands/mcp/

### /hooks: View hook configurations for tool events

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/hooks
Setup & Config
View hook configurations for tool events
How It Works
Shows the hooks configured for lifecycle events — before/after tool calls, on session start, on compaction, etc. Hooks are defined in
.claude/settings.json
.
Related Commands
/config
src/commands/hooks/

### /compact: Clear conversation history but keep a summary in context

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/compact
Daily Workflow
Clear conversation history but keep a summary in context
How It Works
Replaces the full conversation with a condensed summary, freeing up context space. Takes optional custom summarization instructions. Triggered automatically when context exceeds limits, or run manually.
Flags / Options
--full
Related Commands
/clear
/summary
src/commands/compact/

### /memory: Read and write to persistent memory files

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/memory
Daily Workflow
Read and write to persistent memory files
How It Works
Manages
CLAUDE.md
memory files at user, project, and session scope. Memory persists across conversations and stores project conventions, preferences, and learned patterns. Supports viewing, editing, and clearing.
Related Commands
/init
/context
src/commands/memory/

### /context: Visualize current context usage as a colored grid

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/context
Daily Workflow
Visualize current context usage as a colored grid
How It Works
Shows a visual breakdown of what's in the context window and how much space each part uses.
Related Commands
/add-dir
/files
src/commands/context/

### /plan: Enable plan mode or view the current session plan

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/plan
Daily Workflow
Enable plan mode or view the current session plan
How It Works
Toggles plan mode, where Claude writes a structured plan before executing. Takes an optional
[open|<description>]
argument. Plans can be saved and resumed later with
/resume
.
Related Commands
/ultraplan
/tasks
src/commands/plan/

### /resume: Resume a previous session or plan

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/resume
Daily Workflow
Resume a previous session or plan
How It Works
Picks up where a previous Claude Code session left off. Reloads conversation context, active plans, and in-progress work. Supports resuming from session history or saved plan files.
Related Commands
/session
/plan
src/commands/resume/

### /session: Show remote session URL and QR code

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/session
Daily Workflow
Show remote session URL and QR code
How It Works
Displays the remote session URL and a QR code so you can connect from another device. Only works when Claude Code is started with
--remote
.
Related Commands
/resume
/clear
src/commands/session/

### /files: List files currently in context

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/files
Daily Workflow
List files currently in context
How It Works
Shows all files that have been read into the current conversation context, along with their token counts and staleness indicators. Helps manage the context budget.
Related Commands
/context
/add-dir
src/commands/files/

### /add-dir: Add a directory to the working context

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/add-dir
Daily Workflow
Add a directory to the working context
How It Works
Adds all files from a directory (recursively) to Claude's working context. Respects
.gitignore
patterns and can filter by file extension.
Related Commands
/context
/files
src/commands/add-dir/

### /copy: Copy Claude's last response to clipboard

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/copy
Daily Workflow
Copy Claude's last response to clipboard
How It Works
Copies Claude's most recent response to the system clipboard. Use
/copy N
for the Nth-latest response. Works across macOS (
pbcopy
), Linux (
xclip
/
xsel
), and Windows (
clip
).
src/commands/copy/

### /export: Export the current conversation to a file or clipboard

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/export
Daily Workflow
Export the current conversation to a file or clipboard
How It Works
Saves the current conversation as Markdown, JSON, or plain text. Can also copy to clipboard.
Related Commands
/share
src/commands/export/

### /summary: Generate a summary of the current session

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/summary
Daily Workflow
Generate a summary of the current session
How It Works
Produces a concise summary of what was accomplished in the current session: files changed, commands run, decisions made, and outstanding tasks.
Related Commands
/compact
/export
src/commands/summary/

### /clear: Clear conversation history and free up context

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/clear
Daily Workflow
Clear conversation history and free up context
How It Works
Resets the conversation context, removing all messages and loaded files. Starts fresh while keeping the same session. Does not affect persistent memory or
CLAUDE.md
files.
Related Commands
/compact
/session
src/commands/clear/

### /brief: Toggle brief response mode

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/brief
Daily Workflow
Toggle brief response mode
How It Works
Switches Claude between verbose and concise response styles. In brief mode, responses are shorter and more direct, skipping explanations and just showing results.
Related Commands
/output-style
src/commands/brief.ts

### /output-style: Deprecated: use /config to change output style

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/output-style
Daily Workflow
🔒 Feature-gated
Deprecated: use /config to change output style
How It Works
Deprecated and hidden. Use
/config
instead.
Related Commands
/brief
src/commands/output-style/

### /color: Set the prompt bar color for this session

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/color
Daily Workflow
Set the prompt bar color for this session
How It Works
Changes the color of the prompt bar. Takes a
<color|default>
argument.
Related Commands
/theme
src/commands/color/

### /vim: Toggle vim keybindings for input

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/vim
Daily Workflow
Toggle vim keybindings for input
How It Works
Turns on vi-style modal editing in the Claude Code input prompt. Supports normal, insert, and visual modes with common vim motions and commands.
Related Commands
/keybindings
src/commands/vim/

### /keybindings: View and customize keyboard shortcuts

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/keybindings
Daily Workflow
View and customize keyboard shortcuts
How It Works
Shows all active keyboard shortcuts and allows rebinding them. Supports emacs and vim-style bindings. Changes persist across sessions in user configuration.
Related Commands
/vim
src/commands/keybindings/

### /skills: List available skills

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/skills
Daily Workflow
List available skills
How It Works
Lists the skills available to the current session.
Related Commands
/agents
/memory
src/commands/skills/

### /tasks: Manage background tasks and parallel work

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/tasks
Daily Workflow
Manage background tasks and parallel work
How It Works
Lists, creates, monitors, and controls background tasks. Tasks run as independent Claude instances that can execute in parallel. Supports checking status, viewing output, and stopping tasks.
Related Commands
/agents
/plan
src/commands/tasks/

### /agents: Manage agent configurations

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/agents
Daily Workflow
Manage agent configurations
How It Works
Shows and lets you manage agent configurations for the current session.
Related Commands
/tasks
/ultraplan
src/commands/agents/

### /fast: Toggle fast mode for quicker responses

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/fast
Daily Workflow
Toggle fast mode for quicker responses
How It Works
Switches to a faster, smaller model for simple tasks. Lower latency and cost, but less capable.
Related Commands
/model
/effort
src/commands/fast/

### /effort: Set the thinking effort level

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/effort
Daily Workflow
Set the thinking effort level
How It Works
Controls how much compute Claude spends on reasoning. Lower effort means faster, cheaper responses. Higher effort gives deeper analysis for complex problems.
Related Commands
/fast
/model
src/commands/effort/

### /extra-usage: Configure extra usage provisioning

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/extra-usage
Daily Workflow
Configure extra usage provisioning
How It Works
Configures paid overage provisioning so you can keep working when monthly rate limits are hit. Prompts for login if needed.
Related Commands
/rate-limit-options
src/commands/extra-usage/

### /rate-limit-options: Show rate limit options dialog

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/rate-limit-options
Daily Workflow
Show rate limit options dialog
How It Works
Displays a menu when rate limits are reached, offering upgrade or extra-usage options. Invoked automatically when a limit is hit.
Related Commands
/extra-usage
src/commands/rate-limit-options/

### /review: Review a pull request

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/review
Code Review & Git
Review a pull request
How It Works
Reviews a pull request using
gh pr list
,
gh pr view
, and
gh pr diff
. Gives structured feedback on code quality, correctness, conventions, performance, testing, and security.
Related Commands
/security-review
/diff
src/commands/review.ts

### /commit: Generate a commit message and commit changes

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/commit
Code Review & Git
Generate a commit message and commit changes
How It Works
Analyzes staged changes to generate a conventional commit message. Follows the repository's commit conventions if defined in
CLAUDE.md
. Supports amending and interactive editing.
Flags / Options
--amend
--all
Related Commands
/commit-push-pr
/diff
src/commands/commit.ts

### /commit-push-pr: Commit, push, and create a pull request in one step

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/commit-push-pr
Code Review & Git
Commit, push, and create a pull request in one step
How It Works
Automates the full git workflow: stages changes, generates a commit message, pushes to a remote branch, and opens a pull request with an AI-generated description. Supports draft PRs.
Flags / Options
--draft
Related Commands
/commit
/branch
src/commands/commit-push-pr.ts

### /diff: View uncommitted changes and per-turn diffs

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/diff
Code Review & Git
View uncommitted changes and per-turn diffs
How It Works
Shows a formatted diff of uncommitted changes and per-turn diffs with syntax highlighting. Can compare working tree, staged changes, or between branches and commits.
Related Commands
/review
/commit
src/commands/diff/

### /pr_comments: View and respond to PR review comments

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/pr_comments
Code Review & Git
View and respond to PR review comments
How It Works
Fetches review comments from a GitHub pull request and displays them inline. Can generate responses to review feedback and push fixes for requested changes.
Related Commands
/review
/commit-push-pr
src/commands/pr_comments/

### /branch: Create a branch of the current conversation at this point

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/branch
Code Review & Git
Create a branch of the current conversation at this point
How It Works
Forks the current conversation transcript into a new session. Preserves all messages up to the current point. Alias:
/fork
(when the FORK_SUBAGENT flag is off). Takes an optional
[name]
argument.
Related Commands
/commit
/commit-push-pr
src/commands/branch/

### /issue: View and work on GitHub issues

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/issue
Code Review & Git
View and work on GitHub issues
How It Works
Fetches GitHub issue details and loads them into context. Can create implementation plans from issue descriptions and link commits to issues for automatic closing.
Related Commands
/pr_comments
/plan
src/commands/issue/

### /security-review: Run a security-focused code review

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/security-review
Code Review & Git
Run a security-focused code review
How It Works
Performs a deep security analysis of code changes, checking for OWASP Top 10 vulnerabilities, injection risks, authentication flaws, and data exposure. More thorough than a standard
/review
.
Related Commands
/review
src/commands/security-review.ts

### /autofix-pr: Disabled stub

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/autofix-pr
Code Review & Git
🔒 Feature-gated
Disabled stub
How It Works
Disabled stub command.
isEnabled
returns false and
isHidden
is true. No implementation.
Related Commands
/commit-push-pr
/review
src/commands/autofix-pr/

### /share: Disabled stub

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/share
Code Review & Git
Disabled stub
How It Works
Disabled stub command.
isEnabled
returns false and
isHidden
is true. No implementation.
Related Commands
/export
/copy
src/commands/share/

### /install-github-app: Set up Claude GitHub Actions for a repository

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/install-github-app
Code Review & Git
🔒 Feature-gated
Set up Claude GitHub Actions for a repository
How It Works
Walks you through setting up Claude GitHub Actions on a repository. Disabled by the
DISABLE_INSTALL_GITHUB_APP_COMMAND
env var.
Related Commands
/install-slack-app
src/commands/install-github-app/

### /install-slack-app: Install the Claude Code Slack App

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/install-slack-app
Code Review & Git
🔒 Feature-gated
Install the Claude Code Slack App
How It Works
Opens the Slack marketplace page for the Claude Code app. Tracks the install click in global config.
Related Commands
/install-github-app
src/commands/install-slack-app/

### /tag: Toggle a searchable tag on the current session

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/tag
Code Review & Git
Toggle a searchable tag on the current session
How It Works
Toggles a searchable tag on the current session so you can find it later. Internal-only (Anthropic employees). Takes a
<tag-name>
argument.
Related Commands
/branch
/commit
src/commands/tag/

### /status: Show Claude Code status

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/status
Debugging & Diagnostics
Show Claude Code status
How It Works
Shows version, model, account, API connectivity, and tool statuses.
Related Commands
/doctor
/stats
src/commands/status/

### /stats: Show token usage and performance statistics

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/stats
Debugging & Diagnostics
Show token usage and performance statistics
How It Works
Displays detailed metrics for the current session: tokens consumed, API calls made, cache hit rates, average latency, and per-tool usage breakdowns.
Related Commands
/cost
/usage
src/commands/stats/

### /cost: Show the cost of the current session

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/cost
Debugging & Diagnostics
Show the cost of the current session
How It Works
Calculates and displays the dollar cost of API usage in the current session. Breaks down costs by model, input vs output tokens, and cached vs uncached reads.
Related Commands
/stats
/usage
src/commands/cost/

### /usage: Show plan usage limits

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/usage
Debugging & Diagnostics
Show plan usage limits
How It Works
Shows your current plan usage limits and how much you've consumed. Only available for
claude-ai
subscribers.
Related Commands
/cost
/stats
src/commands/usage/

### /version: Show the installed Claude Code version

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/version
Debugging & Diagnostics
Show the installed Claude Code version
How It Works
Prints the current Claude Code version, build hash, and Node.js runtime version. Checks for available updates and shows the changelog for the latest release.
Related Commands
/upgrade
/release-notes
src/commands/version.ts

### /feedback: Send feedback to the Claude Code team

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/feedback
Debugging & Diagnostics
Send feedback to the Claude Code team
How It Works
Opens a feedback form that captures your message along with optional session context, system info, and reproduction steps. Feedback is sent directly to the development team.
src/commands/feedback/

### /think-back: Your 2025 Claude Code Year in Review

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/think-back
Debugging & Diagnostics
Your 2025 Claude Code Year in Review
How It Works
An annual review feature gated behind a Statsig flag. Shows your 2025 Claude Code usage in a generated presentation.
Related Commands
/thinkback-play
src/commands/thinkback/

### /thinkback-play: Play the thinkback animation

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/thinkback-play
Debugging & Diagnostics
Play the thinkback animation
How It Works
Hidden companion command to
/thinkback
. Plays back the generated review as an animation. Called by the thinkback skill after generation is complete.
Related Commands
/thinkback
src/commands/thinkback-play/

### /rewind: Restore code and/or conversation to a previous point

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/rewind
Debugging & Diagnostics
Restore code and/or conversation to a previous point
How It Works
Rolls back the code, the conversation, or both to an earlier checkpoint. Alias:
/checkpoint
.
Related Commands
/clear
src/commands/rewind/

### /ctx_viz: Disabled stub

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/ctx_viz
Debugging & Diagnostics
Disabled stub
How It Works
Disabled stub command.
isEnabled
returns false and
isHidden
is true. No implementation.
Related Commands
/files
/compact
src/commands/ctx_viz/

### /debug-tool-call: Debug a specific tool call by ID

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/debug-tool-call
Debugging & Diagnostics
Debug a specific tool call by ID
How It Works
Replays and inspects a previous tool call, showing the full input parameters, raw output, execution time, and any errors.
src/commands/debug-tool-call/

### /perf-issue: Disabled stub

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/perf-issue
Debugging & Diagnostics
Disabled stub
How It Works
Disabled stub command.
isEnabled
returns false and
isHidden
is true. No implementation.
Related Commands
/feedback
/heapdump
src/commands/perf-issue/

### /heapdump: Dump the JS heap to ~/Desktop

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/heapdump
Debugging & Diagnostics
Dump the JS heap to ~/Desktop
How It Works
Writes a V8 heap snapshot file to
~/Desktop
. Can be loaded in Chrome DevTools for memory analysis.
Related Commands
/perf-issue
src/commands/heapdump/

### /ant-trace: Disabled stub

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/ant-trace
Debugging & Diagnostics
Disabled stub
How It Works
Disabled stub command.
isEnabled
returns false and
isHidden
is true. No implementation.
Related Commands
/debug-tool-call
src/commands/ant-trace/

### /backfill-sessions: Disabled stub

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/backfill-sessions
Debugging & Diagnostics
🔒 Feature-gated
Disabled stub
How It Works
Disabled stub command.
isEnabled
returns false and
isHidden
is true. No implementation.
src/commands/backfill-sessions/

### /break-cache: Disabled stub

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/break-cache
Debugging & Diagnostics
🔒 Feature-gated
Disabled stub
How It Works
Disabled stub command.
isEnabled
returns false and
isHidden
is true. No implementation.
src/commands/break-cache/

### /bridge-kick: Inject bridge failure states for testing

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/bridge-kick
Debugging & Diagnostics
🔒 Feature-gated
Inject bridge failure states for testing
How It Works
Manually injects bridge transport failures (WebSocket close, poll errors, register timeouts) to test recovery and reconnection logic.
src/commands/bridge-kick.ts

### /mock-limits: Disabled stub

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/mock-limits
Debugging & Diagnostics
🔒 Feature-gated
Disabled stub
How It Works
Disabled stub command.
isEnabled
returns false and
isHidden
is true. No implementation.
src/commands/mock-limits/

### /oauth-refresh: Force refresh OAuth tokens

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/oauth-refresh
Debugging & Diagnostics
🔒 Feature-gated
Force refresh OAuth tokens
How It Works
Forces a token refresh for OAuth sessions.
src/commands/oauth-refresh/

### /reset-limits: Reset usage limit counters

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/reset-limits
Debugging & Diagnostics
🔒 Feature-gated
Reset usage limit counters
How It Works
Clears tracked usage counters.
src/commands/reset-limits/

### /env: Disabled stub

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/env
Debugging & Diagnostics
Disabled stub
How It Works
Disabled stub command.
isEnabled
returns false and
isHidden
is true. No implementation.
Related Commands
/config
/remote-env
src/commands/env/

### /bughunter: Disabled stub

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/bughunter
Debugging & Diagnostics
🔒 Feature-gated
Disabled stub
How It Works
Disabled stub command.
isEnabled
returns false and
isHidden
is true. No implementation.
Related Commands
/security-review
/review
src/commands/bughunter/

### /passes: Share a free week of Claude Code with friends

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/passes
Debugging & Diagnostics
🔒 Feature-gated
Share a free week of Claude Code with friends
How It Works
Referral system. Gives you a link to share a free week of Claude Code. If a referral reward is active, you also earn extra usage.
Related Commands
/review
/bughunter
src/commands/passes/

### /advisor: Configure the advisor model

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/advisor
Advanced & Experimental
Configure the advisor model
How It Works
Set or display which AI model gives asynchronous advice in the REPL. Checks model compatibility before applying.
Related Commands
/model
src/commands/advisor.ts

### /ultraplan: Run an advanced plan on Claude Code on the web

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/ultraplan
Advanced & Experimental
🔒 Feature-gated
Run an advanced plan on Claude Code on the web
How It Works
Takes 10-30 minutes. Sends the task to Claude Code on the web for deep planning. You can edit and approve the resulting plan. 30-minute timeout.
Related Commands
/plan
/agents
src/commands/ultraplan.tsx

### /remote-control: Connect this terminal for remote-control sessions

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/remote-control
Advanced & Experimental
🔒 Feature-gated
Connect this terminal for remote-control sessions
How It Works
Registers this terminal as a remote-control target. Requires the
BRIDGE_MODE
feature flag and bridge to be enabled. Alias:
/rc
.
Related Commands
/remote-setup
/teleport
src/commands/bridge/

### /teleport: Disabled stub

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/teleport
Advanced & Experimental
Disabled stub
How It Works
Disabled stub command.
isEnabled
returns false and
isHidden
is true. No implementation.
Related Commands
/bridge
/remote-setup
src/commands/teleport/

### /voice: Toggle voice mode

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/voice
Advanced & Experimental
🔒 Feature-gated
Toggle voice mode
How It Works
Switches voice input on or off. Behind growth experiment flags,
claude-ai
subscribers only.
src/commands/voice/

### /desktop: Continue the current session in Claude Desktop

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/desktop
Advanced & Experimental
🔒 Feature-gated
Continue the current session in Claude Desktop
How It Works
Hands off the current conversation to the Claude Desktop app. Supported on macOS and Windows x64.
Related Commands
/ide
src/commands/desktop/

### /chrome: Claude in Chrome (Beta) settings

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/chrome
Advanced & Experimental
🔒 Feature-gated
Claude in Chrome (Beta) settings
How It Works
Opens the settings for the Claude in Chrome beta feature. Only available for
claude-ai
subscribers in interactive sessions.
Related Commands
/mobile
src/commands/chrome/

### /mobile: Show QR code to download the Claude mobile app

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/mobile
Advanced & Experimental
🔒 Feature-gated
Show QR code to download the Claude mobile app
How It Works
Displays a QR code in the terminal linking to the Claude mobile app download. Aliases:
/ios
,
/android
.
Related Commands
/chrome
src/commands/mobile/

### /sandbox: Configure command sandboxing

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/sandbox
Advanced & Experimental
Configure command sandboxing
How It Works
Toggles sandbox mode for restricting command execution. Shows current sandbox status and lets you configure auto-allow, fallback, and exclusion patterns. Hidden on unsupported platforms.
Related Commands
/permissions
src/commands/sandbox-toggle/

### /plugin: Manage Claude Code plugins

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/plugin
Advanced & Experimental
Manage Claude Code plugins
How It Works
Manages Claude Code plugins. Aliases:
/plugins
,
/marketplace
.
Related Commands
/reload-plugins
/mcp
src/commands/plugin/

### /reload-plugins: Activate pending plugin changes

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/reload-plugins
Advanced & Experimental
Activate pending plugin changes
How It Works
Applies pending plugin changes to the running session. Non-interactive callers use
query.reloadPlugins()
instead.
Related Commands
/plugin
src/commands/reload-plugins/

### /web-setup: Setup Claude Code on the web

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/web-setup
Advanced & Experimental
Setup Claude Code on the web
How It Works
Connects your GitHub account to set up Claude Code on the web. Requires a growth experiment flag and the
allow_remote_sessions
policy.
Related Commands
/remote-env
/bridge
src/commands/remote-setup/

### /remote-env: Configure the default remote environment for teleport

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/remote-env
Advanced & Experimental
Configure the default remote environment for teleport
How It Works
Sets the default remote environment used for teleport sessions. Only shown to
claude-ai
subscribers with
allow_remote_sessions
enabled.
Related Commands
/remote-setup
src/commands/remote-env/

### /ide: Manage IDE integrations and show status

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/ide
Advanced & Experimental
Manage IDE integrations and show status
How It Works
Shows IDE integration status and configuration. Takes an optional
[open]
argument.
Related Commands
/terminal-setup
/desktop
src/commands/ide/

### /stickers: Order Claude Code stickers

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/stickers
Advanced & Experimental
Order Claude Code stickers
How It Works
Opens the StickerMule page for Claude Code stickers in your browser. That's it.
Related Commands
/good-claude
src/commands/stickers/

### /good-claude: Disabled stub

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/good-claude
Advanced & Experimental
Disabled stub
How It Works
Disabled stub command.
isEnabled
returns false and
isHidden
is true. No implementation.
Related Commands
/stickers
/feedback
src/commands/good-claude/

### /btw: Ask a quick side question without interrupting the main conversation

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/btw
Advanced & Experimental
Ask a quick side question without interrupting the main conversation
How It Works
Lets you ask something on the side while Claude keeps working on the main task. Takes a
<question>
argument.
src/commands/btw/

### /upgrade: Upgrade to Max for higher rate limits

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/upgrade
Advanced & Experimental
Upgrade to Max for higher rate limits
How It Works
Prompts you to upgrade your Claude subscription to the Max tier for higher rate limits and more Opus usage. Only shown to non-enterprise consumer subscribers.
Related Commands
/version
/release-notes
src/commands/upgrade/

### /release-notes: View release notes for the current version

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/release-notes
Advanced & Experimental
View release notes for the current version
How It Works
View release notes for the current version.
Related Commands
/version
/upgrade
src/commands/release-notes/

### /privacy-settings: Configure privacy and data sharing settings

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/privacy-settings
Advanced & Experimental
Configure privacy and data sharing settings
How It Works
View and update your privacy settings. Only shown to consumer subscribers.
Related Commands
/config
src/commands/privacy-settings/

### /help: Show available commands and usage information

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/help
Advanced & Experimental
Show available commands and usage information
How It Works
Displays a categorized list of all available slash commands with brief descriptions. Supports searching commands by name or keyword and showing detailed help for specific commands.
Related Commands
/onboarding
src/commands/help/

### /exit: Exit Claude Code

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/exit
Advanced & Experimental
Exit Claude Code
How It Works
Terminates the Claude Code session. Saves conversation history, flushes pending analytics, and cleans up background tasks and temporary files before exiting.
src/commands/exit/

### /rename: Rename the current conversation

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
/rename
Advanced & Experimental
Rename the current conversation
How It Works
Sets a custom name on the current chat session. Takes an optional
[name]
argument.
src/commands/rename/

## Hidden Features

### Buddy: A virtual pet that lives in your terminal. Species and rarity are derived from your account ID.

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
Buddy
A virtual pet that lives in your terminal. Species and rarity are derived from your account ID.
How It Works
Has sprites, animations, speech bubbles, personality traits. 18 species including
duck
,
owl
,
cat
,
penguin
,
dragon
,
axolotl
,
capybara
, and more. Rarity tiers from common to legendary.
Activation
Feature-flagged. When on, a small animated character shows up in the terminal and reacts to your session.
src/buddy/companion.ts
src/buddy/CompanionSprite.tsx
src/buddy/sprites.ts
src/buddy/prompt.ts

### Kairos: Persistent mode with memory consolidation between sessions and autonomous background actions.

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
Kairos
Persistent mode with memory consolidation between sessions and autonomous background actions.
How It Works
Consolidates memories between sessions (dream mode) and can act proactively in the background using a
SleepTool
. The proactive scheduling implementation was stripped from the public source.
Activation
Behind
KAIROS
feature flags. Dream consolidation runs as a post-session hook.
Connected To
Auto-Dream · memory system
src/memdir/
src/tools/SleepTool/

### UltraPlan: Long planning sessions on Opus-class models, up to 30-minute execution windows.

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
UltraPlan
Long planning sessions on Opus-class models, up to 30-minute execution windows.
How It Works
Runs on
Claude Opus 4.6
for deep planning. Supports polling execution and progress tracking. Users can teleport back to terminal when done.
Activation
The
/ultraplan
slash command. Needs specific feature flags.
Connected To
Coordinator Mode · multi-agent planning
src/commands/ultraplan.tsx

### Coordinator Mode: A lead agent breaks tasks apart, spawns parallel workers in isolated git worktrees, collects results.

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
Coordinator Mode
A lead agent breaks tasks apart, spawns parallel workers in isolated git worktrees, collects results.
How It Works
The lead agent decomposes work and spawns workers. Each worker gets its own git worktree for repository-level isolation. Worker implementation was stripped from the public source.
Activation
Toggle in
src/coordinator/
. The swarm logic itself is in
src/utils/swarm/
.
Connected To
UltraPlan · multi-agent planning
src/coordinator/
src/utils/swarm/
src/tools/AgentTool/AgentTool.ts
src/tools/TeamCreateTool/TeamCreateTool.ts

### Bridge: Control Claude Code from your phone or a browser. Full remote session with permission approvals.

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
Bridge
Control Claude Code from your phone or a browser. Full remote session with permission approvals.
How It Works
WebSocket
permission sync,
JWT
auth, session handoff between devices. The remote UI has a full permission approval workflow.
Activation
Needs a bridge server. The whole
src/bridge/
directory (31 files) implements it.
Connected To
Daemon Mode · remote + persistence
src/bridge/bridgeMain.ts
src/bridge/bridgeMessaging.ts
src/bridge/bridgePermissionCallbacks.ts
src/bridge/jwtUtils.ts
src/bridge/replBridge.ts

### Daemon Mode: Run sessions in the background with `--bg`. Uses `tmux` under the hood.

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
Daemon Mode
Run sessions in the background with
--bg
. Uses
tmux
under the hood.
How It Works
Claude Code runs as a background daemon via
tmux
. Sessions survive terminal closures. Talks to other sessions through UDS inbox.
Activation
Launch with
--bg
. Needs
tmux
installed.
Connected To
UDS Inbox · background execution
Bridge · remote + persistence
src/entrypoints/
src/tools/ScheduleCronTool/CronCreateTool.ts

### UDS Inbox: Sessions talk to each other over Unix domain sockets.

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
UDS Inbox
Sessions talk to each other over Unix domain sockets.
How It Works
One Claude Code instance can message another through
UDS
. Used by the Coordinator to dispatch work to parallel agents.
Activation
Works automatically when multiple sessions are running. The
SendMessage
tool uses it.
Connected To
Daemon Mode · background execution
src/tools/SendMessageTool/SendMessageTool.ts
src/remote/

### Auto-Dream: Between sessions, the AI reviews what happened and organizes what it learned.

×
SubscribePR
Experimental
🔒 Feature-gated
Subscribe to GitHub pull request events
How It Works
Only the name and
KAIROS_GITHUB_WEBHOOKS
feature flag are visible in the source — the implementation was stripped.
Parameters
owner
repo
prNumber
src/tools.ts
×
Auto-Dream
Between sessions, the AI reviews what happened and organizes what it learned.
How It Works
After a session ends, dream mode goes through the conversation, pulls out anything worth keeping, and writes it to the memory directory.
Activation
Runs as a post-session hook when enabled. Writes to
memdir/
storage.
Connected To
Kairos · memory system
src/services/autoDream/autoDream.ts
src/memdir/
src/hooks/
