import { useEffect, useState } from 'react';

import { BUBBLE_SITTING_OFFSET_PX } from '../../constants.js';
import type { OfficeState } from '../engine/officeState.js';
import { CharacterState, TILE_SIZE } from '../types.js';

const SPEECH_FADE_SEC = 1.0; // fade out during last second
const SPEECH_MAX_CHARS = 80;
const BUBBLE_Y_OFFSET = 28; // pixels above character head (in sprite coords)

interface SpeechBubblesProps {
  officeState: OfficeState;
  agents: number[];
  containerRef: React.RefObject<HTMLDivElement | null>;
  zoom: number;
  panRef: React.RefObject<{ x: number; y: number }>;
}

export function SpeechBubbles({
  officeState,
  agents,
  containerRef,
  zoom,
  panRef,
}: SpeechBubblesProps) {
  const [, setTick] = useState(0);
  useEffect(() => {
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
        if (!ch || !ch.speechText || ch.speechTimer <= 0) return null;

        const sittingOff = ch.state === CharacterState.TYPE ? BUBBLE_SITTING_OFFSET_PX : 0;
        const screenX = (deviceOffsetX + ch.x * zoom) / dpr;
        const screenY = (deviceOffsetY + (ch.y + sittingOff - BUBBLE_Y_OFFSET) * zoom) / dpr;

        // Fade out in last second
        const opacity = ch.speechTimer < SPEECH_FADE_SEC ? ch.speechTimer / SPEECH_FADE_SEC : 1.0;

        const text =
          ch.speechText.length > SPEECH_MAX_CHARS
            ? ch.speechText.slice(0, SPEECH_MAX_CHARS) + '…'
            : ch.speechText;

        return (
          <div
            key={`speech-${id}`}
            style={{
              position: 'absolute',
              left: screenX,
              top: screenY,
              transform: 'translate(-50%, -100%)',
              opacity,
              pointerEvents: 'none',
              zIndex: 50,
              transition: 'opacity 0.3s',
            }}
          >
            {/* Bubble body */}
            <div
              style={{
                background: 'var(--pixel-bg, #1a1a2e)',
                border: '2px solid var(--pixel-border, #3a3a5c)',
                borderRadius: 0,
                padding: '4px 8px',
                maxWidth: 200,
                boxShadow: 'var(--pixel-shadow, 2px 2px 0 #0a0a14)',
              }}
            >
              <span
                style={{
                  fontSize: '18px',
                  color: 'rgba(255,255,255,0.85)',
                  wordBreak: 'break-word',
                  lineHeight: 1.2,
                  display: 'block',
                  imageRendering: 'pixelated',
                }}
              >
                {text}
              </span>
            </div>
            {/* Triangle pointer */}
            <div
              style={{
                width: 0,
                height: 0,
                borderLeft: '6px solid transparent',
                borderRight: '6px solid transparent',
                borderTop: '6px solid var(--pixel-border, #3a3a5c)',
                margin: '0 auto',
              }}
            />
          </div>
        );
      })}
    </>
  );
}
