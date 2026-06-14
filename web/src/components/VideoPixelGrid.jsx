import { useEffect, useRef } from "react";

// VideoPixelGrid — a video-driven pixel grid (the WebcamPixelGrid effect, but fed
// by a video FILE instead of the webcam). Each animation frame the video is
// cover-cropped + downsampled to gridCols×gridRows, and every cell is drawn as a
// block coloured by its sampled pixel. Brightness + frame-to-frame motion drive a
// per-cell "elevation" (the block scales up as it brightens/moves), giving the
// grid relief. Pure canvas — no webcam, no getUserMedia.
function hexToRgba(hex, a) {
  const c = hex.replace("#", "");
  const r = parseInt(c.substring(0, 2), 16);
  const g = parseInt(c.substring(2, 4), 16);
  const b = parseInt(c.substring(4, 6), 16);
  return `rgba(${r},${g},${b},${a})`;
}

export default function VideoPixelGrid({
  src,
  gridCols = 60,
  gridRows = 40,
  maxElevation = 50,
  motionSensitivity = 0.25,
  elevationSmoothing = 0.2,
  colorMode = "webcam", // "webcam" = use the video's own colours
  backgroundColor = "#030303",
  mirror = true,
  gapRatio = 0.05,
  invertColors = false,
  darken = 0.6,
  borderColor = "#ffffff",
  borderOpacity = 0.06,
  className = "",
  onReady,
  onError,
}) {
  const containerRef = useRef(null);
  const canvasRef = useRef(null);
  const videoRef = useRef(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    const video = videoRef.current;
    if (!container || !canvas || !video) return;

    const ctx = canvas.getContext("2d");
    const sample = document.createElement("canvas");
    sample.width = gridCols;
    sample.height = gridRows;
    const sctx = sample.getContext("2d", { willReadFrequently: true });

    const prevBright = new Float32Array(gridCols * gridRows);
    const elev = new Float32Array(gridCols * gridRows);
    const borderRGBA = hexToRgba(borderColor, borderOpacity);
    const dpr = Math.min(window.devicePixelRatio || 1, 2);

    let raf = 0;
    let running = true;

    function resize() {
      const r = container.getBoundingClientRect();
      canvas.width = Math.max(1, Math.floor(r.width * dpr));
      canvas.height = Math.max(1, Math.floor(r.height * dpr));
      canvas.style.width = `${r.width}px`;
      canvas.style.height = `${r.height}px`;
    }
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    function draw() {
      if (!running) return;
      raf = requestAnimationFrame(draw);

      const W = canvas.width;
      const H = canvas.height;
      ctx.fillStyle = backgroundColor;
      ctx.fillRect(0, 0, W, H);

      const vw = video.videoWidth;
      const vh = video.videoHeight;
      if (video.readyState < 2 || !vw || !vh) return;

      // Cover-crop the video to the canvas aspect, then downsample to the grid.
      const targetAspect = W / H;
      let sw = vw;
      let sh = vh;
      let sx = 0;
      let sy = 0;
      if (vw / vh > targetAspect) {
        sw = vh * targetAspect;
        sx = (vw - sw) / 2;
      } else {
        sh = vw / targetAspect;
        sy = (vh - sh) / 2;
      }
      sctx.save();
      sctx.clearRect(0, 0, gridCols, gridRows);
      if (mirror) {
        sctx.translate(gridCols, 0);
        sctx.scale(-1, 1);
      }
      sctx.drawImage(video, sx, sy, sw, sh, 0, 0, gridCols, gridRows);
      sctx.restore();

      const data = sctx.getImageData(0, 0, gridCols, gridRows).data;
      const cellW = W / gridCols;
      const cellH = H / gridRows;
      const gap = Math.min(cellW, cellH) * gapRatio;

      for (let y = 0; y < gridRows; y++) {
        for (let x = 0; x < gridCols; x++) {
          const di = (y * gridCols + x) * 4;
          let r = data[di];
          let g = data[di + 1];
          let b = data[di + 2];
          if (invertColors) {
            r = 255 - r;
            g = 255 - g;
            b = 255 - b;
          }
          r *= darken;
          g *= darken;
          b *= darken;

          const idx = y * gridCols + x;
          const bright = (r + g + b) / (3 * 255);
          const motion = Math.abs(bright - prevBright[idx]) * motionSensitivity * 8;
          prevBright[idx] = bright;
          const target = Math.min(1, bright + motion);
          elev[idx] += (target - elev[idx]) * elevationSmoothing;

          // Keep cells near full so the video stays readable; elevation adds a tiny pop.
          const e = elev[idx];
          const scale = Math.min(1, 0.88 + e * 0.12);
          const cw = (cellW - gap) * scale;
          const ch = (cellH - gap) * scale;
          const cx = x * cellW + (cellW - cw) / 2;
          const cy = y * cellH + (cellH - ch) / 2;

          // main face
          ctx.fillStyle = `rgb(${r | 0},${g | 0},${b | 0})`;
          ctx.fillRect(cx, cy, cw, ch);

          // RELIEF: extruded-tile bevel — light from top-left, shadow bottom-right,
          // strength scales with elevation (maxElevation). Gives each pixel depth.
          const bev = Math.max(0.6, Math.min(cw, ch) * 0.26);
          const k = Math.min(1, (0.4 + e) * (maxElevation / 50));
          ctx.fillStyle = `rgba(255,255,255,${0.18 * k})`;
          ctx.fillRect(cx, cy, cw, bev);
          ctx.fillRect(cx, cy, bev, ch);
          ctx.fillStyle = `rgba(0,0,0,${0.38 * k})`;
          ctx.fillRect(cx, cy + ch - bev, cw, bev);
          ctx.fillRect(cx + cw - bev, cy, bev, ch);
        }
      }
    }

    function start() {
      const p = video.play();
      if (p && p.then) p.then(() => onReady?.()).catch((e) => onError?.(e));
      else onReady?.();
    }
    video.addEventListener("loadeddata", start);
    if (video.readyState >= 2) start();
    raf = requestAnimationFrame(draw);

    return () => {
      running = false;
      cancelAnimationFrame(raf);
      ro.disconnect();
      video.removeEventListener("loadeddata", start);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [src, gridCols, gridRows, maxElevation, motionSensitivity, elevationSmoothing, backgroundColor, mirror, gapRatio, invertColors, darken, borderColor, borderOpacity]);

  return (
    <div ref={containerRef} className={`vpg ${className}`} style={{ position: "absolute", inset: 0 }}>
      {/* kept renderable (opacity 0, not display:none) so it decodes/plays in all browsers */}
      <video
        ref={videoRef}
        src={src}
        muted
        loop
        playsInline
        autoPlay
        preload="auto"
        style={{ position: "absolute", width: 2, height: 2, opacity: 0, pointerEvents: "none" }}
      />
      <canvas ref={canvasRef} style={{ display: "block", width: "100%", height: "100%" }} />
    </div>
  );
}
