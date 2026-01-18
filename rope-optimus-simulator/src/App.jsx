import React, { useEffect, useRef, useState, useMemo, useCallback } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
  BarChart,
  Bar,
} from 'recharts';
import * as PIXI from 'pixi.js';

// -----------------------------
// Utils & Math Helpers
// -----------------------------

function clamp(x, lo, hi) {
  return Math.max(lo, Math.min(hi, x));
}

function seededRandom(seed) {
  let s = seed | 0;
  return function rand() {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return (s / 0x7fffffff) * 2 - 1;
  };
}

function int8ToUint8(x) { return x & 0xff; }
function uint8ToInt8(u) { const v = u & 0xff; return v >= 128 ? v - 256 : v; }
function pack2x8ToU16(lo, hi) { return (int8ToUint8(lo) | (int8ToUint8(hi) << 8)) & 0xffff; }
function unpackU16To2x8(p) { return [uint8ToInt8(p & 0xff), uint8ToInt8((p >> 8) & 0xff)]; }

// -----------------------------
// RoPE / Quantization Logic
// -----------------------------

function computeInvFreq(dim, base) {
  const half = Math.floor(dim / 2);
  const invFreq = new Array(half);
  const logInvFreq = new Array(half);
  for (let i = 0; i < half; i++) {
    const v = Math.pow(base, (-2.0 * i) / dim);
    invFreq[i] = v;
    logInvFreq[i] = Math.log(v);
  }
  return { invFreq, logInvFreq };
}

function qmaxForBits(bits) { return Math.pow(2, bits - 1) - 1; }

function quantizeSigned(value, scale, qmax) {
  if (!Number.isFinite(value)) return 0;
  if (!Number.isFinite(scale) || scale <= 0) return 0;
  const q = Math.round(value / scale);
  return clamp(q, -qmax, qmax);
}

function computeLogThetaScalesAnalytic(seqLen, logInvFreq, bits, mode) {
  const half = logInvFreq.length;
  const qmax = qmaxForBits(bits);
  const logMaxPos = Math.log(Math.max(1, seqLen - 1));

  if (mode === 'global') {
    let globalMaxAbs = 0;
    for (let i = 0; i < half; i++) {
      const lo = logInvFreq[i];
      const hi = logInvFreq[i] + logMaxPos;
      globalMaxAbs = Math.max(globalMaxAbs, Math.abs(lo), Math.abs(hi));
    }
    const scale = globalMaxAbs < 1e-12 ? 1.0 : globalMaxAbs / qmax;
    return { scales: new Array(half).fill(scale), qmax };
  }

  const scales = new Array(half);
  for (let i = 0; i < half; i++) {
    const lo = logInvFreq[i];
    const hi = logInvFreq[i] + logMaxPos;
    const maxAbs = Math.max(Math.abs(lo), Math.abs(hi));
    scales[i] = maxAbs < 1e-12 ? 1.0 : maxAbs / qmax;
  }
  return { scales, qmax };
}

function computeThetaScalesAnalytic(seqLen, invFreq, bits, mode) {
  const half = invFreq.length;
  const qmax = qmaxForBits(bits);
  const maxPos = Math.max(1, seqLen - 1);

  if (mode === 'global') {
    const maxAbs = maxPos * invFreq[0];
    const scale = maxAbs < 1e-12 ? 1.0 : maxAbs / qmax;
    return { scales: new Array(half).fill(scale), qmax };
  }

  const scales = new Array(half);
  for (let i = 0; i < half; i++) {
    const maxAbs = maxPos * invFreq[i];
    scales[i] = maxAbs < 1e-12 ? 1.0 : maxAbs / qmax;
  }
  return { scales, qmax };
}

function makeLogBins(minExp = -12, maxExp = 0, bins = 24) {
  const edges = [];
  for (let i = 0; i <= bins; i++) {
    const t = i / bins;
    const exp = minExp + (maxExp - minExp) * t;
    edges.push(Math.pow(10, exp));
  }
  return { edges, minExp, maxExp, bins };
}

function binIndexForPositive(x, edges) {
  let lo = 0, hi = edges.length - 2;
  if (x < edges[0]) return 0;
  if (x >= edges[edges.length - 1]) return edges.length - 2;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (x < edges[mid]) hi = mid - 1;
    else if (x >= edges[mid + 1]) lo = mid + 1;
    else return mid;
  }
  return clamp(lo, 0, edges.length - 2);
}

function buildHistData(counts, edges) {
  const data = [];
  for (let i = 0; i < counts.length; i++) {
    data.push({
      range: `${edges[i].toExponential(0)}–${edges[i + 1].toExponential(0)}`,
      count: counts[i],
    });
  }
  return data;
}

// -----------------------------
// Egg Physics Hook - For Grip Control Game
// -----------------------------

const EGG_STATES = {
  INTACT: 'intact',
  STRESSED: 'stressed',
  CRACKED: 'cracked',
  BROKEN: 'broken',
};

const BREAK_THRESHOLD = 85; // Pressure above this breaks the egg
const STRESS_THRESHOLD = 70; // Pressure above this shows stress
const SAFE_ZONE_MIN = 50;  // Minimum grip to "hold" the egg
const SAFE_ZONE_MAX = 75;  // Maximum safe grip
const DROP_TIME_TO_BREAK = 0.35; // 秒 - SAFE_ZONE_MIN未満が続くと落下

function useEggPhysics({
  targetGripForce,
  noiseLevel,      // mixed (log/exp) の RMSE
  naiveNoiseLevel, // naive の RMSE（オプション）
  noiseMode = 'mixed', // 'mixed' | 'naive'
  animationTime,
  isEnabled
}) {
  const [eggState, setEggState] = useState(EGG_STATES.INTACT);
  const [actualPressure, setActualPressure] = useState(0);
  const [peakPressure, setPeakPressure] = useState(0);
  const [safeTime, setSafeTime] = useState(0);
  const [score, setScore] = useState(0);
  const [weakDuration, setWeakDuration] = useState(0);
  const [breakReason, setBreakReason] = useState(null); // 'crush' | 'drop' | null
  const lastTimeRef = useRef(animationTime);
  const noiseHistoryRef = useRef([]);

  // 使用するノイズレベルを切替（ゲーム用に上限を設定）
  const MAX_GAME_NOISE = 0.15; // 最大15%に制限してプレイ可能に
  const rawNoise = noiseMode === 'naive'
    ? (naiveNoiseLevel ?? noiseLevel * 1.5) // naive は mixed の1.5倍（デフォルト）
    : noiseLevel;
  const effectiveNoise = Math.min(rawNoise, MAX_GAME_NOISE);

  // Calculate actual pressure with quantization noise
  const calculatePressure = useCallback(() => {
    if (!isEnabled || eggState === EGG_STATES.BROKEN) {
      return targetGripForce;
    }

    // Noise is based on quantization error (meanRmse)
    // Lower bits = more noise = harder to control
    const baseNoise = effectiveNoise * 100; // Scale up the noise
    const timeNoise = Math.sin(animationTime * 15) * 0.3 +
                      Math.sin(animationTime * 23) * 0.2 +
                      Math.sin(animationTime * 37) * 0.15;
    const seed = Math.floor(animationTime * 1000);
    const rand = seededRandom(seed);
    const randomNoise = rand() * 0.4;

    const totalNoise = baseNoise * (timeNoise + randomNoise);
    const pressure = targetGripForce + totalNoise;

    return clamp(pressure, 0, 100);
  }, [targetGripForce, effectiveNoise, animationTime, isEnabled, eggState]);

  // Update pressure and check for breaks
  useEffect(() => {
    if (!isEnabled) return;

    const pressure = calculatePressure();
    setActualPressure(pressure);

    // Track peak pressure
    if (pressure > peakPressure) {
      setPeakPressure(pressure);
    }

    // Keep noise history for visualization
    noiseHistoryRef.current.push(pressure);
    if (noiseHistoryRef.current.length > 50) {
      noiseHistoryRef.current.shift();
    }

    // Score calculation - reward time in safe zone
    const dt = animationTime - lastTimeRef.current;

    // State transitions
    if (eggState !== EGG_STATES.BROKEN) {
      // Crush判定：圧力が高すぎると潰れる
      if (pressure >= BREAK_THRESHOLD) {
        setEggState(EGG_STATES.BROKEN);
        setBreakReason('crush');
      } else if (pressure >= STRESS_THRESHOLD) {
        setEggState(EGG_STATES.STRESSED);
      } else if (eggState === EGG_STATES.STRESSED && pressure < STRESS_THRESHOLD - 5) {
        setEggState(EGG_STATES.INTACT);
      }

      // Drop判定：SAFE_ZONE_MIN未満が一定時間続くと落下
      if (pressure < SAFE_ZONE_MIN) {
        setWeakDuration(prev => {
          const newDuration = prev + dt;
          if (newDuration >= DROP_TIME_TO_BREAK && eggState !== EGG_STATES.BROKEN) {
            setEggState(EGG_STATES.BROKEN);
            setBreakReason('drop');
          }
          return newDuration;
        });
      } else {
        setWeakDuration(0);
      }
    }
    if (dt > 0 && eggState !== EGG_STATES.BROKEN) {
      if (pressure >= SAFE_ZONE_MIN && pressure <= SAFE_ZONE_MAX) {
        setSafeTime(t => t + dt);
        setScore(s => s + Math.floor(dt * 100 * (pressure / 100))); // More points for higher safe grip
      }
    }
    lastTimeRef.current = animationTime;
  }, [animationTime, isEnabled, calculatePressure, eggState, peakPressure]);

  const resetEgg = useCallback(() => {
    setEggState(EGG_STATES.INTACT);
    setActualPressure(0);
    setPeakPressure(0);
    setSafeTime(0);
    setWeakDuration(0);
    setBreakReason(null);
    setScore(0);  // スコアもリセット
    noiseHistoryRef.current = [];
  }, []);

  return {
    eggState,
    actualPressure,
    peakPressure,
    safeTime,
    score,
    breakReason,
    weakDuration,
    effectiveNoise,
    noiseHistory: noiseHistoryRef.current,
    resetEgg,
    isInSafeZone: actualPressure >= SAFE_ZONE_MIN && actualPressure <= SAFE_ZONE_MAX,
    BREAK_THRESHOLD,
    STRESS_THRESHOLD,
    SAFE_ZONE_MIN,
    SAFE_ZONE_MAX,
    DROP_TIME_TO_BREAK,
  };
}

// -----------------------------
// Egg SVG Component
// -----------------------------

const EggObject = ({ state, pressure, stressLevel = 0, animationTime = 0 }) => {
  const isStressed = state === EGG_STATES.STRESSED;
  const isBroken = state === EGG_STATES.BROKEN;

  // Egg deformation based on pressure
  const squeeze = Math.min(pressure / 100, 0.3) * 0.15;
  const rx = 28 * (1 + squeeze);
  const ry = 36 * (1 - squeeze);

  // Vibration when stressed
  const vibX = isStressed ? Math.sin(animationTime * 50) * 2 : 0;
  const vibY = isStressed ? Math.cos(animationTime * 70) * 1.5 : 0;

  // Color shift based on stress
  const stressColor = isStressed ? `rgba(239, 68, 68, ${stressLevel * 0.3})` : 'transparent';

  if (isBroken) {
    return (
      <g transform={`translate(${vibX}, ${vibY})`}>
        {/* Broken egg shell pieces */}
        <ellipse cx="0" cy="0" rx={rx * 0.6} ry={ry * 0.5} fill="#FEF3C7" opacity="0.6"/>

        {/* Crack lines */}
        <path d="M -15,-20 L -5,-5 L -18,5 L -8,15" stroke="#92400E" strokeWidth="2" fill="none"/>
        <path d="M 10,-18 L 5,-3 L 15,8 L 8,20" stroke="#92400E" strokeWidth="2" fill="none"/>
        <path d="M -8,-15 L 2,0 L -5,12" stroke="#92400E" strokeWidth="1.5" fill="none"/>

        {/* Yolk spilling out */}
        <ellipse cx="5" cy="10" rx="18" ry="12" fill="#F59E0B" opacity="0.9"/>
        <ellipse cx="3" cy="8" rx="10" ry="8" fill="#FBBF24"/>
        <ellipse cx="0" cy="5" rx="5" ry="4" fill="#FCD34D"/>

        {/* Shell fragments */}
        <path d="M -20,-10 Q -25,-5 -22,5" stroke="#E5E7EB" strokeWidth="3" fill="none"/>
        <path d="M 18,-8 Q 24,0 20,10" stroke="#E5E7EB" strokeWidth="3" fill="none"/>

        {/* Splatter effect */}
        <circle cx="-25" cy="15" r="3" fill="#FBBF24" opacity="0.7"/>
        <circle cx="28" cy="12" r="2" fill="#FBBF24" opacity="0.6"/>
        <circle cx="-18" cy="25" r="2.5" fill="#FBBF24" opacity="0.5"/>
      </g>
    );
  }

  return (
    <g transform={`translate(${vibX}, ${vibY})`}>
      {/* Egg shadow */}
      <ellipse cx="3" cy="5" rx={rx * 0.9} ry={ry * 0.3} fill="#000" opacity="0.1"/>

      {/* Main egg body */}
      <ellipse cx="0" cy="0" rx={rx} ry={ry} fill="url(#eggGradientDetailed)"/>

      {/* Stress overlay */}
      <ellipse cx="0" cy="0" rx={rx - 1} ry={ry - 1} fill={stressColor}/>

      {/* Highlight */}
      <ellipse cx="-8" cy="-12" rx="8" ry="12" fill="white" opacity="0.4"/>
      <ellipse cx="-5" cy="-8" rx="4" ry="6" fill="white" opacity="0.3"/>

      {/* Stress cracks (visible when stressed) */}
      {isStressed && (
        <g opacity={stressLevel * 0.8}>
          <path d="M -5,-15 L 0,-5 L -3,5" stroke="#92400E" strokeWidth="0.5" fill="none" strokeDasharray="2,2"/>
          <path d="M 8,-10 L 5,0 L 10,8" stroke="#92400E" strokeWidth="0.5" fill="none" strokeDasharray="2,2"/>
        </g>
      )}
    </g>
  );
};

// -----------------------------
// Pixi.js Photo Hand Component (Mesh Deformation)
// -----------------------------

function PixiPhotoHand({ gripForce, eggState, breakReason, animationTime, onReset }) {
  const canvasRef = useRef(null);
  const pixiAppRef = useRef(null);
  const spriteRef = useRef(null);
  const displacementSpriteRef = useRef(null);
  const filterRef = useRef(null);
  const [isLoaded, setIsLoaded] = useState(false);
  const [error, setError] = useState(null);

  // Pixi.js アプリケーションの初期化
  useEffect(() => {
    let app = null;
    let destroyed = false;

    const init = async () => {
      const canvas = canvasRef.current;
      if (!canvas) {
        console.error('Canvas not found');
        return;
      }

      try {
        // Canvas サイズを取得
        const rect = canvas.getBoundingClientRect();
        const width = rect.width || 800;
        const height = rect.height || 450;

        app = new PIXI.Application();

        await app.init({
          width: width,
          height: height,
          backgroundColor: 0x1e293b,
          resolution: window.devicePixelRatio || 1,
          autoDensity: true,
          canvas: canvas,
        });

        if (destroyed) {
          app.destroy(true);
          return;
        }

        pixiAppRef.current = app;

        // 画像をロード
        const handTexture = await PIXI.Assets.load('/tesla-optimus-hands.jpg');

        if (destroyed) {
          app.destroy(true);
          return;
        }

        // Sprite を作成
        const sprite = new PIXI.Sprite(handTexture);

        // スケール調整してキャンバスにフィット
        const scale = Math.min(
          app.screen.width / sprite.texture.width,
          app.screen.height / sprite.texture.height
        );
        sprite.scale.set(scale);
        sprite.x = (app.screen.width - sprite.texture.width * scale) / 2;
        sprite.y = (app.screen.height - sprite.texture.height * scale) / 2;

        // DisplacementFilter 用のノイズテクスチャを作成
        const displacementCanvas = document.createElement('canvas');
        displacementCanvas.width = 256;
        displacementCanvas.height = 256;
        const ctx = displacementCanvas.getContext('2d');

        // グラデーション（中心から外側へ）を作成
        const gradient = ctx.createRadialGradient(128, 128, 0, 128, 128, 128);
        gradient.addColorStop(0, 'rgb(128, 128, 128)');
        gradient.addColorStop(1, 'rgb(128, 128, 128)');
        ctx.fillStyle = gradient;
        ctx.fillRect(0, 0, 256, 256);

        // 指のある領域に変位パターンを描く
        ctx.fillStyle = 'rgb(180, 140, 128)';
        ctx.beginPath();
        ctx.ellipse(160, 180, 60, 80, 0, 0, Math.PI * 2);
        ctx.fill();

        const displacementTexture = PIXI.Texture.from(displacementCanvas);
        const displacementSprite = new PIXI.Sprite(displacementTexture);
        displacementSprite.texture.source.addressMode = 'clamp';

        // DisplacementFilterを作成
        const displacementFilter = new PIXI.DisplacementFilter({
          sprite: displacementSprite,
          scale: 0,
        });

        sprite.filters = [displacementFilter];
        app.stage.addChild(sprite);
        app.stage.addChild(displacementSprite);
        displacementSprite.visible = false;

        spriteRef.current = sprite;
        displacementSpriteRef.current = displacementSprite;
        filterRef.current = displacementFilter;

        setIsLoaded(true);
      } catch (e) {
        console.error('Pixi.js initialization error:', e);
        setError(e.message);
      }
    };

    // DOMが準備されるまで少し待つ
    const timer = setTimeout(init, 100);

    return () => {
      clearTimeout(timer);
      destroyed = true;
      if (pixiAppRef.current) {
        pixiAppRef.current.destroy(true, { children: true, texture: true });
        pixiAppRef.current = null;
      }
    };
  }, []);

  // DisplacementFilter: gripForceに応じて変形
  useEffect(() => {
    const filter = filterRef.current;
    if (!filter || !isLoaded) return;

    // grip force を 0.0~1.0 に正規化
    const force = Math.min(Math.max(gripForce / 100, 0), 1);

    // 変位量を設定（握力が強いほど変形）
    const displacement = force * 30;
    filter.scale.x = displacement;
    filter.scale.y = displacement * 0.5;
  }, [gripForce, isLoaded]);

  // エラー時のフォールバック
  if (error) {
    return (
      <div className="w-full aspect-video bg-slate-800 rounded-xl flex items-center justify-center text-gray-400">
        <div className="text-center">
          <p>WebGL not supported</p>
          <p className="text-xs mt-1">Using fallback mode</p>
        </div>
      </div>
    );
  }

  return (
    <div className="relative w-full" style={{ aspectRatio: '16/9' }}>
      <canvas
        ref={canvasRef}
        className="w-full h-full rounded-xl"
        style={{ display: 'block', backgroundColor: '#1e293b' }}
      />

      {/* Egg overlay using CSS */}
      {isLoaded && (
        <div
          className="absolute pointer-events-none"
          style={{
            top: '52%',
            left: '50%',
            transform: 'translate(-50%, -50%)',
          }}
        >
          {eggState === 'broken' ? (
            // 割れた卵 - 黄身がぐしゃっと垂れる
            <div className="relative">
              {/* メインの黄身（潰れた形） */}
              <div
                className="bg-yellow-500 opacity-90"
                style={{
                  width: '50px',
                  height: '35px',
                  borderRadius: '50% 50% 40% 40%',
                  boxShadow: '0 0 15px rgba(234, 179, 8, 0.8)',
                }}
              />
              {/* 垂れる黄身1 */}
              <div
                className="absolute bg-yellow-500 opacity-85"
                style={{
                  width: '12px',
                  height: '45px',
                  left: '8px',
                  top: '25px',
                  borderRadius: '40% 40% 50% 50%',
                  background: 'linear-gradient(to bottom, #eab308 0%, #ca8a04 100%)',
                }}
              />
              {/* 垂れる黄身2 */}
              <div
                className="absolute bg-yellow-500 opacity-85"
                style={{
                  width: '10px',
                  height: '55px',
                  left: '25px',
                  top: '28px',
                  borderRadius: '40% 40% 50% 50%',
                  background: 'linear-gradient(to bottom, #eab308 0%, #ca8a04 100%)',
                }}
              />
              {/* 垂れる黄身3 */}
              <div
                className="absolute bg-yellow-500 opacity-80"
                style={{
                  width: '8px',
                  height: '35px',
                  left: '38px',
                  top: '22px',
                  borderRadius: '40% 40% 50% 50%',
                  background: 'linear-gradient(to bottom, #eab308 0%, #ca8a04 100%)',
                }}
              />
              {/* 殻の破片（白） */}
              <div
                className="absolute bg-amber-100 opacity-70"
                style={{
                  width: '15px',
                  height: '10px',
                  left: '-5px',
                  top: '5px',
                  borderRadius: '50%',
                  transform: 'rotate(-20deg)',
                }}
              />
              <div
                className="absolute bg-amber-100 opacity-70"
                style={{
                  width: '12px',
                  height: '8px',
                  left: '42px',
                  top: '8px',
                  borderRadius: '50%',
                  transform: 'rotate(25deg)',
                }}
              />
            </div>
          ) : eggState === 'stressed' ? (
            // ヒビが入った卵
            <div
              className="relative w-12 h-16 transition-all duration-150"
              style={{
                transform: `scale(${1 - (gripForce / 100) * 0.15})`,
              }}
            >
              {/* 卵本体 */}
              <div
                className="w-full h-full bg-gradient-to-b from-amber-100 to-amber-200 border-2 border-amber-300"
                style={{
                  borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
                }}
              />
              {/* ヒビ1 - メイン */}
              <svg
                className="absolute inset-0 w-full h-full"
                viewBox="0 0 48 64"
                fill="none"
                stroke="#8B4513"
                strokeWidth="1.5"
                strokeLinecap="round"
              >
                <path d="M24 8 L20 18 L26 24 L18 32 L24 38" />
                <path d="M20 18 L14 22" />
                <path d="M26 24 L32 22" />
                <path d="M18 32 L12 36" />
              </svg>
              {/* ヒビ2 - サブ */}
              <svg
                className="absolute inset-0 w-full h-full"
                viewBox="0 0 48 64"
                fill="none"
                stroke="#8B4513"
                strokeWidth="1"
                strokeLinecap="round"
                opacity="0.7"
              >
                <path d="M34 15 L30 22 L35 28" />
                <path d="M30 22 L26 20" />
              </svg>
            </div>
          ) : (
            // 正常な卵
            <div
              className="w-12 h-16 bg-gradient-to-b from-amber-100 to-amber-200 border-2 border-amber-300 transition-all duration-150"
              style={{
                borderRadius: '50% 50% 50% 50% / 60% 60% 40% 40%',
                transform: `scale(${1 - (gripForce / 100) * 0.15})`,
              }}
            />
          )}
        </div>
      )}

      {/* Status overlay */}
      <div className="absolute top-2 right-2 bg-black/70 text-white p-2 rounded text-sm">
        <div className="text-xs text-gray-400">Grip: {gripForce.toFixed(0)}%</div>
        {eggState === 'broken' && (
          <div className="text-red-400 font-bold mt-1">
            {breakReason === 'crush' ? 'CRUSHED!' : 'DROPPED!'}
          </div>
        )}
        <button
          onClick={onReset}
          className="mt-2 px-2 py-1 bg-blue-600 hover:bg-blue-700 rounded text-xs w-full"
        >
          Reset
        </button>
      </div>

      {/* Loading indicator */}
      {!isLoaded && !error && (
        <div className="absolute inset-0 flex items-center justify-center bg-slate-900/80 rounded-xl">
          <div className="text-gray-400">Loading...</div>
        </div>
      )}
    </div>
  );
}

// -----------------------------
// Pixi Egg Grip Game Component (with mesh deformation)
// -----------------------------

function PixiEggGripGame({ noiseLevel, naiveNoiseLevel, noiseMode = 'mixed', bits, isAnimating }) {
  const [gripForce, setGripForce] = useState(60);
  const [gameActive, setGameActive] = useState(true);
  const [animTime, setAnimTime] = useState(0);
  const animRef = useRef(null);

  // Animation loop
  useEffect(() => {
    if (gameActive && isAnimating) {
      const animate = () => {
        setAnimTime(t => t + 0.016);
        animRef.current = requestAnimationFrame(animate);
      };
      animRef.current = requestAnimationFrame(animate);
    }
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [gameActive, isAnimating]);

  const eggPhysics = useEggPhysics({
    targetGripForce: gripForce,
    noiseLevel: noiseLevel,
    naiveNoiseLevel: naiveNoiseLevel,
    noiseMode: noiseMode,
    animationTime: animTime,
    isEnabled: gameActive,
  });

  const handleReset = () => {
    eggPhysics.resetEgg();
    setGripForce(60);
  };

  return (
    <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
      <div className="flex justify-between items-center mb-3">
        <h3 className="text-gray-300 font-medium text-sm flex items-center gap-2">
          <span className="text-lg">🎮</span> Pixi Mode - Mesh Deformation
        </h3>
        <span className={`px-2 py-0.5 rounded text-xs font-bold ${
          eggPhysics.eggState === EGG_STATES.BROKEN ? 'bg-red-500/20 text-red-400' :
          eggPhysics.isInSafeZone ? 'bg-green-500/20 text-green-400' :
          'bg-yellow-500/20 text-yellow-400'
        }`}>
          {eggPhysics.eggState === EGG_STATES.BROKEN
            ? (eggPhysics.breakReason === 'crush' ? 'CRUSHED!' : 'DROPPED!')
            : eggPhysics.isInSafeZone ? 'SAFE' : 'DANGER'}
        </span>
      </div>

      {/* Pixi Canvas + Pressure Gauge */}
      <div className="flex gap-3 mb-3">
        <div className="flex-1">
          <PixiPhotoHand
            gripForce={gripForce}
            eggState={eggPhysics.eggState}
            breakReason={eggPhysics.breakReason}
            animationTime={animTime}
            onReset={handleReset}
          />
        </div>
        {/* Pressure gauge */}
        <div className="flex flex-col items-center justify-center">
          <PressureGauge
            pressure={eggPhysics.actualPressure}
            breakThreshold={BREAK_THRESHOLD}
            stressThreshold={STRESS_THRESHOLD}
            safeMin={SAFE_ZONE_MIN}
            safeMax={SAFE_ZONE_MAX}
            noiseHistory={eggPhysics.noiseHistory}
          />
        </div>
      </div>

      {/* Grip Force Slider */}
      <div className="space-y-2">
        <div className="flex justify-between text-xs text-gray-400">
          <span>Grip Force: {gripForce.toFixed(0)}%</span>
          <span>Actual: {eggPhysics.actualPressure.toFixed(1)}%</span>
        </div>
        <input
          type="range"
          min="0"
          max="100"
          value={gripForce}
          onChange={(e) => setGripForce(Number(e.target.value))}
          className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
          disabled={eggPhysics.eggState === EGG_STATES.BROKEN}
        />
        <div className="flex justify-between text-xs text-gray-500">
          <span>Too Weak (Drop)</span>
          <span className="text-green-400">Safe Zone</span>
          <span>Too Strong (Crush)</span>
        </div>
      </div>

      {/* Stats */}
      <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
        <div className="bg-slate-800/50 rounded p-2">
          <div className="text-gray-400">Score</div>
          <div className="text-cyan-400 font-mono">{eggPhysics.score}</div>
        </div>
        <div className="bg-slate-800/50 rounded p-2">
          <div className="text-gray-400">Safe Time</div>
          <div className="text-green-400 font-mono">{eggPhysics.safeTime.toFixed(1)}s</div>
        </div>
        <div className="bg-slate-800/50 rounded p-2">
          <div className="text-gray-400">Noise ({noiseMode === 'naive' ? 'Naive' : 'Log/Exp'})</div>
          <div className="text-yellow-400 font-mono">{(eggPhysics.effectiveNoise * 100).toFixed(1)}%</div>
        </div>
      </div>
    </div>
  );
}

// -----------------------------
// Photo Egg Grip Game Component
// -----------------------------

function PhotoEggGripGame({ noiseLevel, naiveNoiseLevel, noiseMode = 'mixed', bits, isAnimating }) {
  const [gripForce, setGripForce] = useState(60); // 初期値を安全ゾーン内に
  const [gameActive, setGameActive] = useState(true);
  const [showCrackEffect, setShowCrackEffect] = useState(false);
  const [animTime, setAnimTime] = useState(0);
  const animRef = useRef(null);

  // 卵の位置（画像サイズ 1920x1080 基準で調整）
  const EGG_X = 920;
  const EGG_Y = 580;
  const EGG_SCALE = 1.2;

  // Animation loop
  useEffect(() => {
    if (gameActive && isAnimating) {
      const animate = () => {
        setAnimTime(t => t + 0.016);
        animRef.current = requestAnimationFrame(animate);
      };
      animRef.current = requestAnimationFrame(animate);
    }
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [gameActive, isAnimating]);

  const eggPhysics = useEggPhysics({
    targetGripForce: gripForce,
    noiseLevel: noiseLevel,
    naiveNoiseLevel: naiveNoiseLevel,
    noiseMode: noiseMode,
    animationTime: animTime,
    isEnabled: gameActive,
  });

  // Crack effect when egg breaks
  useEffect(() => {
    if (eggPhysics.eggState === EGG_STATES.BROKEN) {
      setShowCrackEffect(true);
      setTimeout(() => setShowCrackEffect(false), 500);
    }
  }, [eggPhysics.eggState]);

  const handleReset = () => {
    eggPhysics.resetEgg();
    setGripForce(60); // 安全ゾーン内にリセット
  };

  const { eggState, actualPressure, breakReason, weakDuration, DROP_TIME_TO_BREAK } = eggPhysics;

  return (
    <div className={`relative ${showCrackEffect ? 'animate-pulse' : ''}`}>
      {/* Crack flash overlay */}
      {showCrackEffect && (
        <div className="absolute inset-0 bg-red-500/30 rounded-xl z-10 pointer-events-none"/>
      )}

      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-gray-300 font-medium text-sm flex items-center gap-2">
            <span className="text-lg">📷</span> Photo Mode - Egg Grip
          </h3>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${
              eggState === EGG_STATES.BROKEN ? 'bg-red-500/20 text-red-400' :
              eggPhysics.isInSafeZone ? 'bg-green-500/20 text-green-400' :
              'bg-yellow-500/20 text-yellow-400'
            }`}>
              {eggState === EGG_STATES.BROKEN
                ? (breakReason === 'crush' ? 'CRUSHED!' : 'DROPPED!')
                : eggPhysics.isInSafeZone ? 'SAFE' : 'DANGER'}
            </span>
            <button
              onClick={handleReset}
              className="px-2 py-0.5 bg-slate-700 hover:bg-slate-600 rounded text-xs text-gray-300"
            >
              Reset
            </button>
          </div>
        </div>

        {/* Photo with Egg Overlay */}
        <div className="relative w-full mb-3">
          <img
            src="/tesla-optimus-hands.jpg"
            alt="Optimus hands"
            className="w-full rounded-lg"
          />
          <svg
            className="absolute top-0 left-0 w-full h-full pointer-events-none"
            viewBox="0 0 1920 1080"
            preserveAspectRatio="xMidYMid meet"
          >
            <defs>
              {/* Finger gradient */}
              <linearGradient id="photoFingerGradient" x1="0%" y1="0%" x2="100%" y2="0%">
                <stop offset="0%" stopColor="#E5E7EB" stopOpacity="0.9"/>
                <stop offset="50%" stopColor="#F3F4F6" stopOpacity="0.95"/>
                <stop offset="100%" stopColor="#D1D5DB" stopOpacity="0.9"/>
              </linearGradient>
            </defs>

            {/* Finger indicators - move based on grip force */}
            <g transform={`translate(${EGG_X}, ${EGG_Y})`}>
              {/* Left fingers */}
              {[0, 1, 2].map((i) => {
                const fingerGrip = (gripForce / 100) * 60;
                const baseX = -120 + fingerGrip;
                const yOffset = (i - 1) * 35;
                return (
                  <g key={`left-${i}`} style={{transition: 'transform 0.15s ease-out'}}>
                    <rect
                      x={baseX}
                      y={yOffset - 12}
                      width="45"
                      height="24"
                      rx="8"
                      fill="url(#photoFingerGradient)"
                      stroke="#9CA3AF"
                      strokeWidth="1"
                      style={{transition: 'x 0.15s ease-out'}}
                    />
                    {/* Finger joint lines */}
                    <line x1={baseX + 15} y1={yOffset - 10} x2={baseX + 15} y2={yOffset + 10} stroke="#6B7280" strokeWidth="1" opacity="0.5"/>
                    <line x1={baseX + 30} y1={yOffset - 10} x2={baseX + 30} y2={yOffset + 10} stroke="#6B7280" strokeWidth="1" opacity="0.5"/>
                  </g>
                );
              })}

              {/* Thumb (right side, angled) */}
              {(() => {
                const fingerGrip = (gripForce / 100) * 50;
                const thumbX = 80 - fingerGrip;
                return (
                  <g style={{transition: 'transform 0.15s ease-out'}}>
                    <rect
                      x={thumbX}
                      y={-15}
                      width="50"
                      height="30"
                      rx="10"
                      fill="url(#photoFingerGradient)"
                      stroke="#9CA3AF"
                      strokeWidth="1"
                      transform={`rotate(-20, ${thumbX + 25}, 0)`}
                      style={{transition: 'x 0.15s ease-out'}}
                    />
                  </g>
                );
              })()}
            </g>

            {/* Egg */}
            <g transform={`translate(${EGG_X}, ${EGG_Y}) scale(${EGG_SCALE})`}>
              <EggObject
                state={eggState}
                pressure={actualPressure}
                animationTime={animTime}
              />
            </g>
          </svg>

          {/* Drop warning indicator */}
          {actualPressure < SAFE_ZONE_MIN && eggState !== EGG_STATES.BROKEN && (
            <div className="absolute bottom-2 left-2 bg-yellow-500/80 text-black px-2 py-1 rounded text-xs font-bold">
              SLIPPING! {((DROP_TIME_TO_BREAK - weakDuration) * 1000).toFixed(0)}ms
            </div>
          )}
        </div>

        {/* Grip Force Slider */}
        <div className="space-y-2">
          <div className="flex justify-between text-xs text-gray-400">
            <span>Grip Force: {gripForce.toFixed(0)}%</span>
            <span>Actual: {actualPressure.toFixed(1)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            value={gripForce}
            onChange={(e) => setGripForce(Number(e.target.value))}
            className="w-full h-2 bg-slate-700 rounded-lg appearance-none cursor-pointer"
            disabled={eggState === EGG_STATES.BROKEN}
          />
          <div className="flex justify-between text-xs text-gray-500">
            <span>Too Weak (Drop)</span>
            <span className="text-green-400">Safe Zone</span>
            <span>Too Strong (Crush)</span>
          </div>
        </div>

        {/* Stats */}
        <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
          <div className="bg-slate-800/50 rounded p-2">
            <div className="text-gray-400">Score</div>
            <div className="text-cyan-400 font-mono">{eggPhysics.score}</div>
          </div>
          <div className="bg-slate-800/50 rounded p-2">
            <div className="text-gray-400">Safe Time</div>
            <div className="text-green-400 font-mono">{eggPhysics.safeTime.toFixed(1)}s</div>
          </div>
          <div className="bg-slate-800/50 rounded p-2">
            <div className="text-gray-400">Noise ({noiseMode === 'naive' ? 'Naive' : 'Log/Exp'})</div>
            <div className="text-yellow-400 font-mono">{(eggPhysics.effectiveNoise * 100).toFixed(1)}%</div>
          </div>
        </div>
      </div>
    </div>
  );
}

// -----------------------------
// Pressure Gauge Component
// -----------------------------

const PressureGauge = ({ pressure, breakThreshold, stressThreshold, safeMin, safeMax, noiseHistory }) => {
  const gaugeHeight = 150;
  const gaugeWidth = 30;

  const pressureY = gaugeHeight - (pressure / 100) * gaugeHeight;
  const breakY = gaugeHeight - (breakThreshold / 100) * gaugeHeight;
  const stressY = gaugeHeight - (stressThreshold / 100) * gaugeHeight;
  const safeMinY = gaugeHeight - (safeMin / 100) * gaugeHeight;
  const safeMaxY = gaugeHeight - (safeMax / 100) * gaugeHeight;

  // Determine bar color
  let barColor = '#22C55E'; // Green - safe
  if (pressure >= breakThreshold) {
    barColor = '#EF4444'; // Red - broken
  } else if (pressure >= stressThreshold) {
    barColor = '#F97316'; // Orange - stress
  } else if (pressure >= safeMin && pressure <= safeMax) {
    barColor = '#22C55E'; // Green - safe zone
  } else {
    barColor = '#3B82F6'; // Blue - normal
  }

  return (
    <svg width="60" height={gaugeHeight + 40} className="overflow-visible">
      {/* Background */}
      <rect x="15" y="10" width={gaugeWidth} height={gaugeHeight} rx="4" fill="#1F2937" stroke="#374151"/>

      {/* Safe zone highlight */}
      <rect x="16" y={safeMaxY + 10} width={gaugeWidth - 2} height={safeMinY - safeMaxY} fill="#22C55E" opacity="0.15"/>

      {/* Danger zone */}
      <rect x="16" y="10" width={gaugeWidth - 2} height={breakY} fill="#EF4444" opacity="0.1"/>

      {/* Current pressure bar */}
      <rect x="18" y={pressureY + 10} width={gaugeWidth - 6} height={gaugeHeight - pressureY} rx="2"
            fill={barColor} style={{transition: 'all 0.05s ease-out'}}/>

      {/* Threshold lines */}
      <line x1="10" y1={breakY + 10} x2="50" y2={breakY + 10} stroke="#EF4444" strokeWidth="2" strokeDasharray="4,2"/>
      <line x1="10" y1={stressY + 10} x2="50" y2={stressY + 10} stroke="#F97316" strokeWidth="1" strokeDasharray="3,2"/>
      <line x1="10" y1={safeMaxY + 10} x2="50" y2={safeMaxY + 10} stroke="#22C55E" strokeWidth="1"/>
      <line x1="10" y1={safeMinY + 10} x2="50" y2={safeMinY + 10} stroke="#22C55E" strokeWidth="1"/>

      {/* Labels */}
      <text x="55" y={breakY + 14} fill="#EF4444" fontSize="8" fontFamily="monospace">BREAK</text>
      <text x="55" y={safeMaxY + 14} fill="#22C55E" fontSize="7" fontFamily="monospace">SAFE</text>

      {/* Current value */}
      <text x="30" y={gaugeHeight + 30} fill="#E5E7EB" fontSize="12" fontFamily="monospace" textAnchor="middle" fontWeight="bold">
        {pressure.toFixed(0)}%
      </text>

      {/* Noise indicator (flickering line showing recent values) */}
      {noiseHistory && noiseHistory.length > 1 && (
        <path
          d={noiseHistory.map((p, i) => {
            const x = 15 + (i / noiseHistory.length) * gaugeWidth;
            const y = gaugeHeight - (p / 100) * gaugeHeight + 10;
            return `${i === 0 ? 'M' : 'L'} ${x} ${y}`;
          }).join(' ')}
          stroke="#06B6D4"
          strokeWidth="1"
          fill="none"
          opacity="0.5"
        />
      )}
    </svg>
  );
};

// -----------------------------
// Egg Grip Game Component
// -----------------------------

function EggGripGame({ noiseLevel, naiveNoiseLevel, noiseMode = 'mixed', bits, isAnimating }) {
  const [gripForce, setGripForce] = useState(60); // 初期値を安全ゾーン内に
  const [gameActive, setGameActive] = useState(true);
  const [showCrackEffect, setShowCrackEffect] = useState(false);
  const [animTime, setAnimTime] = useState(0);
  const animRef = useRef(null);

  // Animation loop for the game
  useEffect(() => {
    if (gameActive && isAnimating) {
      const animate = () => {
        setAnimTime(t => t + 0.016);
        animRef.current = requestAnimationFrame(animate);
      };
      animRef.current = requestAnimationFrame(animate);
    }
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [gameActive, isAnimating]);

  const eggPhysics = useEggPhysics({
    targetGripForce: gripForce,
    noiseLevel: noiseLevel,
    naiveNoiseLevel: naiveNoiseLevel,
    noiseMode: noiseMode,
    animationTime: animTime,
    isEnabled: gameActive,
  });

  // Crack effect when egg breaks
  useEffect(() => {
    if (eggPhysics.eggState === EGG_STATES.BROKEN) {
      setShowCrackEffect(true);
      setTimeout(() => setShowCrackEffect(false), 500);
    }
  }, [eggPhysics.eggState]);

  const handleReset = () => {
    eggPhysics.resetEgg();
    setGripForce(60); // 安全ゾーン内にリセット
  };

  const stressLevel = eggPhysics.actualPressure >= STRESS_THRESHOLD
    ? (eggPhysics.actualPressure - STRESS_THRESHOLD) / (BREAK_THRESHOLD - STRESS_THRESHOLD)
    : 0;

  return (
    <div className={`relative ${showCrackEffect ? 'animate-pulse' : ''}`}>
      {/* Crack flash overlay */}
      {showCrackEffect && (
        <div className="absolute inset-0 bg-red-500/30 rounded-xl z-10 pointer-events-none"/>
      )}

      <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
        <div className="flex justify-between items-center mb-3">
          <h3 className="text-gray-300 font-medium text-sm flex items-center gap-2">
            <span className="text-lg">🥚</span> Egg Grip Challenge
          </h3>
          <div className="flex items-center gap-2">
            <span className={`px-2 py-0.5 rounded text-xs font-bold ${
              eggPhysics.eggState === EGG_STATES.BROKEN ? 'bg-red-500/20 text-red-400' :
              eggPhysics.isInSafeZone ? 'bg-green-500/20 text-green-400' :
              'bg-blue-500/20 text-blue-400'
            }`}>
              {eggPhysics.eggState === EGG_STATES.BROKEN ? 'CRACKED!' :
               eggPhysics.isInSafeZone ? 'SAFE' : 'HOLDING'}
            </span>
          </div>
        </div>

        <div className="flex gap-4">
          {/* Egg visualization */}
          <div className="flex-1">
            <svg width="180" height="160" className="bg-slate-950 rounded-lg">
              <defs>
                <radialGradient id="eggGradientDetailed" cx="35%" cy="30%" r="65%">
                  <stop offset="0%" stopColor="#FEF9C3"/>
                  <stop offset="30%" stopColor="#FEF3C7"/>
                  <stop offset="60%" stopColor="#FDE68A"/>
                  <stop offset="100%" stopColor="#F59E0B"/>
                </radialGradient>
                <pattern id="gripGrid" width="10" height="10" patternUnits="userSpaceOnUse">
                  <path d="M 10 0 L 0 0 0 10" fill="none" stroke="#1F2937" strokeWidth="0.5"/>
                </pattern>
              </defs>
              <rect width="180" height="160" fill="url(#gripGrid)"/>

              {/* Hand silhouette (simplified) */}
              <g transform="translate(90, 85)">
                {/* Fingers coming from sides based on grip */}
                {[-1, 1].map((side, i) => {
                  const fingerGrip = (gripForce / 100) * 25;
                  return (
                    <g key={i}>
                      <rect
                        x={side * (45 - fingerGrip)}
                        y="-30"
                        width="12"
                        height="60"
                        rx="6"
                        fill="#374151"
                        opacity="0.6"
                        style={{transition: 'x 0.1s ease-out'}}
                      />
                      <rect
                        x={side * (45 - fingerGrip) + 1}
                        y="-28"
                        width="10"
                        height="56"
                        rx="5"
                        fill="url(#optimusShellGradient)"
                        opacity="0.8"
                        style={{transition: 'x 0.1s ease-out'}}
                      />
                    </g>
                  );
                })}

                {/* Egg */}
                <EggObject
                  state={eggPhysics.eggState}
                  pressure={eggPhysics.actualPressure}
                  stressLevel={stressLevel}
                  animationTime={animTime}
                />
              </g>

              {/* Noise level indicator */}
              <text x="10" y="150" fill="#6B7280" fontSize="8" fontFamily="monospace">
                Noise: {(eggPhysics.effectiveNoise * 100).toFixed(1)}% ({bits}-bit {noiseMode === 'naive' ? 'Naive' : 'Log/Exp'})
              </text>
            </svg>
          </div>

          {/* Pressure gauge */}
          <div className="flex flex-col items-center">
            <PressureGauge
              pressure={eggPhysics.actualPressure}
              breakThreshold={BREAK_THRESHOLD}
              stressThreshold={STRESS_THRESHOLD}
              safeMin={SAFE_ZONE_MIN}
              safeMax={SAFE_ZONE_MAX}
              noiseHistory={eggPhysics.noiseHistory}
            />
          </div>
        </div>

        {/* Controls */}
        <div className="mt-4 space-y-3">
          {/* Grip slider */}
          <div>
            <div className="flex justify-between text-xs text-gray-500 mb-1">
              <span>Grip Strength</span>
              <span className="font-mono text-cyan-400">{gripForce.toFixed(0)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={gripForce}
              onChange={(e) => setGripForce(parseFloat(e.target.value))}
              disabled={eggPhysics.eggState === EGG_STATES.BROKEN}
              className="w-full accent-cyan-500 disabled:opacity-50"
            />
            <div className="flex justify-between text-[10px] text-gray-600">
              <span>Release</span>
              <span className="text-green-500">Safe Zone</span>
              <span className="text-red-500">Crush</span>
            </div>
          </div>

          {/* Stats and reset */}
          <div className="flex justify-between items-center">
            <div className="text-xs text-gray-400 space-x-4">
              <span>Score: <span className="text-cyan-400 font-mono">{eggPhysics.score}</span></span>
              <span>Peak: <span className="text-orange-400 font-mono">{eggPhysics.peakPressure.toFixed(0)}%</span></span>
            </div>
            <button
              onClick={handleReset}
              className="px-3 py-1 bg-slate-700 hover:bg-slate-600 rounded text-xs text-gray-300 transition-colors"
            >
              🔄 New Egg
            </button>
          </div>

          {/* Hint */}
          <div className="text-[10px] text-gray-500 bg-slate-800/50 rounded p-2">
            💡 <span className="text-cyan-400">Lower bits</span> = more noise = harder to control.
            Try to keep pressure in the <span className="text-green-400">green zone</span> (50-75%) without breaking!
          </div>
        </div>
      </div>
    </div>
  );
}

// -----------------------------
// SVG Definitions Component
// -----------------------------

const SvgDefs = () => (
  <defs>
    {/* Optimus Shell Gradient - White to Light Gray */}
    <linearGradient id="optimusShellGradient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stopColor="#FFFFFF" />
      <stop offset="30%" stopColor="#F3F4F6" />
      <stop offset="70%" stopColor="#E5E7EB" />
      <stop offset="100%" stopColor="#D1D5DB" />
    </linearGradient>
    
    {/* Joint Gradient - Dark Metal */}
    <linearGradient id="jointGradient" x1="0%" y1="0%" x2="100%" y2="100%">
      <stop offset="0%" stopColor="#374151" />
      <stop offset="50%" stopColor="#1F2937" />
      <stop offset="100%" stopColor="#111827" />
    </linearGradient>
    
    {/* Hologram Glow */}
    <filter id="hologramGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="2" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    
    {/* Error Glow */}
    <filter id="errorGlow" x="-50%" y="-50%" width="200%" height="200%">
      <feGaussianBlur stdDeviation="1.5" result="coloredBlur"/>
      <feMerge>
        <feMergeNode in="coloredBlur"/>
        <feMergeNode in="SourceGraphic"/>
      </feMerge>
    </filter>
    
    {/* Grid Pattern */}
    <pattern id="gridPattern" width="20" height="20" patternUnits="userSpaceOnUse">
      <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1F2937" strokeWidth="0.5"/>
    </pattern>
    
    {/* Palm Gradient */}
    <linearGradient id="palmGradient" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stopColor="#374151" />
      <stop offset="100%" stopColor="#111827" />
    </linearGradient>
    
    {/* Egg Gradient */}
    <radialGradient id="eggGradient" cx="40%" cy="30%" r="60%">
      <stop offset="0%" stopColor="#FEF3C7" />
      <stop offset="50%" stopColor="#FCD34D" />
      <stop offset="100%" stopColor="#D97706" />
    </radialGradient>

    {/* Gold Joint Band Gradient - Like Tesla Optimus finger joints */}
    <linearGradient id="goldJointGradient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stopColor="#F59E0B" />
      <stop offset="30%" stopColor="#D97706" />
      <stop offset="70%" stopColor="#B45309" />
      <stop offset="100%" stopColor="#92400E" />
    </linearGradient>

    {/* Actuator Gradient - Black cylinder */}
    <linearGradient id="actuatorGradient" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stopColor="#1F2937" />
      <stop offset="30%" stopColor="#374151" />
      <stop offset="50%" stopColor="#4B5563" />
      <stop offset="70%" stopColor="#374151" />
      <stop offset="100%" stopColor="#1F2937" />
    </linearGradient>

    {/* Finger Shell Gradient - Whiter for fingers */}
    <linearGradient id="fingerShellGradient" x1="0%" y1="0%" x2="0%" y2="100%">
      <stop offset="0%" stopColor="#FFFFFF" />
      <stop offset="40%" stopColor="#F9FAFB" />
      <stop offset="100%" stopColor="#E5E7EB" />
    </linearGradient>
  </defs>
);

// -----------------------------
// Optimus Style SVG Components
// -----------------------------

const OptimusLimb = ({ x1, y1, x2, y2, width, type = "arm" }) => {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const angle = Math.atan2(dy, dx) * (180 / Math.PI);
  const length = Math.sqrt(dx * dx + dy * dy);

  return (
    <g transform={`translate(${x1}, ${y1}) rotate(${angle})`}>
      {/* Inner mechanical structure (black) */}
      <rect x={2} y={-width/2 + 3} width={length - 4} height={width - 6} rx={width/4} fill="#111827" />
      
      {/* Outer shell (white) */}
      {type === "upperArm" && (
        <path 
          d={`M 4,${-width/2} 
              C ${length*0.3},${-width/2 - 2} ${length*0.7},${-width/2 + 2} ${length - 8},${-width/2 + 4}
              Q ${length - 2},0 ${length - 8},${width/2 - 4}
              C ${length*0.7},${width/2 - 2} ${length*0.3},${width/2 + 2} 4,${width/2}
              Q -2,0 4,${-width/2}`}
          fill="url(#optimusShellGradient)" 
          stroke="#9CA3AF" strokeWidth="0.5"
        />
      )}
      {type === "forearm" && (
        <path 
          d={`M 3,${-width/2 + 2} 
              L ${length - 6},${-width/2 + 3} 
              Q ${length},0 ${length - 6},${width/2 - 3} 
              L 3,${width/2 - 2} 
              Q -2,0 3,${-width/2 + 2}`}
          fill="url(#optimusShellGradient)" 
          stroke="#9CA3AF" strokeWidth="0.5"
        />
      )}
      {type === "thigh" && (
        <path 
          d={`M 3,${-width/2} 
              L ${length - 3},${-width/2 + 5} 
              L ${length - 3},${width/2 - 5} 
              L 3,${width/2} 
              Q -2,0 3,${-width/2}`}
          fill="url(#optimusShellGradient)"
          stroke="#9CA3AF" strokeWidth="0.5"
        />
      )}
      {type === "shin" && (
        <path 
          d={`M 3,${-width/2 + 2} 
              L ${length - 2},${-width/2 + 4} 
              L ${length - 2},${width/2 - 4} 
              L 3,${width/2 - 2} 
              Q -2,0 3,${-width/2 + 2}`}
          fill="url(#optimusShellGradient)"
          stroke="#9CA3AF" strokeWidth="0.5"
        />
      )}
      {type === "finger" && (
        <rect x={1} y={-width/2 + 1} width={length - 2} height={width - 2} rx={width/2} 
              fill="url(#optimusShellGradient)" stroke="#9CA3AF" strokeWidth="0.3"/>
      )}
      
      {/* Highlight line */}
      <path d={`M ${length*0.1},${-width/3} L ${length*0.5},${-width/3}`} 
            stroke="white" strokeWidth="1.5" opacity="0.4" strokeLinecap="round"/>
    </g>
  );
};

const OptimusJoint = ({ cx, cy, r }) => (
  <g>
    {/* Outer ring */}
    <circle cx={cx} cy={cy} r={r} fill="url(#jointGradient)" stroke="#4B5563" strokeWidth="1.5" />
    {/* Middle ring */}
    <circle cx={cx} cy={cy} r={r * 0.6} fill="#374151" stroke="#4B5563" strokeWidth="0.5"/>
    {/* Inner highlight */}
    <circle cx={cx} cy={cy} r={r * 0.25} fill="#6B7280" />
    {/* Center dot */}
    <circle cx={cx - r*0.15} cy={cy - r*0.15} r={r * 0.1} fill="#9CA3AF" opacity="0.6"/>
  </g>
);

const HologramLimb = ({ x1, y1, x2, y2, width }) => (
  <g filter="url(#hologramGlow)">
    <line 
      x1={x1} y1={y1} x2={x2} y2={y2} 
      stroke="#06B6D4" strokeWidth={Math.max(2, width * 0.4)} 
      strokeLinecap="round" opacity="0.5" 
      strokeDasharray="4 3"
    />
  </g>
);

// -----------------------------
// Robot Arm with Egg - Tesla Optimus Style
// -----------------------------

function RobotArmVisualization({
  shoulderAngle, elbowAngle, wristAngle,
  shoulderError, elbowError, wristError,
  showError, label, gripStrength = 0.5
}) {
  const shoulderX = 130, shoulderY = 90;
  const upperArmLength = 68, forearmLength = 58, handLength = 28;

  // Ideal (Hologram)
  const shRad = (shoulderAngle * Math.PI) / 180;
  const elX = shoulderX + upperArmLength * Math.cos(shRad);
  const elY = shoulderY + upperArmLength * Math.sin(shRad);
  const elRad = shRad + (elbowAngle * Math.PI) / 180;
  const wrX = elX + forearmLength * Math.cos(elRad);
  const wrY = elY + forearmLength * Math.sin(elRad);
  const wrRad = elRad + (wristAngle * Math.PI) / 180;
  const haX = wrX + handLength * Math.cos(wrRad);
  const haY = wrY + handLength * Math.sin(wrRad);

  // Actual (with Error)
  const shRadErr = ((shoulderAngle + shoulderError) * Math.PI) / 180;
  const elXErr = shoulderX + upperArmLength * Math.cos(shRadErr);
  const elYErr = shoulderY + upperArmLength * Math.sin(shRadErr);
  const elRadErr = shRadErr + ((elbowAngle + elbowError) * Math.PI) / 180;
  const wrXErr = elXErr + forearmLength * Math.cos(elRadErr);
  const wrYErr = elYErr + forearmLength * Math.sin(elRadErr);
  const wrRadErr = elRadErr + ((wristAngle + wristError) * Math.PI) / 180;
  const haXErr = wrXErr + handLength * Math.cos(wrRadErr);
  const haYErr = wrYErr + handLength * Math.sin(wrRadErr);

  const tipError = Math.sqrt(Math.pow(haX - haXErr, 2) + Math.pow(haY - haYErr, 2));

  // Calculate arm segment angles for actuator positioning
  const upperArmAngleDeg = shRadErr * (180 / Math.PI);
  const forearmAngleDeg = elRadErr * (180 / Math.PI);

  return (
    <div className="flex flex-col items-center">
      <svg width="280" height="240" className="bg-slate-950 rounded-xl shadow-2xl">
        <SvgDefs />
        <rect width="280" height="240" fill="url(#gridPattern)" />

        {/* Torso - More detailed Optimus style */}
        <path d="M 92,78 Q 130,62 168,78 L 160,180 Q 130,195 100,180 Z"
              fill="#111827" stroke="#374151" strokeWidth="1"/>
        {/* White chest panel */}
        <path d="M 98,85 Q 130,72 162,85 L 157,150 Q 130,162 103,150 Z"
              fill="url(#optimusShellGradient)" stroke="#9CA3AF" strokeWidth="0.5"/>
        {/* Chest detail lines */}
        <path d="M 105,95 L 155,95" stroke="#D1D5DB" strokeWidth="0.5" opacity="0.5"/>
        <path d="M 107,110 L 153,110" stroke="#D1D5DB" strokeWidth="0.5" opacity="0.5"/>
        {/* TESLA text */}
        <text x="130" y="130" fill="#6B7280" fontSize="8" fontFamily="Arial" fontWeight="bold" textAnchor="middle" letterSpacing="2">
          TESLA
        </text>

        {/* Hologram (ideal position) */}
        <HologramLimb x1={shoulderX} y1={shoulderY} x2={elX} y2={elY} width={20} />
        <HologramLimb x1={elX} y1={elY} x2={wrX} y2={wrY} width={16} />
        <HologramLimb x1={wrX} y1={wrY} x2={haX} y2={haY} width={12} />
        <circle cx={haX} cy={haY} r={3} fill="#06B6D4" opacity="0.6" filter="url(#hologramGlow)"/>

        {/* Actual Optimus Arm */}
        {showError && (
          <>
            {/* Upper Arm - with visible actuator */}
            <g transform={`translate(${shoulderX}, ${shoulderY}) rotate(${upperArmAngleDeg})`}>
              {/* Black actuator cylinder (inner) */}
              <rect x={8} y={-8} width={upperArmLength - 20} height={16} rx={8}
                    fill="url(#actuatorGradient)"/>
              {/* White shell panels (outer) */}
              <path d={`M 5,${-11} L ${upperArmLength - 12},${-9} Q ${upperArmLength - 5},0 ${upperArmLength - 12},9 L 5,11 Q -2,0 5,${-11}`}
                    fill="url(#optimusShellGradient)" stroke="#9CA3AF" strokeWidth="0.5"/>
              {/* Highlight */}
              <path d={`M 10,-8 L ${upperArmLength * 0.5},-8`} stroke="white" strokeWidth="1.5" opacity="0.3" strokeLinecap="round"/>
            </g>

            {/* Shoulder joint - Large black with gold ring */}
            <circle cx={shoulderX} cy={shoulderY} r={14} fill="#111827" stroke="#374151" strokeWidth="2"/>
            <circle cx={shoulderX} cy={shoulderY} r={11} fill="url(#jointGradient)"/>
            <circle cx={shoulderX} cy={shoulderY} r={7} fill="url(#goldJointGradient)" opacity="0.7"/>
            <circle cx={shoulderX} cy={shoulderY} r={4} fill="#4B5563"/>

            {/* Forearm - with actuator */}
            <g transform={`translate(${elXErr}, ${elYErr}) rotate(${forearmAngleDeg})`}>
              {/* Black actuator cylinder */}
              <rect x={6} y={-6} width={forearmLength - 18} height={12} rx={6}
                    fill="url(#actuatorGradient)"/>
              {/* White shell */}
              <path d={`M 4,${-9} L ${forearmLength - 10},${-7} Q ${forearmLength - 4},0 ${forearmLength - 10},7 L 4,9 Q -2,0 4,${-9}`}
                    fill="url(#optimusShellGradient)" stroke="#9CA3AF" strokeWidth="0.5"/>
              {/* Highlight */}
              <path d={`M 8,-6 L ${forearmLength * 0.4},-6`} stroke="white" strokeWidth="1" opacity="0.3" strokeLinecap="round"/>
            </g>

            {/* Elbow joint */}
            <circle cx={elXErr} cy={elYErr} r={11} fill="#111827" stroke="#374151" strokeWidth="2"/>
            <circle cx={elXErr} cy={elYErr} r={8} fill="url(#jointGradient)"/>
            <circle cx={elXErr} cy={elYErr} r={5} fill="url(#goldJointGradient)" opacity="0.6"/>
            <circle cx={elXErr} cy={elYErr} r={3} fill="#4B5563"/>

            {/* Hand with Egg - Optimus style */}
            <g transform={`translate(${wrXErr}, ${wrYErr}) rotate(${(wrRadErr * 180)/Math.PI})`}>
              {/* Wrist mount */}
              <rect x={-2} y={-7} width={8} height={14} rx={3} fill="#111827"/>

              {/* Palm - black grip surface */}
              <rect x={4} y={-9} width={20} height={18} rx={4} fill="#111827" />

              {/* Egg being held */}
              <ellipse cx={32} cy={0} rx={8} ry={10} fill="url(#eggGradient)" />
              <ellipse cx={29} cy={-4} rx={2.5} ry={3.5} fill="white" opacity="0.4"/>

              {/* Fingers wrapping around egg - with gold joints */}
              {[
                { offY: -7, angle: -18, len: 16 },
                { offY: -2, angle: 5, len: 18 },
                { offY: 3, angle: 15, len: 17 },
                { offY: 8, angle: 22, len: 15 },
              ].map((f, i) => (
                <g key={i} transform={`translate(22, ${f.offY}) rotate(${f.angle})`}>
                  {/* Finger segment 1 */}
                  <rect x={0} y={-2.5} width={f.len * 0.5} height={5} rx={2.5} fill="#111827"/>
                  <rect x={0.5} y={-2} width={f.len * 0.5 - 1} height={4} rx={2} fill="url(#fingerShellGradient)"/>
                  {/* Gold joint */}
                  <circle cx={f.len * 0.5} cy={0} r={2.5} fill="url(#goldJointGradient)"/>
                  {/* Finger segment 2 */}
                  <rect x={f.len * 0.5} y={-2} width={f.len * 0.5} height={4} rx={2} fill="#111827"/>
                  <rect x={f.len * 0.5 + 0.5} y={-1.5} width={f.len * 0.5 - 1} height={3} rx={1.5} fill="url(#fingerShellGradient)"/>
                  {/* Black fingertip */}
                  <circle cx={f.len} cy={0} r={2.5} fill="#111827"/>
                </g>
              ))}
            </g>

            {/* Wrist joint */}
            <circle cx={wrXErr} cy={wrYErr} r={8} fill="#111827" stroke="#374151" strokeWidth="1.5"/>
            <circle cx={wrXErr} cy={wrYErr} r={5.5} fill="url(#goldJointGradient)" opacity="0.5"/>
            <circle cx={wrXErr} cy={wrYErr} r={3} fill="#4B5563"/>
          </>
        )}

        {/* Error indicator line */}
        {showError && tipError > 0.5 && (
          <g filter="url(#errorGlow)">
            <line x1={haX} y1={haY} x2={haXErr + 30 * Math.cos(wrRadErr)} y2={haYErr + 30 * Math.sin(wrRadErr)}
                  stroke="#EF4444" strokeWidth="1.5" strokeDasharray="3,2" opacity="0.8"/>
            <circle cx={haXErr + 30 * Math.cos(wrRadErr)} cy={haYErr + 30 * Math.sin(wrRadErr)} r={3} fill="#EF4444" opacity="0.8"/>
          </g>
        )}

        {/* Error display */}
        <rect x="190" y="205" width="78" height="24" rx="4" fill="#0F172A" opacity="0.9"/>
        <text x="229" y="221" fill="#EF4444" fontSize="11" fontFamily="monospace" textAnchor="middle">
          Δ = {tipError.toFixed(2)}px
        </text>

        <text x="140" y="235" fill="#4B5563" fontSize="9" textAnchor="middle">{label}</text>
      </svg>

      {/* Stats */}
      <div className="mt-3 bg-slate-900/50 rounded-lg p-2 w-full">
        <div className="grid grid-cols-3 gap-2 text-xs">
          {[
            { name: '肩', angle: shoulderAngle, error: shoulderError },
            { name: '肘', angle: elbowAngle, error: elbowError },
            { name: '手首', angle: wristAngle, error: wristError },
          ].map((joint, i) => (
            <div key={i} className="text-center">
              <div className="text-gray-500">{joint.name}</div>
              <div className="text-cyan-400 font-mono">{joint.angle.toFixed(1)}°</div>
              {showError && (
                <div className="text-red-400 font-mono text-[10px]">±{joint.error.toFixed(2)}°</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// -----------------------------
// Optimus Finger Component - Matches Tesla Optimus hand design
// -----------------------------

const OptimusFinger = ({ x1, y1, angle, length, width, jointBends = [0, 0.05], isThumb = false }) => {
  // Calculate 3 segments: proximal, middle, distal phalanx
  const seg1 = length * 0.38;  // Proximal
  const seg2 = length * 0.32;  // Middle
  const seg3 = length * 0.30;  // Distal

  const rad1 = angle;
  const rad2 = rad1 + jointBends[0];
  const rad3 = rad2 + jointBends[1];

  // Joint positions
  const j1x = x1 + seg1 * Math.cos(rad1);
  const j1y = y1 + seg1 * Math.sin(rad1);
  const j2x = j1x + seg2 * Math.cos(rad2);
  const j2y = j1y + seg2 * Math.sin(rad2);
  const tipX = j2x + seg3 * Math.cos(rad3);
  const tipY = j2y + seg3 * Math.sin(rad3);

  const w1 = width;
  const w2 = width * 0.85;
  const w3 = width * 0.7;

  return (
    <g>
      {/* Proximal phalanx - white shell */}
      <line x1={x1} y1={y1} x2={j1x} y2={j1y}
            stroke="#111827" strokeWidth={w1 + 2} strokeLinecap="round"/>
      <line x1={x1} y1={y1} x2={j1x} y2={j1y}
            stroke="url(#fingerShellGradient)" strokeWidth={w1} strokeLinecap="round"/>

      {/* Gold joint band at MCP */}
      <circle cx={x1} cy={y1} r={w1 * 0.5} fill="url(#goldJointGradient)" />

      {/* Middle phalanx - white shell */}
      <line x1={j1x} y1={j1y} x2={j2x} y2={j2y}
            stroke="#111827" strokeWidth={w2 + 2} strokeLinecap="round"/>
      <line x1={j1x} y1={j1y} x2={j2x} y2={j2y}
            stroke="url(#fingerShellGradient)" strokeWidth={w2} strokeLinecap="round"/>

      {/* Gold joint band at PIP */}
      <circle cx={j1x} cy={j1y} r={w2 * 0.45} fill="url(#goldJointGradient)" />

      {/* Distal phalanx - white shell */}
      <line x1={j2x} y1={j2y} x2={tipX} y2={tipY}
            stroke="#111827" strokeWidth={w3 + 2} strokeLinecap="round"/>
      <line x1={j2x} y1={j2y} x2={tipX} y2={tipY}
            stroke="url(#fingerShellGradient)" strokeWidth={w3} strokeLinecap="round"/>

      {/* Gold joint band at DIP */}
      <circle cx={j2x} cy={j2y} r={w3 * 0.45} fill="url(#goldJointGradient)" />

      {/* Black tactile fingertip pad */}
      <circle cx={tipX} cy={tipY} r={w3 * 0.6} fill="#111827" />
      <circle cx={tipX} cy={tipY} r={w3 * 0.35} fill="#374151" />
    </g>
  );
};

// -----------------------------
// Hand Detail Visualization
// -----------------------------

function HandVisualization({ fingerAngles, fingerErrors, showError }) {
  const palmX = 90, palmY = 120;
  const fingerLength = 48;
  const fingerConfigs = [
    { name: '親指', offX: -32, offY: 18, base: -30, width: 11, isThumb: true },
    { name: '人差', offX: -14, offY: -25, base: -82, width: 9 },
    { name: '中指', offX: 2, offY: -32, base: -90, width: 9 },
    { name: '薬指', offX: 18, offY: -25, base: -98, width: 9 },
    { name: '小指', offX: 32, offY: -12, base: -110, width: 8 },
  ];

  return (
    <div className="flex flex-col items-center">
      <svg width="180" height="210" className="bg-slate-950 rounded-xl shadow-2xl">
        <SvgDefs />
        <rect width="180" height="210" fill="url(#gridPattern)" />

        {/* Palm - Black grip surface like Tesla Optimus */}
        <path
          d="M 55,108 Q 50,85 62,70 L 118,70 Q 130,85 125,108 L 120,148 Q 90,162 60,148 Z"
          fill="#111827" stroke="#374151" strokeWidth="1"
        />
        {/* Palm texture lines */}
        <path d="M 65,85 Q 90,78 115,85" stroke="#374151" strokeWidth="0.5" fill="none"/>
        <path d="M 62,100 Q 90,92 118,100" stroke="#374151" strokeWidth="0.5" fill="none"/>
        <path d="M 60,115 Q 90,108 120,115" stroke="#374151" strokeWidth="0.5" fill="none"/>

        {/* White shell panel on back of palm */}
        <path
          d="M 58,110 Q 55,90 65,78 L 115,78 Q 125,90 122,110 L 117,135 Q 90,145 63,135 Z"
          fill="url(#optimusShellGradient)" opacity="0.15"
        />

        {/* Thumb base mount - black mechanical */}
        <ellipse cx="55" cy="125" rx="14" ry="18" fill="#1F2937" transform="rotate(-20 55 125)" />
        <ellipse cx="55" cy="125" rx="10" ry="14" fill="url(#goldJointGradient)" opacity="0.6" transform="rotate(-20 55 125)" />

        {/* Fingers */}
        {fingerConfigs.map((cfg, idx) => {
          const bx = palmX + cfg.offX;
          const by = palmY + cfg.offY;
          const angle = fingerAngles[idx];
          const error = fingerErrors[idx];

          // Ideal position (hologram)
          const rad = ((cfg.base + angle) * Math.PI) / 180;
          const tipX = bx + fingerLength * Math.cos(rad);
          const tipY = by + fingerLength * Math.sin(rad);

          // Actual with error
          const radErr = ((cfg.base + angle + error) * Math.PI) / 180;
          const bendAmount = 0.05 + (error * 0.005);

          return (
            <g key={idx}>
              {/* Hologram ideal */}
              <line x1={bx} y1={by} x2={tipX} y2={tipY}
                    stroke="#06B6D4" strokeWidth="2" opacity="0.25" strokeDasharray="4 2"
                    filter="url(#hologramGlow)"/>

              {/* Actual Optimus finger with gold joints */}
              {showError && (
                <OptimusFinger
                  x1={bx} y1={by}
                  angle={radErr}
                  length={cfg.isThumb ? fingerLength * 0.8 : fingerLength}
                  width={cfg.width}
                  jointBends={[bendAmount, bendAmount * 0.8]}
                  isThumb={cfg.isThumb}
                />
              )}
            </g>
          );
        })}

        {/* Wrist connection */}
        <rect x="70" y="155" width="40" height="12" rx="3" fill="#1F2937" />
        <rect x="72" y="157" width="36" height="8" rx="2" fill="url(#actuatorGradient)" />

        <text x="90" y="200" fill="#4B5563" fontSize="9" textAnchor="middle">Dexterous Hand</text>
      </svg>

      {/* Finger angles */}
      <div className="mt-3 bg-slate-900/50 rounded-lg p-2 w-full">
        <div className="grid grid-cols-5 gap-1 text-[10px]">
          {fingerConfigs.map((cfg, i) => (
            <div key={i} className="text-center">
              <div className="text-gray-500">{cfg.name}</div>
              <div className="text-cyan-400 font-mono">{fingerAngles[i].toFixed(0)}°</div>
              {showError && (
                <div className="text-red-400 font-mono">±{fingerErrors[i].toFixed(1)}°</div>
              )}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// -----------------------------
// Walking/Leg Visualization - Tesla Optimus Style
// -----------------------------

function WalkingVisualization({ legAngle, hipError, kneeError, showError, step }) {
  const hipX = 90, hipY = 50;
  const thighLength = 55, shinLength = 52;

  const hipA = legAngle;
  const kneeA = Math.abs(legAngle) * 0.8 + 12;

  // Ideal
  const hRad = (hipA * Math.PI) / 180;
  const kX = hipX + thighLength * Math.sin(hRad);
  const kY = hipY + thighLength * Math.cos(hRad);
  const kRad = ((hipA - kneeA) * Math.PI) / 180;
  const aX = kX + shinLength * Math.sin(kRad);
  const aY = kY + shinLength * Math.cos(kRad);

  // Actual
  const hRadE = ((hipA + hipError) * Math.PI) / 180;
  const kXE = hipX + thighLength * Math.sin(hRadE);
  const kYE = hipY + thighLength * Math.cos(hRadE);
  const kRadE = ((hipA + hipError - kneeA - kneeError) * Math.PI) / 180;
  const aXE = kXE + shinLength * Math.sin(kRadE);
  const aYE = kYE + shinLength * Math.cos(kRadE);

  const footErr = Math.sqrt((aX - aXE) ** 2 + (aY - aYE) ** 2);

  // Angles for limb transforms
  const thighAngleDeg = 90 - (hipA + hipError);
  const shinAngleDeg = 90 - (hipA + hipError - kneeA - kneeError);

  return (
    <div className="flex flex-col items-center">
      <svg width="180" height="210" className="bg-slate-950 rounded-xl shadow-2xl">
        <SvgDefs />
        <rect width="180" height="210" fill="url(#gridPattern)" />

        {/* Pelvis - Optimus style */}
        <path d="M 52,18 L 128,18 L 118,52 L 62,52 Z" fill="#111827" stroke="#374151" strokeWidth="1"/>
        <path d="M 58,23 L 122,23 L 114,48 L 66,48 Z" fill="url(#optimusShellGradient)" stroke="#9CA3AF" strokeWidth="0.5"/>
        {/* Pelvis detail */}
        <path d="M 70,30 L 110,30" stroke="#D1D5DB" strokeWidth="0.5" opacity="0.4"/>

        {/* Hologram ideal */}
        <HologramLimb x1={hipX} y1={hipY} x2={kX} y2={kY} width={18} />
        <HologramLimb x1={kX} y1={kY} x2={aX} y2={aY} width={14} />

        {/* Actual Optimus Leg */}
        {showError && (
          <>
            {/* Thigh - with actuator */}
            <g transform={`translate(${hipX}, ${hipY}) rotate(${thighAngleDeg})`}>
              {/* Black actuator cylinder */}
              <rect x={6} y={-8} width={thighLength - 15} height={16} rx={8}
                    fill="url(#actuatorGradient)"/>
              {/* White shell panels */}
              <path d={`M 4,${-11} L ${thighLength - 8},${-9} Q ${thighLength - 2},0 ${thighLength - 8},9 L 4,11 Q -2,0 4,${-11}`}
                    fill="url(#optimusShellGradient)" stroke="#9CA3AF" strokeWidth="0.5"/>
              {/* Highlight */}
              <path d={`M 8,-8 L ${thighLength * 0.4},-8`} stroke="white" strokeWidth="1" opacity="0.3" strokeLinecap="round"/>
            </g>

            {/* Hip joint - with gold ring */}
            <circle cx={hipX} cy={hipY} r={12} fill="#111827" stroke="#374151" strokeWidth="2"/>
            <circle cx={hipX} cy={hipY} r={9} fill="url(#jointGradient)"/>
            <circle cx={hipX} cy={hipY} r={6} fill="url(#goldJointGradient)" opacity="0.6"/>
            <circle cx={hipX} cy={hipY} r={3} fill="#4B5563"/>

            {/* Shin - with actuator */}
            <g transform={`translate(${kXE}, ${kYE}) rotate(${shinAngleDeg})`}>
              {/* Black actuator */}
              <rect x={5} y={-6} width={shinLength - 14} height={12} rx={6}
                    fill="url(#actuatorGradient)"/>
              {/* White shell */}
              <path d={`M 3,${-9} L ${shinLength - 8},${-7} Q ${shinLength - 2},0 ${shinLength - 8},7 L 3,9 Q -2,0 3,${-9}`}
                    fill="url(#optimusShellGradient)" stroke="#9CA3AF" strokeWidth="0.5"/>
              {/* Highlight */}
              <path d={`M 7,-6 L ${shinLength * 0.35},-6`} stroke="white" strokeWidth="1" opacity="0.3" strokeLinecap="round"/>
            </g>

            {/* Knee joint */}
            <circle cx={kXE} cy={kYE} r={10} fill="#111827" stroke="#374151" strokeWidth="2"/>
            <circle cx={kXE} cy={kYE} r={7} fill="url(#jointGradient)"/>
            <circle cx={kXE} cy={kYE} r={4.5} fill="url(#goldJointGradient)" opacity="0.5"/>
            <circle cx={kXE} cy={kYE} r={2.5} fill="#4B5563"/>

            {/* Foot - Optimus style */}
            <g transform={`translate(${aXE}, ${aYE})`}>
              {/* Ankle joint */}
              <circle cx={0} cy={0} r={6} fill="#111827" stroke="#374151" strokeWidth="1"/>
              <circle cx={0} cy={0} r={3.5} fill="url(#goldJointGradient)" opacity="0.4"/>

              {/* Foot base - black with white top */}
              <path d="M -8,2 L 18,2 L 22,14 L -10,14 Z" fill="#111827" stroke="#374151" strokeWidth="0.5"/>
              <path d="M -6,3 L 14,3 L 16,10 L -6,10 Z" fill="url(#optimusShellGradient)" opacity="0.9"/>
              {/* Toe detail */}
              <rect x="16" y="6" width="8" height="8" rx="2" fill="#111827"/>
            </g>
          </>
        )}

        {/* Ground */}
        <line x1="10" y1="175" x2="170" y2="175" stroke="#374151" strokeWidth="2" />
        <rect x="10" y="177" width="160" height="6" fill="#1F2937" rx="1"/>

        {/* Step counter */}
        <rect x="120" y="185" width="50" height="18" rx="3" fill="#0F172A" opacity="0.9"/>
        <text x="145" y="198" fill="#6B7280" fontSize="9" fontFamily="monospace" textAnchor="middle">
          Step {step}
        </text>

        <text x="70" y="198" fill="#EF4444" fontSize="9" fontFamily="monospace" textAnchor="middle">
          Δ={footErr.toFixed(2)}
        </text>
      </svg>

      {/* Stats */}
      <div className="mt-3 bg-slate-900/50 rounded-lg p-2 w-full">
        <div className="grid grid-cols-2 gap-4 text-xs">
          <div className="text-center">
            <div className="text-gray-500">股関節</div>
            <div className="text-cyan-400 font-mono">{hipA.toFixed(1)}°</div>
            {showError && <div className="text-red-400 font-mono text-[10px]">±{hipError.toFixed(2)}°</div>}
          </div>
          <div className="text-center">
            <div className="text-gray-500">膝関節</div>
            <div className="text-cyan-400 font-mono">{kneeA.toFixed(1)}°</div>
            {showError && <div className="text-red-400 font-mono text-[10px]">±{kneeError.toFixed(2)}°</div>}
          </div>
        </div>
      </div>
    </div>
  );
}

// -----------------------------
// Main Component
// -----------------------------

export default function RoPEOptimusSimulator() {
  const [seqLen, setSeqLen] = useState(4096);
  const [dim, setDim] = useState(64);
  const [base, setBase] = useState(10000);
  const [seed, setSeed] = useState(42);
  const [bits, setBits] = useState(8);
  const [quantMode, setQuantMode] = useState('per_dim');
  const [showNaive, setShowNaive] = useState(true);
  const [usePackDemo, setUsePackDemo] = useState(true);

  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(null);

  const [animationTime, setAnimationTime] = useState(0);
  const [isAnimating, setIsAnimating] = useState(true);
  const [eggView, setEggView] = useState('svg'); // 'svg' | 'photo' | 'pixi'
  const [noiseMode, setNoiseMode] = useState('mixed'); // 'mixed' | 'naive'
  const animationRef = useRef(null);
  const runIdRef = useRef(0);

  useEffect(() => {
    if (isAnimating) {
      const animate = () => {
        setAnimationTime(t => t + 0.025);
        animationRef.current = requestAnimationFrame(animate);
      };
      animationRef.current = requestAnimationFrame(animate);
    }
    return () => { if (animationRef.current) cancelAnimationFrame(animationRef.current); };
  }, [isAnimating]);

  const robotAngles = useMemo(() => {
    const t = animationTime;
    const errorScale = results ? results.statsLog.meanRmse * 12 : 0.6;

    return {
      shoulderAngle: 50 + 25 * Math.sin(t * 0.8),
      elbowAngle: 35 + 35 * Math.sin(t * 1.2),
      wristAngle: 15 * Math.sin(t * 1.8),
      shoulderError: errorScale * (0.4 + 0.6 * Math.sin(t * 4)),
      elbowError: errorScale * (0.5 + 0.5 * Math.cos(t * 5)),
      wristError: errorScale * (0.3 + 0.7 * Math.sin(t * 7)),
    };
  }, [animationTime, results]);

  const fingerData = useMemo(() => {
    const t = animationTime;
    // Gentle gripping motion
    const baseAngles = [
      25 + 12 * Math.sin(t * 0.6),
      35 + 18 * Math.sin(t * 0.9),
      40 + 20 * Math.sin(t * 0.85),
      35 + 18 * Math.sin(t * 0.75),
      28 + 12 * Math.sin(t * 1.0),
    ];
    const errorScale = results ? results.statsLog.meanRmse * 6 : 0.35;
    const errors = baseAngles.map((_, i) => errorScale * (0.25 + 0.75 * Math.sin(t * (2.5 + i * 0.5))));
    return { angles: baseAngles, errors };
  }, [animationTime, results]);

  const walkingData = useMemo(() => {
    const t = animationTime;
    const legAngle = 22 * Math.sin(t * 1.8);
    const step = Math.floor(t / Math.PI) + 1;
    const errorScale = results ? results.statsLog.meanRmse * 10 : 0.5;
    return {
      legAngle, step,
      hipError: errorScale * (0.35 + 0.65 * Math.sin(t * 5)),
      kneeError: errorScale * (0.4 + 0.6 * Math.cos(t * 6)),
    };
  }, [animationTime, results]);

  const runSimulation = async () => {
    const runId = ++runIdRef.current;
    setIsRunning(true);
    setProgress(0);

    const dimEven = dim % 2 === 0 ? dim : dim - 1;
    const halfEven = Math.floor(dimEven / 2);
    const rand = seededRandom(seed);
    const { invFreq, logInvFreq } = computeInvFreq(dimEven, base);
    const { scales: scalesLog, qmax: qmaxLog } = computeLogThetaScalesAnalytic(seqLen, logInvFreq, bits, quantMode);
    const { scales: scalesTheta, qmax: qmaxTheta } = computeThetaScalesAnalytic(seqLen, invFreq, bits, quantMode);
    
    const chartData = [];
    const n = seqLen;
    const n10 = Math.max(1, Math.floor(n / 10));
    let sumRmseLog = 0, maxRmseLog = 0, sumFirstLog = 0, sumLastLog = 0;
    let sumRmseNaive = 0, maxRmseNaive = 0, sumFirstNaive = 0, sumLastNaive = 0;
    let packMismatch = 0;
    const { edges } = makeLogBins(-12, 0, 24);
    const histCounts = new Array(edges.length - 1).fill(0);
    const eps = 1e-12;
    const chunk = 128;

    for (let pos0 = 0; pos0 < seqLen; pos0 += chunk) {
      if (runIdRef.current !== runId) return;
      const pos1 = Math.min(seqLen, pos0 + chunk);
      
      for (let pos = pos0; pos < pos1; pos++) {
        const logPos = pos <= 0 ? 0 : Math.log(pos);
        let sumSqLog = 0;
        let sumSqNaive = 0;
        const qLogTmp = usePackDemo ? new Array(halfEven) : null;

        for (let i = 0; i < halfEven; i++) {
          const xEven = rand();
          const xOdd = rand();
          const thetaRef = pos * invFreq[i];
          const cosRef = Math.cos(thetaRef);
          const sinRef = Math.sin(thetaRef);
          const yRefEven = xEven * cosRef - xOdd * sinRef;
          const yRefOdd = xEven * sinRef + xOdd * cosRef;

          let thetaHatLog = 0;
          let qLog = 0;
          if (pos > 0) {
            const logTheta = logPos + logInvFreq[i];
            qLog = quantizeSigned(logTheta, scalesLog[i], qmaxLog);
            thetaHatLog = Math.exp(qLog * scalesLog[i]);
          }
          if (usePackDemo) qLogTmp[i] = qLog;

          const cosHatLog = Math.cos(thetaHatLog);
          const sinHatLog = Math.sin(thetaHatLog);
          const yHatEven = xEven * cosHatLog - xOdd * sinHatLog;
          const yHatOdd = xEven * sinHatLog + xOdd * cosHatLog;
          
          const dEven = yHatEven - yRefEven;
          const dOdd = yHatOdd - yRefOdd;
          sumSqLog += dEven * dEven + dOdd * dOdd;

          const ae0 = Math.abs(dEven);
          if (ae0 > 0) histCounts[binIndexForPositive(ae0, edges)]++;
          else histCounts[0]++;

          if (showNaive) {
            const qTheta = quantizeSigned(thetaRef, scalesTheta[i], qmaxTheta);
            const thetaHat = qTheta * scalesTheta[i];
            const cosHat = Math.cos(thetaHat);
            const sinHat = Math.sin(thetaHat);
            const ynE = xEven * cosHat - xOdd * sinHat;
            const ynO = xEven * sinHat + xOdd * cosHat;
            sumSqNaive += (ynE - yRefEven) ** 2 + (ynO - yRefOdd) ** 2;
          }
        }
        
        const rmseLog = Math.sqrt(sumSqLog / dimEven);
        sumRmseLog += rmseLog;
        maxRmseLog = Math.max(maxRmseLog, rmseLog);
        if (pos < n10) sumFirstLog += rmseLog;
        if (pos >= n - n10) sumLastLog += rmseLog;

        if (showNaive) {
          const rmseNaive = Math.sqrt(sumSqNaive / dimEven);
          sumRmseNaive += rmseNaive;
          maxRmseNaive = Math.max(maxRmseNaive, rmseNaive);
          if (pos < n10) sumFirstNaive += rmseNaive;
          if (pos >= n - n10) sumLastNaive += rmseNaive;
        }

        if (pos % Math.max(1, Math.floor(seqLen / 200)) === 0) {
          const pt = { pos, logExp: rmseLog };
          if (showNaive) pt.naive = Math.sqrt(sumSqNaive / dimEven);
          chartData.push(pt);
        }
      }
      
      setProgress(Math.round((pos1 / seqLen) * 100));
      await new Promise(r => setTimeout(r, 0));
    }

    const statsLog = {
      meanRmse: sumRmseLog / n,
      maxRmse: maxRmseLog,
      first10: sumFirstLog / n10,
      last10: sumLastLog / n10,
      drift: (sumLastLog / n10) / (sumFirstLog / n10 + eps),
    };
    const statsNaive = showNaive ? {
      meanRmse: sumRmseNaive / n,
      maxRmse: maxRmseNaive,
      first10: sumFirstNaive / n10,
      last10: sumLastNaive / n10,
      drift: (sumLastNaive / n10) / (sumFirstNaive / n10 + eps),
    } : null;

    setResults({
      statsLog,
      statsNaive,
      chartData,
      histData: buildHistData(histCounts, edges),
      packMismatch
    });
    setIsRunning(false);
    setProgress(100);
  };

  useEffect(() => { runSimulation(); }, []);

  return (
    <div className="min-h-screen bg-black text-gray-100 p-4 font-sans">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="relative">
              <div className="w-3 h-3 bg-cyan-400 rounded-full animate-pulse"></div>
              <div className="absolute inset-0 w-3 h-3 bg-cyan-400 rounded-full animate-ping opacity-50"></div>
            </div>
            <h1 className="text-2xl font-bold tracking-tight">
              RoPE <span className="text-cyan-400">×</span> Optimus Precision Simulator
            </h1>
          </div>
          <p className="text-gray-500 text-sm ml-6">
            Tesla Patent US20260017019A1 — Mixed-Precision Quantization for Robot Actuator Control
          </p>
        </div>

        {/* Robot Visualizations - Row 1 */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-4">
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-gray-300 font-medium text-sm">Arm Manipulation</h3>
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            </div>
            <RobotArmVisualization {...robotAngles} showError={true} label="Precision Actuator Control" />
          </div>

          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-gray-300 font-medium text-sm">Fine Motor Control</h3>
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            </div>
            <HandVisualization fingerAngles={fingerData.angles} fingerErrors={fingerData.errors} showError={true} />
          </div>

          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <div className="flex justify-between items-center mb-3">
              <h3 className="text-gray-300 font-medium text-sm">Locomotion Balance</h3>
              <div className="w-2 h-2 bg-green-500 rounded-full animate-pulse"></div>
            </div>
            <WalkingVisualization
              legAngle={walkingData.legAngle}
              hipError={walkingData.hipError}
              kneeError={walkingData.kneeError}
              step={walkingData.step}
              showError={true}
            />
          </div>
        </div>

        {/* Egg Grip Challenge - Interactive Demo */}
        <div className="mb-6">
          {/* View and Noise Mode Toggle Buttons */}
          <div className="flex flex-wrap gap-4 mb-3 items-center">
            {/* View Toggle */}
            <div className="flex gap-2">
              <button
                onClick={() => setEggView('svg')}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  eggView === 'svg'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                }`}
              >
                SVG Mode
              </button>
              <button
                onClick={() => setEggView('photo')}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  eggView === 'photo'
                    ? 'bg-blue-600 text-white'
                    : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                }`}
              >
                Photo Mode
              </button>
              <button
                onClick={() => setEggView('pixi')}
                className={`px-3 py-1 rounded text-sm font-medium transition-colors ${
                  eggView === 'pixi'
                    ? 'bg-purple-600 text-white'
                    : 'bg-slate-700 text-gray-300 hover:bg-slate-600'
                }`}
              >
                Pixi Mode
              </button>
            </div>

            {/* Noise Mode Toggle */}
            <div className="flex items-center gap-2">
              <span className="text-sm text-gray-400">Noise source:</span>
              <select
                value={noiseMode}
                onChange={e => setNoiseMode(e.target.value)}
                className="px-2 py-1 bg-slate-700 border border-slate-600 rounded text-sm text-gray-200 focus:outline-none focus:ring-1 focus:ring-blue-500"
              >
                <option value="mixed">Log/Exp (Mixed)</option>
                <option value="naive">Naive (Linear)</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            {/* Conditional rendering based on view mode */}
            {eggView === 'pixi' ? (
              <PixiEggGripGame
                noiseLevel={results ? results.statsLog.meanRmse : (9 - bits) * 0.02}
                naiveNoiseLevel={results ? results.statsNaive.meanRmse : (9 - bits) * 0.03}
                noiseMode={noiseMode}
                bits={bits}
                isAnimating={isAnimating}
              />
            ) : eggView === 'photo' ? (
              <PhotoEggGripGame
                noiseLevel={results ? results.statsLog.meanRmse : (9 - bits) * 0.02}
                naiveNoiseLevel={results ? results.statsNaive.meanRmse : (9 - bits) * 0.03}
                noiseMode={noiseMode}
                bits={bits}
                isAnimating={isAnimating}
              />
            ) : (
              <EggGripGame
                noiseLevel={results ? results.statsLog.meanRmse : (9 - bits) * 0.02}
                naiveNoiseLevel={results ? results.statsNaive.meanRmse : (9 - bits) * 0.03}
                noiseMode={noiseMode}
                bits={bits}
                isAnimating={isAnimating}
              />
            )}

          {/* Explanation Panel */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <h3 className="text-gray-300 font-medium text-sm mb-3 flex items-center gap-2">
              <span className="text-lg">🎯</span> How Quantization Affects Control
            </h3>
            <div className="space-y-3 text-xs text-gray-400">
              <div className="bg-slate-800/50 rounded p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 bg-red-500 rounded-full"></span>
                  <span className="font-semibold text-red-400">Low Bits (2-4 bit)</span>
                </div>
                <p>Large quantization noise causes unpredictable pressure spikes. The robot "trembles" and can easily crush delicate objects.</p>
              </div>
              <div className="bg-slate-800/50 rounded p-3">
                <div className="flex items-center gap-2 mb-2">
                  <span className="w-2 h-2 bg-green-500 rounded-full"></span>
                  <span className="font-semibold text-green-400">High Bits (7-8 bit)</span>
                </div>
                <p>Minimal noise allows precise control. The robot maintains steady pressure, enabling delicate manipulation tasks.</p>
              </div>
              <div className="bg-cyan-900/30 border border-cyan-800/50 rounded p-3">
                <p className="text-cyan-300">
                  <strong>RoPE Connection:</strong> The log-space quantization technique reduces error accumulation,
                  allowing robots to maintain precision even with reduced bit-widths — critical for efficient edge computing.
                </p>
              </div>
              <div className="flex gap-4 mt-3">
                <div className="flex-1 text-center">
                  <div className="text-2xl font-mono text-cyan-400">{bits}-bit</div>
                  <div className="text-[10px] text-gray-500">Current Setting</div>
                </div>
                <div className="flex-1 text-center">
                  <div className="text-2xl font-mono text-orange-400">
                    {results ? (results.statsLog.meanRmse * 100).toFixed(1) : ((9 - bits) * 2).toFixed(0)}%
                  </div>
                  <div className="text-[10px] text-gray-500">Noise Level</div>
                </div>
              </div>
            </div>
          </div>
          </div>
        </div>

        {/* Legend */}
        <div className="bg-slate-900/30 border border-slate-800 rounded-lg p-3 mb-6">
          <div className="flex flex-wrap gap-6 justify-center text-xs">
            <div className="flex items-center gap-2">
              <div className="w-4 h-1 bg-cyan-500 rounded opacity-50" style={{boxShadow: '0 0 6px #06B6D4'}}></div>
              <span className="text-gray-400">理想位置 (float32)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-3 bg-gradient-to-b from-white to-gray-300 rounded-sm"></div>
              <span className="text-gray-400">実際の位置 (量子化後)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-0.5 bg-red-500 rounded" style={{backgroundImage: 'repeating-linear-gradient(90deg, #EF4444, #EF4444 3px, transparent 3px, transparent 6px)'}}></div>
              <span className="text-gray-400">誤差 (Δ)</span>
            </div>
          </div>
        </div>

        {/* Controls & Results */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Settings */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <h2 className="text-sm font-bold text-white mb-4 flex items-center gap-2">
              <span>⚙️</span> Parameters
            </h2>
            <div className="space-y-3">
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">Sequence Length</label>
                <input type="number" value={seqLen} 
                  onChange={e => setSeqLen(clamp(parseInt(e.target.value) || 4096, 64, 65536))} 
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-white mt-1"/>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">Dimension</label>
                <input type="number" value={dim} step={2}
                  onChange={e => setDim(clamp(parseInt(e.target.value) || 64, 8, 256))} 
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm text-white mt-1"/>
              </div>
              <div>
                <label className="text-[10px] text-gray-500 uppercase tracking-wider">Quantization Bits</label>
                <div className="flex items-center gap-2 mt-1">
                  <input type="range" min="2" max="8" value={bits} 
                    onChange={e => setBits(parseInt(e.target.value))} 
                    className="flex-1 accent-cyan-500"/>
                  <span className="text-cyan-400 font-mono font-bold text-sm w-12">{bits}-bit</span>
                </div>
              </div>
              <button onClick={runSimulation} disabled={isRunning} 
                className={`w-full py-2.5 rounded-lg font-bold text-sm tracking-wide transition-all ${
                  isRunning ? 'bg-slate-700 text-slate-500' : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                }`}>
                {isRunning ? `Processing ${progress}%` : 'Run Simulation'}
              </button>
              <button onClick={() => setIsAnimating(!isAnimating)} 
                className="w-full py-2 border border-slate-700 rounded-lg text-xs text-gray-400 hover:bg-slate-800">
                {isAnimating ? '⏸ Pause Animation' : '▶ Resume Animation'}
              </button>
            </div>
          </div>

          {/* Charts */}
          <div className="lg:col-span-3 space-y-4">
            {results && (
              <>
                {/* Stats Cards */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gradient-to-br from-slate-900 to-cyan-950/30 border border-cyan-900/30 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 bg-cyan-400 rounded-full"></div>
                      <h4 className="text-cyan-400 font-bold text-sm">Mixed-Precision (Log/Exp)</h4>
                    </div>
                    <div className="text-3xl font-mono text-white mb-1">{results.statsLog.meanRmse.toExponential(2)}</div>
                    <div className="text-xs text-gray-500">Mean RMSE | Drift: {results.statsLog.drift.toFixed(2)}x</div>
                  </div>
                  <div className="bg-gradient-to-br from-slate-900 to-orange-950/30 border border-orange-900/30 rounded-xl p-4">
                    <div className="flex items-center gap-2 mb-2">
                      <div className="w-2 h-2 bg-orange-400 rounded-full"></div>
                      <h4 className="text-orange-400 font-bold text-sm">Naive (Linear Quant)</h4>
                    </div>
                    <div className="text-3xl font-mono text-white mb-1">
                      {results.statsNaive ? results.statsNaive.meanRmse.toExponential(2) : '—'}
                    </div>
                    <div className="text-xs text-gray-500">
                      Mean RMSE | Drift: {results.statsNaive ? results.statsNaive.drift.toFixed(2) : '—'}x
                    </div>
                  </div>
                </div>

                {/* Chart */}
                <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
                  <h3 className="text-gray-400 text-sm font-medium mb-3">Error Accumulation over Sequence Position</h3>
                  <ResponsiveContainer width="100%" height={220}>
                    <LineChart data={results.chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
                      <XAxis dataKey="pos" stroke="#4B5563" tickFormatter={v => v >= 1000 ? `${v/1000}k` : v} fontSize={10}/>
                      <YAxis stroke="#4B5563" tickFormatter={v => v.toExponential(0)} fontSize={10}/>
                      <Tooltip 
                        contentStyle={{backgroundColor: '#0F172A', border: '1px solid #1E293B', borderRadius: '8px'}} 
                        formatter={(v) => [Number(v).toExponential(4), '']}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="logExp" name="Mixed-Precision" stroke="#22D3EE" strokeWidth={2} dot={false} />
                      {showNaive && <Line type="monotone" dataKey="naive" name="Naive" stroke="#F97316" strokeWidth={2} dot={false} />}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer explanation */}
        <div className="mt-6 bg-slate-900/30 border border-slate-800 rounded-lg p-4">
          <h4 className="text-cyan-400 font-semibold text-sm mb-2">🤖 RoPE × ロボット制御の対応</h4>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 text-xs text-gray-400">
            <div>
              <span className="text-cyan-300">θ (回転角度)</span> → 関節の曲げ角度。8-bit量子化では255段階しか表現できない
            </div>
            <div>
              <span className="text-cyan-300">誤差の蓄積</span> → 肩→肘→手首と連鎖するほど、指先の位置ズレが増大
            </div>
            <div>
              <span className="text-cyan-300">log(θ)量子化</span> → ダイナミックレンジを圧縮し、同じビット数で高精度を実現
            </div>
            <div>
              <span className="text-cyan-300">卵を持つ</span> → 繊細な力加減には高精度な角度制御が必須
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
