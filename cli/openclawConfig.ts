/**
 * OpenClaw Agent Configuration
 *
 * Maps OpenClaw agent IDs to display names, departments, and character skins.
 * Auto-discovers agents from ~/.openclaw/agents/ when no hardcoded config matches.
 */

import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

export interface AgentDef {
  id: string;
  name: string;
  department: string;
  characterIndex: number; // 0-5 base skin, >5 will get hue-shifted
  emoji?: string;
}

const OPENCLAW_BASE = path.join(os.homedir(), '.openclaw');

/**
 * Discover agents from ~/.openclaw/agents/ directory.
 * Reads each agent's config to extract name/description if available.
 */
export function discoverAgents(): AgentDef[] {
  const agentsDir = path.join(OPENCLAW_BASE, 'agents');
  if (!fs.existsSync(agentsDir)) {
    console.log('[OpenClaw] No agents directory found at:', agentsDir);
    return [];
  }

  const agents: AgentDef[] = [];
  let charIndex = 0;

  try {
    const dirs = fs.readdirSync(agentsDir).sort();
    for (const dirName of dirs) {
      const dirPath = path.join(agentsDir, dirName);
      try {
        if (!fs.statSync(dirPath).isDirectory()) continue;
      } catch {
        continue;
      }

      // Try to read agent config for name/description
      let name = dirName;
      let department = 'General';
      const configPath = path.join(dirPath, 'config.yaml');
      if (fs.existsSync(configPath)) {
        try {
          const content = fs.readFileSync(configPath, 'utf-8');
          // Simple YAML parsing for name/description
          const nameMatch = content.match(/^name:\s*["']?(.+?)["']?\s*$/m);
          if (nameMatch) name = nameMatch[1];
          const descMatch = content.match(/^description:\s*["']?(.+?)["']?\s*$/m);
          if (descMatch) department = descMatch[1];
        } catch {
          /* use defaults */
        }
      }

      agents.push({
        id: dirName,
        name,
        department,
        characterIndex: charIndex++,
      });
    }
  } catch (err) {
    console.error('[OpenClaw] Error reading agents directory:', err);
  }

  return agents;
}

/**
 * Get the path to the most recent JSONL session file for an agent.
 */
export function findLatestSession(agentId: string): string | null {
  const sessionsDir = path.join(OPENCLAW_BASE, 'agents', agentId, 'sessions');
  if (!fs.existsSync(sessionsDir)) return null;

  let latest: { path: string; mtime: number } | null = null;
  try {
    const files = fs.readdirSync(sessionsDir).filter((f) => f.endsWith('.jsonl'));
    for (const file of files) {
      const fullPath = path.join(sessionsDir, file);
      try {
        const stat = fs.statSync(fullPath);
        if (!latest || stat.mtimeMs > latest.mtime) {
          latest = { path: fullPath, mtime: stat.mtimeMs };
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* dir may not exist */
  }

  return latest?.path ?? null;
}

/**
 * Extract agent ID from a file path.
 * Path format: ~/.openclaw/agents/<agentId>/sessions/<uuid>.jsonl
 */
export function getAgentIdFromPath(filePath: string): string | null {
  const match = filePath.match(/agents\/([^/]+)\/sessions\//);
  return match ? match[1] : null;
}
