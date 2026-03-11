/**
 * Session Scanner — Detects Claude Code CLI sessions by watching ~/.claude/projects/
 *
 * On startup, seeds all existing JSONL files as "known" (no agents for old sessions).
 * Polls every 2s for new JSONL files across all project directories.
 * When a new JSONL appears → creates an agent and starts file watching.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import type { AgentState } from '../src/types.js';
import { startFileWatching, readNewLines } from '../src/fileWatcher.js';

const CLAUDE_PROJECTS_DIR = path.join(os.homedir(), '.claude', 'projects');
const SCAN_INTERVAL_MS = 2000;
/** Only create agents for JSONL files modified within this window */
const MAX_AGE_MS = 30_000;

export interface SessionScannerOptions {
  agents: Map<number, AgentState>;
  nextAgentId: { current: number };
  knownJsonlFiles: Set<string>;
  fileWatchers: Map<number, fs.FSWatcher>;
  pollingTimers: Map<number, ReturnType<typeof setInterval>>;
  waitingTimers: Map<number, ReturnType<typeof setTimeout>>;
  permissionTimers: Map<number, ReturnType<typeof setTimeout>>;
  webview: { postMessage(msg: unknown): void } | undefined;
  onAgentCreated: (agentId: number, folderName: string) => void;
}

/** Derive a short readable name from the encoded directory name */
function decodeFolderName(dirName: string): string {
  const parts = dirName.split('-').filter(Boolean);
  return parts[parts.length - 1] || dirName;
}

/** Collect all JSONL file paths under ~/.claude/projects/ */
function collectJsonlFiles(): string[] {
  const files: string[] = [];
  try {
    if (!fs.existsSync(CLAUDE_PROJECTS_DIR)) return files;
    const projectDirs = fs.readdirSync(CLAUDE_PROJECTS_DIR);
    for (const dirName of projectDirs) {
      const dirPath = path.join(CLAUDE_PROJECTS_DIR, dirName);
      try {
        if (!fs.statSync(dirPath).isDirectory()) continue;
        for (const f of fs.readdirSync(dirPath)) {
          if (f.endsWith('.jsonl')) {
            files.push(path.join(dirPath, f));
          }
        }
      } catch {
        /* skip inaccessible dirs */
      }
    }
  } catch {
    /* projects dir may not exist */
  }
  return files;
}

export function startSessionScanner(opts: SessionScannerOptions): { dispose(): void } {
  const { knownJsonlFiles } = opts;

  // Seed all existing JSONL files on startup (don't create agents for old sessions)
  for (const f of collectJsonlFiles()) {
    knownJsonlFiles.add(f);
  }

  const timer = setInterval(() => scanForNewSessions(opts), SCAN_INTERVAL_MS);
  return { dispose: () => clearInterval(timer) };
}

function scanForNewSessions(opts: SessionScannerOptions): void {
  const {
    agents,
    nextAgentId,
    knownJsonlFiles,
    fileWatchers,
    pollingTimers,
    waitingTimers,
    permissionTimers,
    onAgentCreated,
  } = opts;

  for (const file of collectJsonlFiles()) {
    if (knownJsonlFiles.has(file)) continue;
    knownJsonlFiles.add(file);

    // Only create agents for recently modified files
    try {
      const fstat = fs.statSync(file);
      if (Date.now() - fstat.mtimeMs > MAX_AGE_MS) continue;
    } catch {
      continue;
    }

    const dirName = path.basename(path.dirname(file));
    const id = nextAgentId.current++;
    const folderName = decodeFolderName(dirName);
    const agent: AgentState = {
      id,
      projectDir: path.dirname(file),
      jsonlFile: file,
      fileOffset: 0,
      lineBuffer: '',
      activeToolIds: new Set(),
      activeToolStatuses: new Map(),
      activeToolNames: new Map(),
      activeSubagentToolIds: new Map(),
      activeSubagentToolNames: new Map(),
      isWaiting: false,
      permissionSent: false,
      hadToolsInTurn: false,
      folderName,
    };

    agents.set(id, agent);
    console.log(`[CLI] New session: ${path.basename(file)} in ${dirName} → agent ${id}`);
    onAgentCreated(id, folderName);

    startFileWatching(
      id,
      file,
      agents,
      fileWatchers,
      pollingTimers,
      waitingTimers,
      permissionTimers,
      opts.webview as never,
    );
    readNewLines(id, agents, waitingTimers, permissionTimers, opts.webview as never);
  }
}
