import { useEffect, useState } from 'react';

import { BUBBLE_SITTING_OFFSET_PX } from '../../constants.js';
import type { OfficeState } from '../engine/officeState.js';
import type { ToolActivity } from '../types.js';
import { CharacterState, TILE_SIZE } from '../types.js';

const BUBBLE_Y_OFFSET = 30; // pixels above character head (sprite coords)

// CSS for spinning gear
const gearKeyframes = `
@keyframes pixel-gear-spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
`;

/** Inline style sheet injection (once) */
let styleInjected = false;
function injectStyles(): void {
  if (styleInjected) return;
  const style = document.createElement('style');
  style.textContent = gearKeyframes;
  document.head.appendChild(style);
  styleInjected = true;
}

/** 9×9 pixel gear as a data URL */
function getGearDataUrl(): string {
  const canvas = document.createElement('canvas');
  canvas.width = 9;
  canvas.height = 9;
  const ctx = canvas.getContext('2d')!;

  const pixels: Array<[number, number, string]> = [
    // Row 0: teeth top
    [3, 0, '#5a5a6a'],
    [4, 0, '#6a6a7a'],
    [5, 0, '#5a5a6a'],
    // Row 1
    [1, 1, '#5a5a6a'],
    [2, 1, '#7a7a8a'],
    [3, 1, '#8a8a9a'],
    [4, 1, '#9a9aaa'],
    [5, 1, '#8a8a9a'],
    [6, 1, '#7a7a8a'],
    [7, 1, '#5a5a6a'],
    // Row 2
    [1, 2, '#7a7a8a'],
    [2, 2, '#9a9aaa'],
    [3, 2, '#aaaabc'],
    [5, 2, '#8a8a9a'],
    [6, 2, '#9a9aaa'],
    [7, 2, '#7a7a8a'],
    // Row 3: teeth left + right
    [0, 3, '#5a5a6a'],
    [1, 3, '#9a9aaa'],
    [2, 3, '#aaaabc'],
    [6, 3, '#8a8a9a'],
    [7, 3, '#7a7a8a'],
    [8, 3, '#5a5a6a'],
    // Row 4: center row
    [0, 4, '#5a5a6a'],
    [1, 4, '#8a8a9a'],
    [7, 4, '#7a7a8a'],
    [8, 4, '#5a5a6a'],
    // Row 5: teeth left + right
    [0, 5, '#5a5a6a'],
    [1, 5, '#8a8a9a'],
    [2, 5, '#8a8a9a'],
    [6, 5, '#7a7a8a'],
    [7, 5, '#6a6a7a'],
    [8, 5, '#5a5a6a'],
    // Row 6
    [1, 6, '#7a7a8a'],
    [2, 6, '#8a8a9a'],
    [3, 6, '#8a8a9a'],
    [5, 6, '#6a6a7a'],
    [6, 6, '#7a7a8a'],
    [7, 6, '#6a6a7a'],
    // Row 7
    [1, 7, '#5a5a6a'],
    [2, 7, '#7a7a8a'],
    [3, 7, '#7a7a8a'],
    [4, 7, '#6a6a7a'],
    [5, 7, '#6a6a7a'],
    [6, 7, '#6a6a7a'],
    [7, 7, '#5a5a6a'],
    // Row 8: teeth bottom
    [3, 8, '#5a5a6a'],
    [4, 8, '#5a5a6a'],
    [5, 8, '#5a5a6a'],
  ];

  for (const [x, y, color] of pixels) {
    ctx.fillStyle = color;
    ctx.fillRect(x, y, 1, 1);
  }

  return canvas.toDataURL();
}

let gearUrl: string | null = null;
function getGear(): string {
  if (!gearUrl) gearUrl = getGearDataUrl();
  return gearUrl;
}

/** Get display text for active bubble */
function getDisplayText(
  ch: { speechText: string | null; isActive: boolean; currentTool: string | null },
  agentId: number,
  agentTools: Record<number, ToolActivity[]>,
): string {
  // Prefer speech text (last agent response)
  if (ch.speechText) return ch.speechText;

  // Fall back to tool status
  const tools = agentTools[agentId];
  if (tools) {
    const active = [...tools].reverse().find((t) => !t.done);
    if (active) return active.status;
  }

  return 'Работает...';
}

interface ActiveBubblesProps {
  officeState: OfficeState;
  agents: number[];
  agentTools: Record<number, ToolActivity[]>;
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
}

export function ActiveBubbles({
  officeState,
  agents,
  agentTools,
  containerRef,
  zoom,
  panRef,
}: ActiveBubblesProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
    injectStyles();
    let rafId = 0;
    const tick = () => {
      setTick((n) => n + 1);
      rafId = requestAnimationFrame(tick);
    };
    rafId = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(rafId);
  }, []);

  const el = containerRef.current;
  if (!el) return null;
  const rect = el.getBoundingClientRect();
  const dpr = window.devicePixelRatio || 1;
  const canvasW = Math.round(rect.width * dpr);
  const canvasH = Math.round(rect.height * dpr);
  const layout = officeState.getLayout();
  const mapW = layout.cols * TILE_SIZE * zoom;
  const mapH = layout.rows * TILE_SIZE * zoom;
  const deviceOffsetX = Math.floor((canvasW - mapW) / 2) + Math.round(panRef.current.x);
  const deviceOffsetY = Math.floor((canvasH - mapH) / 2) + Math.round(panRef.current.y);

  return (
    <>
      {agents.map((id) => {
        const ch = officeState.characters.get(id);
        if (!ch || !ch.isActive) return null;

        const sittingOff = ch.state === CharacterState.TYPE ? BUBBLE_SITTING_OFFSET_PX : 0;
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr;
        const screenY = (deviceOffsetY + (ch.y + sittingOff - BUBBLE_Y_OFFSET) * zoom) / dpr;

        const text = getDisplayText(ch, id, agentTools);
        const displayText = text.length > 60 ? text.slice(0, 60) + '…' : text;

        return (
          <div
            key={`active-bubble-${id}`}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY,
              transform: 'translate(-50%, -100%)',
              pointerEvents: 'none',
              zIndex: 48,
            }}
          >
            {/* Pixel speech bubble */}
            <div
              style={{
                position: 'relative',
                background: '#f0f0f0',
                border: '3px solid #1a1a2e',
                padding: '4px 8px 4px 6px',
                maxWidth: 220,
                minWidth: 60,
                imageRendering: 'pixelated',
                boxShadow: '3px 3px 0 #c0c0c8',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
              }}
            >
              {/* Spinning gear */}
              <img
                src={getGear()}
                alt=""
                style={{
                  width: 14,
                  height: 14,
                  imageRendering: 'pixelated',
                  flexShrink: 0,
                  animation: 'pixel-gear-spin 2s linear infinite',
                }}
              />
              {/* Status text */}
              <span
                style={{
                  fontSize: '11px',
                  fontFamily: 'monospace',
                  color: '#1a1a2e',
                  lineHeight: 1.2,
                  wordBreak: 'break-word',
                  maxWidth: 180,
                }}
              >
                {displayText}
              </span>
            </div>
            {/* Tail pointer (bottom-center) */}
            <div
              style={{
                position: 'relative',
                marginLeft: '40%',
                width: 0,
                height: 0,
              }}
            >
              {/* Shadow tail */}
              <div
                style={{
                  position: 'absolute',
                  left: 3,
                  top: 0,
                  width: 0,
                  height: 0,
                  borderLeft: '6px solid transparent',
                  borderRight: '6px solid transparent',
                  borderTop: '8px solid #c0c0c8',
                }}
              />
              {/* Border tail */}
              <div
                style={{
                  position: 'absolute',
                  left: 0,
                  top: -1,
                  width: 0,
                  height: 0,
                  borderLeft: '7px solid transparent',
                  borderRight: '7px solid transparent',
                  borderTop: '9px solid #1a1a2e',
                }}
              />
              {/* Fill tail */}
              <div
                style={{
                  position: 'absolute',
                  left: 1,
                  top: -3,
                  width: 0,
                  height: 0,
                  borderLeft: '6px solid transparent',
                  borderRight: '6px solid transparent',
                  borderTop: '7px solid #f0f0f0',
                }}
              />
            </div>
          </div>
        );
      })}
    </>
  );
}
