/**
 * OpenClaw Transcript Parser
 *
 * Parses Claude Code JSONL transcript lines and translates them into
 * webview messages (agentToolStart, agentToolDone, agentStatus, etc.).
 *
 * This is the same format used by Claude Code sessions — OpenClaw stores
 * transcripts in the same JSONL format under ~/.openclaw/agents/<id>/sessions/.
 */

import * as path from 'path';

export interface TranscriptSink {
  postMessage(msg: unknown): void;
}

export interface TranscriptAgentState {
  id: number;
  activeToolIds: Set<string>;
  activeToolStatuses: Map<string, string>;
  activeToolNames: Map<string, string>;
  activeSubagentToolIds: Map<string, Set<string>>;
  activeSubagentToolNames: Map<string, Map<string, string>>;
  isWaiting: boolean;
  permissionSent: boolean;
  hadToolsInTurn: boolean;
  model?: string;
  projectName?: string;
  teamName?: string;
}

// ── Constants ────────────────────────────────────────────────

const TOOL_DONE_DELAY_MS = 300;
const TEXT_IDLE_DELAY_MS = 5000;
const PERMISSION_TIMER_DELAY_MS = 7000;
const BASH_CMD_MAX_LEN = 30;
const TASK_DESC_MAX_LEN = 40;

const PERMISSION_EXEMPT_TOOLS = new Set(['Task', 'AskUserQuestion']);

// ── Tool status formatting ───────────────────────────────────

function extractShortModelName(model: string): string {
  if (model.includes('opus')) return 'opus';
  if (model.includes('sonnet')) return 'sonnet';
  if (model.includes('haiku')) return 'haiku';
  return model;
}

function formatToolStatus(toolName: string, input: Record<string, unknown>): string {
  const base = (p: unknown) => (typeof p === 'string' ? path.basename(p) : '');
  switch (toolName) {
    case 'Read':
      return `Читает ${base(input.file_path)}`;
    case 'Edit':
      return `Редактирует ${base(input.file_path)}`;
    case 'Write':
      return `Пишет ${base(input.file_path)}`;
    case 'Bash': {
      const cmd = (input.command as string) || '';
      return `Выполняет: ${cmd.length > BASH_CMD_MAX_LEN ? cmd.slice(0, BASH_CMD_MAX_LEN) + '\u2026' : cmd}`;
    }
    case 'Glob':
      return 'Ищет файлы';
    case 'Grep':
      return 'Ищет в коде';
    case 'WebFetch':
      return 'Загружает страницу';
    case 'WebSearch':
      return 'Ищет в интернете';
    case 'Task': {
      const desc = typeof input.description === 'string' ? input.description : '';
      return desc
        ? `Подзадача: ${desc.length > TASK_DESC_MAX_LEN ? desc.slice(0, TASK_DESC_MAX_LEN) + '\u2026' : desc}`
        : 'Выполняет подзадачу';
    }
    case 'AskUserQuestion':
      return 'Ждёт ответа';
    case 'EnterPlanMode':
      return 'Планирует';
    case 'NotebookEdit':
      return 'Редактирует notebook';
    default:
      return `Использует ${toolName}`;
  }
}

// ── Timer management (inline, self-contained) ────────────────

const waitingTimers = new Map<number, ReturnType<typeof setTimeout>>();
const permissionTimers = new Map<number, ReturnType<typeof setTimeout>>();

function cancelWaitingTimer(agentId: number): void {
  const t = waitingTimers.get(agentId);
  if (t) {
    clearTimeout(t);
    waitingTimers.delete(agentId);
  }
}

function cancelPermissionTimer(agentId: number): void {
  const t = permissionTimers.get(agentId);
  if (t) {
    clearTimeout(t);
    permissionTimers.delete(agentId);
  }
}

function startWaitingTimer(
  agentId: number,
  agents: Map<number, TranscriptAgentState>,
  sink: TranscriptSink | undefined,
): void {
  cancelWaitingTimer(agentId);
  const timer = setTimeout(() => {
    waitingTimers.delete(agentId);
    const agent = agents.get(agentId);
    if (agent) agent.isWaiting = true;
    sink?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
  }, TEXT_IDLE_DELAY_MS);
  waitingTimers.set(agentId, timer);
}

function startPermissionTimer(
  agentId: number,
  agents: Map<number, TranscriptAgentState>,
  sink: TranscriptSink | undefined,
): void {
  cancelPermissionTimer(agentId);
  const timer = setTimeout(() => {
    permissionTimers.delete(agentId);
    const agent = agents.get(agentId);
    if (!agent) return;

    let hasNonExempt = false;
    for (const toolId of agent.activeToolIds) {
      const toolName = agent.activeToolNames.get(toolId);
      if (!PERMISSION_EXEMPT_TOOLS.has(toolName || '')) {
        hasNonExempt = true;
        break;
      }
    }
    if (hasNonExempt) {
      agent.permissionSent = true;
      sink?.postMessage({ type: 'agentToolPermission', id: agentId });
    }
  }, PERMISSION_TIMER_DELAY_MS);
  permissionTimers.set(agentId, timer);
}

function clearAgentActivity(
  agent: TranscriptAgentState,
  agentId: number,
  sink: TranscriptSink | undefined,
): void {
  agent.activeToolIds.clear();
  agent.activeToolStatuses.clear();
  agent.activeToolNames.clear();
  agent.activeSubagentToolIds.clear();
  agent.activeSubagentToolNames.clear();
  agent.isWaiting = false;
  agent.permissionSent = false;
  cancelPermissionTimer(agentId);
  sink?.postMessage({ type: 'agentToolsClear', id: agentId });
  sink?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });
}

// ── Main parser ──────────────────────────────────────────────

export function processTranscriptLine(
  agentId: number,
  line: string,
  agents: Map<number, TranscriptAgentState>,
  sink: TranscriptSink | undefined,
): void {
  const agent = agents.get(agentId);
  if (!agent) return;

  try {
    const record = JSON.parse(line);

    // Support both old format (type='assistant') and new OpenClaw format (type='message', role='assistant')
    const role = record.type === 'message' ? record.message?.role : record.type;
    const isAssistant = role === 'assistant';
    const isUser = role === 'user' || role === 'toolResult';

    if (isAssistant && Array.isArray(record.message?.content)) {
      // Extract model
      const rawModel = record.message?.model as string | undefined;
      if (rawModel) {
        const shortModel = extractShortModelName(rawModel);
        if (shortModel !== agent.model) {
          agent.model = shortModel;
          sink?.postMessage({ type: 'agentMeta', id: agentId, model: agent.model });
        }
      }

      const blocks = record.message.content as Array<{
        type: string;
        id?: string;
        name?: string;
        text?: string;
        input?: Record<string, unknown>;
      }>;
      const hasToolUse = blocks.some((b) => b.type === 'tool_use' || b.type === 'toolCall');

      // Extract text blocks and send as speech bubble
      for (const block of blocks) {
        if (block.type === 'text' && block.text) {
          const snippet = block.text.trim();
          if (snippet.length > 0) {
            // Take first line, truncate to ~80 chars
            const firstLine = snippet.split('\n')[0];
            const display = firstLine.length > 80 ? firstLine.slice(0, 80) + '…' : firstLine;
            sink?.postMessage({ type: 'agentSpeech', id: agentId, text: display });
          }
        }
      }

      if (hasToolUse) {
        cancelWaitingTimer(agentId);
        agent.isWaiting = false;
        agent.hadToolsInTurn = true;
        sink?.postMessage({ type: 'agentStatus', id: agentId, status: 'active' });

        let hasNonExemptTool = false;
        for (const block of blocks) {
          if ((block.type === 'tool_use' || block.type === 'toolCall') && block.id) {
            const toolName = block.name || '';
            const status = formatToolStatus(
              toolName,
              (block.input || block.arguments || {}) as Record<string, unknown>,
            );
            agent.activeToolIds.add(block.id);
            agent.activeToolStatuses.set(block.id, status);
            agent.activeToolNames.set(block.id, toolName);
            if (!PERMISSION_EXEMPT_TOOLS.has(toolName)) {
              hasNonExemptTool = true;
            }
            sink?.postMessage({
              type: 'agentToolStart',
              id: agentId,
              toolId: block.id,
              status,
            });
          }
        }
        if (hasNonExemptTool) {
          startPermissionTimer(agentId, agents, sink);
        }
      } else if (blocks.some((b) => b.type === 'text') && !agent.hadToolsInTurn) {
        startWaitingTimer(agentId, agents, sink);
      }
    } else if (isUser) {
      const content = record.message?.content;

      // Handle OpenClaw format: role='toolResult' with toolCallId at message level
      if (role === 'toolResult' && record.message?.toolCallId) {
        const toolId = record.message.toolCallId as string;
        agent.activeToolIds.delete(toolId);
        agent.activeToolStatuses.delete(toolId);
        agent.activeToolNames.delete(toolId);
        setTimeout(() => {
          sink?.postMessage({ type: 'agentToolDone', id: agentId, toolId });
        }, TOOL_DONE_DELAY_MS);
        if (agent.activeToolIds.size === 0) {
          agent.hadToolsInTurn = false;
        }
      } else if (Array.isArray(content)) {
        const blocks = content as Array<{ type: string; tool_use_id?: string }>;
        const hasToolResult = blocks.some(
          (b) => b.type === 'tool_result' || b.type === 'toolResult',
        );
        if (hasToolResult) {
          for (const block of blocks) {
            if (
              (block.type === 'tool_result' || block.type === 'toolResult') &&
              block.tool_use_id
            ) {
              const toolId = block.tool_use_id;
              agent.activeToolIds.delete(toolId);
              agent.activeToolStatuses.delete(toolId);
              agent.activeToolNames.delete(toolId);
              setTimeout(() => {
                sink?.postMessage({ type: 'agentToolDone', id: agentId, toolId });
              }, TOOL_DONE_DELAY_MS);
            }
          }
          if (agent.activeToolIds.size === 0) {
            agent.hadToolsInTurn = false;
          }
        } else {
          cancelWaitingTimer(agentId);
          clearAgentActivity(agent, agentId, sink);
          agent.hadToolsInTurn = false;
        }
      } else if (typeof content === 'string' && content.trim()) {
        cancelWaitingTimer(agentId);
        clearAgentActivity(agent, agentId, sink);
        agent.hadToolsInTurn = false;
      }
    } else if (record.type === 'system' && record.subtype === 'turn_duration') {
      cancelWaitingTimer(agentId);
      cancelPermissionTimer(agentId);

      if (agent.activeToolIds.size > 0) {
        agent.activeToolIds.clear();
        agent.activeToolStatuses.clear();
        agent.activeToolNames.clear();
        agent.activeSubagentToolIds.clear();
        agent.activeSubagentToolNames.clear();
        sink?.postMessage({ type: 'agentToolsClear', id: agentId });
      }

      agent.isWaiting = true;
      agent.permissionSent = false;
      agent.hadToolsInTurn = false;
      sink?.postMessage({ type: 'agentStatus', id: agentId, status: 'waiting' });
    }
  } catch {
    // Ignore malformed lines
  }
}
