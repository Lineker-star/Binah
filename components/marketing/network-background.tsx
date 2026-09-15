'use client';

import { useEffect, useRef } from 'react';

interface Node {
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
}

const NODE_COUNT = 46;
const LINK_DISTANCE = 150;
const NODE_COLOR = '129, 140, 248'; // indigo-400, as an rgb triple for use in rgba()
const LINE_COLOR = '99, 102, 241'; // indigo-500

/**
 * Ambient node-and-connection field for the marketing hero — the same motif
 * as the brand mark's own geometry, rendered as slow-drifting particles
 * linked by proximity. Canvas rather than SVG/DOM: ~45 nodes redrawn every
 * frame would mean that many DOM node mutations otherwise.
 *
 * Purely decorative (`aria-hidden`) and never blocks input — the hero's real
 * content sits in normal flow above it via z-index, not inside the canvas.
 */
export function NetworkBackground({ className }: { className?: string }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let width = 0;
    let height = 0;
    let dpr = Math.min(window.devicePixelRatio || 1, 2);
    let nodes: Node[] = [];
    let frameId = 0;

    const seedNodes = () => {
      nodes = Array.from({ length: NODE_COUNT }, () => ({
        x: Math.random() * width,
        y: Math.random() * height,
        vx: (Math.random() - 0.5) * 0.25,
        vy: (Math.random() - 0.5) * 0.25,
        r: 1 + Math.random() * 1.6,
      }));
    };

    const resize = () => {
      const rect = canvas.getBoundingClientRect();
      width = rect.width;
      height = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      canvas.width = Math.max(1, Math.floor(width * dpr));
      canvas.height = Math.max(1, Math.floor(height * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seedNodes();
    };

    const drawFrame = () => {
      ctx.clearRect(0, 0, width, height);

      for (const node of nodes) {
        if (!reduceMotion) {
          node.x += node.vx;
          node.y += node.vy;
          if (node.x < 0 || node.x > width) node.vx *= -1;
          if (node.y < 0 || node.y > height) node.vy *= -1;
          node.x = Math.min(Math.max(node.x, 0), width);
          node.y = Math.min(Math.max(node.y, 0), height);
        }
      }

      for (let i = 0; i < nodes.length; i++) {
        for (let j = i + 1; j < nodes.length; j++) {
          const a = nodes[i];
          const b = nodes[j];
          const dx = a.x - b.x;
          const dy = a.y - b.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > LINK_DISTANCE) continue;
          const alpha = (1 - dist / LINK_DISTANCE) * 0.35;
          ctx.strokeStyle = `rgba(${LINE_COLOR}, ${alpha})`;
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(a.x, a.y);
          ctx.lineTo(b.x, b.y);
          ctx.stroke();
        }
      }

      for (const node of nodes) {
        ctx.fillStyle = `rgba(${NODE_COLOR}, 0.85)`;
        ctx.beginPath();
        ctx.arc(node.x, node.y, node.r, 0, Math.PI * 2);
        ctx.fill();
      }
    };

    const loop = () => {
      drawFrame();
      frameId = requestAnimationFrame(loop);
    };

    resize();
    if (reduceMotion) {
      drawFrame();
    } else {
      frameId = requestAnimationFrame(loop);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(canvas);

    return () => {
      cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
    };
  }, []);

  return <canvas ref={canvasRef} aria-hidden="true" className={className} />;
}
