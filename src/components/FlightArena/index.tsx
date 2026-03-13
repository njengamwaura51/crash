import React, { useEffect, useRef, useCallback } from "react";
import { useMockContext } from "../../mockContext";
import planeImg from "../../assets/images/rocket1.png";
import logoImg from "../../assets/images/logo.png";
import "./FlightArena.scss";

// ─── Neon colour constants ────────────────────────────────────────────────────
const LINE_COLOR_FLYING  = "#00ffcc";
const LINE_COLOR_CRASHED = "#ff4444";
const GRID_COLOR         = "rgba(255,255,255,0.04)";
const GLOW_FLYING        = "rgba(0,255,200,0.25)";
const GLOW_CRASHED       = "rgba(255,68,68,0.3)";

// ─── Canvas helpers ───────────────────────────────────────────────────────────

interface Point { x: number; y: number; }

/**
 * Project a (multiplier, elapsedMs) world point to canvas pixel coordinates.
 * X is linear in elapsed time; Y is logarithmic in the multiplier so that
 * low values (1×–5×) and high values (50×+) are both legible at once.
 *
 * @param maxMultiplier - the current Y-axis ceiling (grows dynamically)
 */
function worldToCanvas(
  multiplier: number,
  elapsedMs: number,
  maxMultiplier: number,
  canvasW: number,
  canvasH: number,
  pad: number
): Point {
  const innerW = canvasW - pad * 2;

  // X: linear in elapsed time (capped at max domain)
  const maxTime = 15_000; // ms
  const xFrac = Math.min(elapsedMs / maxTime, 1);
  const x = pad + xFrac * innerW;

  // Y: logarithmic – delegate to shared helper
  const y = multiplierToY(multiplier, maxMultiplier, canvasH, pad);

  return { x, y };
}

/**
 * Compute sensible Y-axis tick multipliers given the current max.
 * Ticks are at round "nice" values: 1, 1.5, 2, 3, 5, 10, 20, 50, 100, 200.
 */
function yAxisTicks(maxMultiplier: number): number[] {
  const candidates = [1, 1.5, 2, 3, 5, 10, 20, 50, 100, 200];
  return candidates.filter((t) => t <= maxMultiplier);
}

/**
 * Convert a multiplier value to a canvas Y pixel given the current axis ceiling.
 * Shared by worldToCanvas and the axis-label renderer to ensure consistency.
 */
function multiplierToY(
  multiplier: number,
  maxMultiplier: number,
  canvasH: number,
  pad: number
): number {
  const innerH = canvasH - pad * 2;
  const logM   = Math.log(Math.max(multiplier, 1));
  const logMax = Math.log(Math.max(maxMultiplier, 2));
  const yFrac  = Math.min(logM / logMax, 1);
  return canvasH - pad - yFrac * innerH;
}

/** Number of decorative stars rendered on the Flight Arena backdrop */
const STAR_COUNT = 40;

// ─── Component ────────────────────────────────────────────────────────────────

interface HistoryItem { multiplier: number; elapsed: number; }

const FlightArena: React.FC = () => {
  const {
    phase,
    multiplier,
    elapsedMs,
    waitCountdown,
    history,
  } = useMockContext();

  const canvasRef      = useRef<HTMLCanvasElement>(null);
  const planeRef       = useRef<HTMLImageElement>(null);
  const pathRef        = useRef<HistoryItem[]>([]);
  const frameRef       = useRef<number>(0);
  const phaseRef       = useRef(phase);
  /** Dynamic Y-axis ceiling – grows as the multiplier climbs, never shrinks mid-round */
  const dynamicMaxRef  = useRef(5);
  /** Cached plane dimensions to avoid layout reflow on every animation frame */
  const planeDimsRef   = useRef({ w: 64, h: 64 });

  useEffect(() => { phaseRef.current = phase; }, [phase]);

  // Update the dynamic Y-ceiling based on phase and current multiplier
  useEffect(() => {
    if (phase === "WAITING_FOR_BETS" || phase === "TAKING_OFF") {
      // Reset at the start of each round
      dynamicMaxRef.current = 5;
    } else if (phase === "FLYING" || phase === "CRASHED") {
      // Grow with 50 % headroom; never shrink mid-round
      const needed = multiplier * 1.5;
      if (needed > dynamicMaxRef.current) {
        dynamicMaxRef.current = needed;
      }
    }
  }, [phase, multiplier]);

  // Accumulate path points while flying
  useEffect(() => {
    if (phase === "FLYING") {
      pathRef.current.push({ multiplier, elapsed: elapsedMs });
    } else if (phase === "WAITING_FOR_BETS") {
      pathRef.current = [];
    }
  }, [phase, multiplier, elapsedMs]);

  // ── Draw loop ────────────────────────────────────────────────────────────────
  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const PAD = 44;

    ctx.clearRect(0, 0, W, H);

    // Background
    const bg = ctx.createRadialGradient(W * 0.55, H * 0.8, 0, W * 0.5, H * 0.5, W * 0.8);
    bg.addColorStop(0, "#14094e");
    bg.addColorStop(0.6, "#070218");
    bg.addColorStop(1, "#020110");
    ctx.fillStyle = bg;
    ctx.fillRect(0, 0, W, H);

    // Grid
    ctx.strokeStyle = GRID_COLOR;
    ctx.lineWidth = 1;
    const gridStep = 60;
    for (let gx = PAD; gx < W; gx += gridStep) {
      ctx.beginPath(); ctx.moveTo(gx, 0); ctx.lineTo(gx, H); ctx.stroke();
    }
    for (let gy = 0; gy < H; gy += gridStep) {
      ctx.beginPath(); ctx.moveTo(0, gy); ctx.lineTo(W, gy); ctx.stroke();
    }

    // Axes
    ctx.strokeStyle = "rgba(255,255,255,0.12)";
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(PAD, PAD); ctx.lineTo(PAD, H - PAD);
    ctx.lineTo(W - PAD, H - PAD);
    ctx.stroke();

    // Origin dot
    ctx.fillStyle = "rgba(255,255,255,0.3)";
    ctx.beginPath();
    ctx.arc(PAD, H - PAD, 4, 0, Math.PI * 2);
    ctx.fill();

    if (phaseRef.current === "WAITING_FOR_BETS" || phaseRef.current === "TAKING_OFF") {
      // During TAKING_OFF show the plane sitting at the origin
      if (planeRef.current && phaseRef.current === "TAKING_OFF") {
        const { w, h } = planeDimsRef.current;
        planeRef.current.style.left      = `${PAD - w / 2}px`;
        planeRef.current.style.top       = `${H - PAD - h / 2}px`;
        planeRef.current.style.transform = "rotate(-20deg)";
      }
      return;
    }

    const crashed   = phaseRef.current === "CRASHED";
    const lineColor = crashed ? LINE_COLOR_CRASHED : LINE_COLOR_FLYING;
    const glowColor = crashed ? GLOW_CRASHED : GLOW_FLYING;
    const yMax      = dynamicMaxRef.current;

    // ── Axis labels ────────────────────────────────────────────────────────
    const innerW = W - PAD * 2;

    ctx.save();
    ctx.font = "bold 10px monospace";
    ctx.textBaseline = "middle";

    // Y-axis multiplier labels + subtle horizontal guide lines
    const ticks = yAxisTicks(yMax);
    for (const tick of ticks) {
      const yPx = multiplierToY(tick, yMax, H, PAD);

      // Horizontal guide line
      ctx.strokeStyle = "rgba(255,255,255,0.06)";
      ctx.lineWidth   = 1;
      ctx.setLineDash([4, 6]);
      ctx.beginPath();
      ctx.moveTo(PAD, yPx);
      ctx.lineTo(W - PAD, yPx);
      ctx.stroke();
      ctx.setLineDash([]);

      // Label
      ctx.fillStyle   = "rgba(255,255,255,0.28)";
      ctx.textAlign   = "right";
      ctx.fillText(`${tick}×`, PAD - 6, yPx);
    }

    // X-axis time labels (every 5 s up to 15 s)
    ctx.textBaseline = "top";
    ctx.textAlign    = "center";
    ctx.fillStyle    = "rgba(255,255,255,0.22)";
    const maxTime = 15_000;
    for (let t = 5_000; t <= maxTime; t += 5_000) {
      const xPx = PAD + (t / maxTime) * innerW;
      ctx.fillText(`${t / 1000}s`, xPx, H - PAD + 5);
    }
    ctx.restore();

    // ── Build path ────────────────────────────────────────────────────────
    const pts: Point[] = pathRef.current.map((p) =>
      worldToCanvas(p.multiplier, p.elapsed, yMax, W, H, PAD)
    );

    if (pts.length < 2) return;

    // ── Glow shadow ───────────────────────────────────────────────────────
    ctx.shadowColor = lineColor;
    ctx.shadowBlur  = 18;

    // ── Fill area under curve ─────────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(PAD, H - PAD);
    // Use smooth quadratic bezier (mid-point algorithm) for fill
    ctx.lineTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.lineTo(pts[pts.length - 1].x, H - PAD);
    ctx.closePath();
    const fillGrad = ctx.createLinearGradient(PAD, H - PAD, PAD, PAD);
    fillGrad.addColorStop(0, "transparent");
    fillGrad.addColorStop(1, glowColor);
    ctx.fillStyle = fillGrad;
    ctx.fill();

    // ── Smooth curve line ─────────────────────────────────────────────────
    ctx.beginPath();
    ctx.moveTo(pts[0].x, pts[0].y);
    for (let i = 1; i < pts.length - 1; i++) {
      const mx = (pts[i].x + pts[i + 1].x) / 2;
      const my = (pts[i].y + pts[i + 1].y) / 2;
      ctx.quadraticCurveTo(pts[i].x, pts[i].y, mx, my);
    }
    ctx.lineTo(pts[pts.length - 1].x, pts[pts.length - 1].y);
    ctx.strokeStyle = lineColor;
    ctx.lineWidth   = 3;
    ctx.lineJoin    = "round";
    ctx.stroke();

    ctx.shadowBlur = 0;

    // Tip dot
    const tip = pts[pts.length - 1];
    ctx.fillStyle = lineColor;
    ctx.beginPath();
    ctx.arc(tip.x, tip.y, 5, 0, Math.PI * 2);
    ctx.fill();

    // Update plane position
    if (planeRef.current && !crashed) {
      // Cache plane dimensions on first access to avoid per-frame reflows
      if (planeRef.current.offsetWidth > 0) {
        planeDimsRef.current = {
          w: planeRef.current.offsetWidth,
          h: planeRef.current.offsetHeight,
        };
      }
      const { w: planeW, h: planeH } = planeDimsRef.current;
      planeRef.current.style.left  = `${tip.x - planeW / 2}px`;
      planeRef.current.style.top   = `${tip.y - planeH / 2}px`;

      // Calculate tilt angle from last two points
      if (pts.length >= 2) {
        const prev = pts[pts.length - 2];
        const dx = tip.x - prev.x;
        const dy = tip.y - prev.y;
        const angle = Math.atan2(dy, dx) * (180 / Math.PI);
        planeRef.current.style.transform = `rotate(${angle}deg)`;
      }
    }
  }, []); // refs are used internally - no stale closure issue

  // ── Animate ──────────────────────────────────────────────────────────────────
  useEffect(() => {
    const loop = () => {
      draw();
      frameRef.current = requestAnimationFrame(loop);
    };
    frameRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(frameRef.current);
  }, [draw]);

  // ── Resize canvas ────────────────────────────────────────────────────────────
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const resize = () => {
      canvas.width  = canvas.offsetWidth;
      canvas.height = canvas.offsetHeight;
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(canvas);
    return () => ro.disconnect();
  }, []);

  // ── Stars ────────────────────────────────────────────────────────────────────
  const starsRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const el = starsRef.current;
    if (!el) return;
    el.innerHTML = "";
    for (let i = 0; i < STAR_COUNT; i++) {
      const s = document.createElement("div");
      s.className = "fa-star";
      const size = Math.random() * 2.5 + 0.5;
      s.style.cssText = [
        `width:${size}px`,
        `height:${size}px`,
        `left:${Math.random() * 100}%`,
        `top:${Math.random() * 100}%`,
        `opacity:${Math.random() * 0.7 + 0.1}`,
        `animation-delay:${Math.random() * 6}s`,
        `animation-duration:${Math.random() * 4 + 3}s`,
      ].join(";");
      el.appendChild(s);
    }
  }, []);

  const crashed = phase === "CRASHED";
  const waiting = phase === "WAITING_FOR_BETS";
  const flying  = phase === "FLYING" || phase === "TAKING_OFF";

  const countdownSecs = (waitCountdown / 1000).toFixed(1);
  const displayMultiplier = multiplier >= 1 ? multiplier.toFixed(2) : "1.00";

  return (
    <div className="flight-arena">
      {/* Star backdrop */}
      <div className="fa-stars" ref={starsRef} />

      {/* Canvas */}
      <canvas className="fa-canvas" ref={canvasRef} />

      {/* Plane */}
      <img
        ref={planeRef}
        src={planeImg}
        alt="plane"
        className={`fa-plane ${flying ? "fa-plane--visible" : ""} ${crashed ? "fa-plane--crashed" : ""}`}
      />

      {/* Multiplier display */}
      {!waiting && (
        <div className={`fa-multiplier ${crashed ? "fa-multiplier--crashed" : ""}`}>
          {displayMultiplier}x
        </div>
      )}

      {/* Crashed banner */}
      {crashed && (
        <div className="fa-crash-banner">
          FLEW AWAY!
        </div>
      )}

      {/* Waiting overlay */}
      {waiting && (
        <div className="fa-waiting">
          <div className="fa-waiting__logo">
            <img
              src={logoImg}
              alt="logo"
              className="fa-waiting__logo-img"
            />
          </div>
          <div className="fa-waiting__label">NEXT ROUND IN</div>
          <div className="fa-waiting__countdown">{countdownSecs}s</div>
          <div className="fa-waiting__bar">
            <div
              className="fa-waiting__bar-fill"
              style={{ width: `${(waitCountdown / 5000) * 100}%` }}
            />
          </div>
        </div>
      )}

      {/* History bar */}
      {history.length > 0 && (
        <div className="fa-history">
          {[...history].slice(0, 12).map((h, i) => {
            const cls = h < 2 ? "low" : h < 10 ? "mid" : "high";
            return (
              <span key={i} className={`fa-history__item fa-history__item--${cls}`}>
                {h.toFixed(2)}x
              </span>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default FlightArena;
