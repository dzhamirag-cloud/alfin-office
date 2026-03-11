/**
 * OpenClaw Scanner — Discovers and watches OpenClaw agent sessions
 *
 * Reads agent definitions from ~/.openclaw/agents/, finds latest JSONL
 * session files, and watches them for real-time transcript updates.
 * Each agent gets its own pixel character in the office.
 */

import * as fs from 'fs';
import * as path from 'path';
import { discoverAgents, findLatestSession } from './openclawConfig.js';
import { processTranscriptLine } from './transcriptParser.js';
import type { TranscriptAgentState, TranscriptSink } from './transcriptParser.js';

const FILE_POLL_INTERVAL_MS = 2000;
const SESSION_SCAN_INTERVAL_MS = 3000;

export interface OpenClawScannerOptions {
  webview: TranscriptSink;
  onAgentCreated?: (agentId: number, name: string) => void;
}

interface ManagedAgent extends TranscriptAgentState {
  openclawId: string;
  jsonlFile: string;
  fileOffset: number;
  lineBuffer: string;
}

export class OpenClawScanner {
  private agents = new Map<number, ManagedAgent>();
  private fileWatchers = new Map<number, fs.FSWatcher>();
  private pollingTimers = new Map<number, ReturnType<typeof setInterval>>();
  private scanTimer: ReturnType<typeof setInterval> | null = null;
  private disposed = false;

  constructor(private readonly opts: OpenClawScannerOptions) {}

  /** Start discovering agents and watching sessions */
  start(): Map<number, ManagedAgent> {
    const agentDefs = discoverAgents();
    console.log(`[OpenClaw] Discovered ${agentDefs.length} agents`);

    for (let i = 0; i < agentDefs.length; i++) {
      const def = agentDefs[i];
      const pixelId = i + 1;
      const latestSession = findLatestSession(def.id);

      const agent: ManagedAgent = {
        id: pixelId,
        openclawId: def.id,
        jsonlFile: latestSession || '',
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
        model: 'sonnet',
        projectName: def.name,
        teamName: def.department,
      };

      this.agents.set(pixelId, agent);

      // Announce agent creation
      this.opts.webview.postMessage({ type: 'agentCreated', id: pixelId });
      this.opts.webview.postMessage({
        type: 'agentMeta',
        id: pixelId,
        projectName: def.name,
        model: def.id === 'main' ? 'opus' : 'sonnet',
        teamName: def.department,
      });
      this.opts.onAgentCreated?.(pixelId, def.name);

      // Start watching session file
      if (latestSession) {
        // Start from near end (last 4KB) for recent activity
        try {
          const stat = fs.statSync(latestSession);
          agent.fileOffset = Math.max(0, stat.size - 4096);
        } catch {
          /* start from beginning */
        }

        this.startWatching(pixelId, latestSession);
        console.log(`[OpenClaw] ${def.name} (${def.id}): watching ${path.basename(latestSession)}`);
      } else {
        console.log(`[OpenClaw] ${def.name} (${def.id}): no active session`);
      }
    }

    // Periodically check for new/changed session files
    this.scanTimer = setInterval(
      () => this.scanForNewSessions(agentDefs),
      SESSION_SCAN_INTERVAL_MS,
    );

    return this.agents;
  }

  /** Get all managed agents (for cliOrchestrator state sync) */
  getAgents(): Map<number, ManagedAgent> {
    return this.agents;
  }

  dispose(): void {
    this.disposed = true;
    if (this.scanTimer) {
      clearInterval(this.scanTimer);
      this.scanTimer = null;
    }
    for (const w of this.fileWatchers.values()) w.close();
    this.fileWatchers.clear();
    for (const t of this.pollingTimers.values()) clearInterval(t);
    this.pollingTimers.clear();
  }

  // ── Private ──────────────────────────────────────────────

  private startWatching(pixelId: number, filePath: string): void {
    // fs.watch for instant detection
    try {
      const watcher = fs.watch(filePath, () => {
        this.readNewLines(pixelId);
      });
      this.fileWatchers.set(pixelId, watcher);
    } catch (e) {
      console.log(`[OpenClaw] fs.watch failed for agent ${pixelId}: ${e}`);
    }

    // Polling fallback for reliability
    const interval = setInterval(() => {
      if (!this.agents.has(pixelId)) {
        clearInterval(interval);
        return;
      }
      this.readNewLines(pixelId);
    }, FILE_POLL_INTERVAL_MS);
    this.pollingTimers.set(pixelId, interval);

    // Initial read
    this.readNewLines(pixelId);
  }

  private readNewLines(pixelId: number): void {
    const agent = this.agents.get(pixelId);
    if (!agent || !agent.jsonlFile) return;

    try {
      const stat = fs.statSync(agent.jsonlFile);
      if (stat.size <= agent.fileOffset) return;

      const buf = Buffer.alloc(stat.size - agent.fileOffset);
      const fd = fs.openSync(agent.jsonlFile, 'r');
      fs.readSync(fd, buf, 0, buf.length, agent.fileOffset);
      fs.closeSync(fd);
      agent.fileOffset = stat.size;

      const text = agent.lineBuffer + buf.toString('utf-8');
      const lines = text.split('\n');
      agent.lineBuffer = lines.pop() || '';

      // Cast to the type expected by processTranscriptLine
      const agentsMap = this.agents as unknown as Map<number, TranscriptAgentState>;

      for (const line of lines) {
        if (!line.trim()) continue;
        processTranscriptLine(pixelId, line, agentsMap, this.opts.webview);
      }
    } catch {
      // File might be temporarily locked
    }
  }

  private scanForNewSessions(agentDefs: ReturnType<typeof discoverAgents>): void {
    for (let i = 0; i < agentDefs.length; i++) {
      const def = agentDefs[i];
      const pixelId = i + 1;
      const agent = this.agents.get(pixelId);
      if (!agent) continue;

      const latestSession = findLatestSession(def.id);
      if (latestSession && latestSession !== agent.jsonlFile) {
        console.log(`[OpenClaw] ${def.name}: new session → ${path.basename(latestSession)}`);

        // Clean up old watcher
        this.fileWatchers.get(pixelId)?.close();
        this.fileWatchers.delete(pixelId);
        const pt = this.pollingTimers.get(pixelId);
        if (pt) clearInterval(pt);
        this.pollingTimers.delete(pixelId);

        // Update and watch new file
        agent.jsonlFile = latestSession;
        agent.fileOffset = 0;
        agent.lineBuffer = '';
        this.startWatching(pixelId, latestSession);
      }
    }
  }
}
