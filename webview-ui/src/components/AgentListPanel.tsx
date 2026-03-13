import { useEffect, useRef, useState } from 'react';

import type { SubagentCharacter } from '../hooks/useExtensionMessages.js';
import type { OfficeState } from '../office/engine/officeState.js';
import { getCharacterSprite } from '../office/engine/characters.js';
import { getCharacterSprites } from '../office/sprites/spriteData.js';
import type { SpriteData, ToolActivity } from '../office/types.js';

interface AgentListPanelProps {
  officeState: OfficeState;
  agents: number[];
  agentStatuses: Record<number, string>;
  agentTools: Record<number, ToolActivity[]>;
  subagentCharacters: SubagentCharacter[];
  onFollowAgent: (id: number) => void;
  onClose: () => void;
}

const AVATAR_ZOOM = 4;

/** Renders a character's current sprite as a small canvas preview */
function AgentAvatar({ sprite }: { sprite: SpriteData }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rows = sprite.length;
    const cols = sprite[0]?.length || 0;
    canvas.width = cols * AVATAR_ZOOM;
    canvas.height = rows * AVATAR_ZOOM;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        const color = sprite[r][c];
        if (color === '') continue;
        ctx.fillStyle = color;
        ctx.fillRect(c * AVATAR_ZOOM, r * AVATAR_ZOOM, AVATAR_ZOOM, AVATAR_ZOOM);
      }
    }
  }, [sprite]);

  return (
    <canvas
      ref={canvasRef}
      style={{
        imageRendering: 'pixelated',
        flexShrink: 0,
      }}
    />
  );
}

function teamColor(name: string): string {
  let hash = 0;
  for (let i = 0; i < name.length; i++) {
    hash = name.charCodeAt(i) + ((hash << 5) - hash);
  }
  const hue = ((hash % 360) + 360) % 360;
  return `hsl(${hue}, 70%, 65%)`;
}

const TOOL_DISPLAY: Record<string, string> = {
  Read: 'Читает...',
  Write: 'Пишет...',
  Edit: 'Редактирует...',
  Bash: 'Выполняет...',
  Grep: 'Ищет в коде...',
  Glob: 'Ищет файлы...',
  WebFetch: 'Загружает...',
  WebSearch: 'Ищет в интернете...',
  Task: 'Делегирует...',
};

const panelBtnStyle: React.CSSProperties = {
  padding: '3px 10px',
  fontSize: '20px',
  background: 'rgba(255,255,255,0.08)',
  color: 'rgba(255,255,255,0.7)',
  border: '1px solid rgba(255,255,255,0.15)',
  borderRadius: 0,
  cursor: 'pointer',
};

const metaLabelStyle: React.CSSProperties = {
  fontSize: '16px',
  color: 'rgba(255,255,255,0.35)',
};

const metaValueStyle: React.CSSProperties = {
  fontSize: '18px',
  color: 'rgba(255,255,255,0.6)',
};

export function AgentListPanel({
  officeState,
  agents,
  agentStatuses,
  agentTools,
  subagentCharacters,
  onFollowAgent,
  onClose,
}: AgentListPanelProps) {
  const [hoveredBtn, setHoveredBtn] = useState<string | null>(null);

  // Periodic re-render to sync with imperative OfficeState changes
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  // Build sub-agent map: parentId -> sub-agents
  const subsByParent = new Map<number, SubagentCharacter[]>();
  for (const sub of subagentCharacters) {
    const list = subsByParent.get(sub.parentAgentId) || [];
    list.push(sub);
    subsByParent.set(sub.parentAgentId, list);
  }

  return (
    <div
      style={{
        position: 'absolute',
        right: 0,
        top: 0,
        bottom: 0,
        width: 320,
        zIndex: 55,
        background: 'var(--pixel-bg)',
        borderLeft: '2px solid var(--pixel-border)',
        boxShadow: '-2px 0 0 #0a0a14',
        display: 'flex',
        flexDirection: 'column',
        overflow: 'hidden',
      }}
    >
      {/* Header */}
      <div
        style={{
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          padding: '8px 12px',
          borderBottom: '2px solid var(--pixel-border)',
        }}
      >
        <span style={{ fontSize: '26px', color: 'var(--pixel-text)' }}>Agents</span>
        <button
          onClick={onClose}
          style={{
            background: 'none',
            border: 'none',
            color: 'var(--pixel-close-text)',
            cursor: 'pointer',
            fontSize: '26px',
            padding: '0 4px',
            lineHeight: 1,
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.color = 'var(--pixel-close-hover)';
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.color = 'var(--pixel-close-text)';
          }}
        >
          ×
        </button>
      </div>

      {/* Agent list */}
      <div style={{ flex: 1, overflowY: 'auto', padding: '4px 0' }}>
        {agents.length === 0 ? (
          <div style={{ padding: '12px', fontSize: '22px', color: 'rgba(255,255,255,0.4)' }}>
            Нет активных агентов
          </div>
        ) : (
          agents.map((id) => {
            const ch = officeState.characters.get(id);
            if (!ch) return null;
            const status = agentStatuses[id];
            const isActive = ch.isActive;
            const isWaiting = status === 'waiting';
            const subs = subsByParent.get(id) || [];

            // Current activity
            const tools = agentTools[id];
            const activeTool = tools && [...tools].reverse().find((t) => !t.done);
            const toolName = ch.currentTool;
            const activityText = activeTool
              ? activeTool.status
              : (toolName && TOOL_DISPLAY[toolName]) || (isActive ? 'Работает...' : 'Свободен');

            return (
              <div
                key={id}
                style={{
                  borderBottom: '2px solid rgba(255,255,255,0.06)',
                  padding: '8px 12px',
                  display: 'flex',
                  gap: 10,
                  alignItems: 'center',
                }}
              >
                {/* Avatar preview — large */}
                <div style={{ flexShrink: 0, display: 'flex', alignItems: 'center' }}>
                  {(() => {
                    const sprites = getCharacterSprites(ch.palette, ch.hueShift);
                    const spriteData = getCharacterSprite(ch, sprites);
                    return <AgentAvatar sprite={spriteData} />;
                  })()}
                </div>

                {/* Right side: name, team, activity, follow */}
                <div
                  style={{ flex: 1, minWidth: 0, display: 'flex', flexDirection: 'column', gap: 2 }}
                >
                  {/* Name + status dot */}
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span
                      style={{
                        width: 8,
                        height: 8,
                        borderRadius: '50%',
                        background: isWaiting
                          ? 'var(--pixel-status-permission)'
                          : isActive
                            ? 'var(--pixel-status-active)'
                            : 'rgba(255,255,255,0.2)',
                        flexShrink: 0,
                      }}
                    />
                    <span
                      style={{
                        fontSize: '24px',
                        color: 'rgba(255,255,255,0.9)',
                        overflow: 'hidden',
                        textOverflow: 'ellipsis',
                        whiteSpace: 'nowrap',
                        flex: 1,
                      }}
                    >
                      {ch.projectName || `Agent #${id}`}
                    </span>
                  </div>

                  {/* Team */}
                  {ch.teamName && (
                    <div style={{ display: 'flex', gap: 6, alignItems: 'baseline' }}>
                      <span style={metaLabelStyle}>team</span>
                      <span style={{ ...metaValueStyle, color: teamColor(ch.teamName) }}>
                        {ch.teamName}
                      </span>
                    </div>
                  )}

                  {/* Activity */}
                  <div
                    style={{
                      fontSize: '20px',
                      color: isActive ? 'rgba(255,255,255,0.6)' : 'rgba(255,255,255,0.25)',
                      fontStyle: 'italic',
                      overflow: 'hidden',
                      textOverflow: 'ellipsis',
                      whiteSpace: 'nowrap',
                    }}
                  >
                    {activityText}
                  </div>

                  {/* Follow button */}
                  <div style={{ display: 'flex', gap: 4, marginTop: 2 }}>
                    <button
                      style={{
                        ...panelBtnStyle,
                        background:
                          hoveredBtn === `follow-${id}`
                            ? 'rgba(255,255,255,0.15)'
                            : panelBtnStyle.background,
                      }}
                      onMouseEnter={() => setHoveredBtn(`follow-${id}`)}
                      onMouseLeave={() => setHoveredBtn(null)}
                      onClick={() => onFollowAgent(id)}
                    >
                      Follow
                    </button>
                  </div>
                </div>

                {/* Sub-agents */}
                {subs.length > 0 && (
                  <div
                    style={{
                      marginTop: 6,
                      paddingLeft: 14,
                      borderTop: '1px solid rgba(255,255,255,0.04)',
                      paddingTop: 4,
                    }}
                  >
                    {subs.map((sub) => {
                      const subCh = officeState.characters.get(sub.id);
                      const subActive = subCh?.isActive;
                      const subToolName = subCh?.currentTool;
                      const subActivity = subToolName && TOOL_DISPLAY[subToolName];
                      return (
                        <div
                          key={sub.id}
                          style={{
                            display: 'flex',
                            alignItems: 'center',
                            gap: 6,
                            padding: '2px 0',
                          }}
                        >
                          <span
                            style={{
                              width: 5,
                              height: 5,
                              borderRadius: '50%',
                              background: subActive
                                ? 'var(--pixel-status-active)'
                                : 'rgba(255,255,255,0.15)',
                              flexShrink: 0,
                            }}
                          />
                          <span
                            style={{
                              fontSize: '20px',
                              color: 'rgba(255,255,255,0.55)',
                              fontStyle: 'italic',
                              overflow: 'hidden',
                              textOverflow: 'ellipsis',
                              whiteSpace: 'nowrap',
                              flex: 1,
                            }}
                          >
                            {sub.label}
                          </span>
                          {subActivity && (
                            <span
                              style={{
                                fontSize: '16px',
                                color: 'rgba(255,255,255,0.3)',
                                flexShrink: 0,
                              }}
                            >
                              {subActivity}
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
