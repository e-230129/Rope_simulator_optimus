import React, { useEffect, useRef, useState, useMemo } from 'react';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

// -----------------------------
// Utils
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

// -----------------------------
// RoPE Logic
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

function qmaxForBits(bits) { 
  return Math.pow(2, bits - 1) - 1; 
}

function quantizeSigned(value, scale, qmax) {
  if (!Number.isFinite(value) || !Number.isFinite(scale) || scale <= 0) return 0;
  return clamp(Math.round(value / scale), -qmax, qmax);
}

function computeLogThetaScalesAnalytic(seqLen, logInvFreq, bits, mode) {
  const half = logInvFreq.length;
  const qmax = qmaxForBits(bits);
  const logMaxPos = Math.log(Math.max(1, seqLen - 1));

  if (mode === 'global') {
    let globalMaxAbs = 0;
    for (let i = 0; i < half; i++) {
      globalMaxAbs = Math.max(globalMaxAbs, Math.abs(logInvFreq[i]), Math.abs(logInvFreq[i] + logMaxPos));
    }
    const scale = globalMaxAbs < 1e-12 ? 1.0 : globalMaxAbs / qmax;
    return { scales: new Array(half).fill(scale), qmax };
  }

  const scales = logInvFreq.map(lif => {
    const maxAbs = Math.max(Math.abs(lif), Math.abs(lif + logMaxPos));
    return maxAbs < 1e-12 ? 1.0 : maxAbs / qmax;
  });
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

  const scales = invFreq.map(f => {
    const maxAbs = maxPos * f;
    return maxAbs < 1e-12 ? 1.0 : maxAbs / qmax;
  });
  return { scales, qmax };
}

// -----------------------------
// Robot Arm Component
// -----------------------------

function RobotArm({ shoulderAngle, elbowAngle, wristAngle, errors, showError }) {
  const shoulderX = 130, shoulderY = 90;
  const upperArmLen = 60, forearmLen = 50, handLen = 25;

  // Ideal positions
  const shRad = (shoulderAngle * Math.PI) / 180;
  const elX = shoulderX + upperArmLen * Math.cos(shRad);
  const elY = shoulderY + upperArmLen * Math.sin(shRad);
  const elRad = shRad + (elbowAngle * Math.PI) / 180;
  const wrX = elX + forearmLen * Math.cos(elRad);
  const wrY = elY + forearmLen * Math.sin(elRad);
  const wrRad = elRad + (wristAngle * Math.PI) / 180;
  const haX = wrX + handLen * Math.cos(wrRad);
  const haY = wrY + handLen * Math.sin(wrRad);

  // With error
  const shRadE = ((shoulderAngle + errors.shoulder) * Math.PI) / 180;
  const elXE = shoulderX + upperArmLen * Math.cos(shRadE);
  const elYE = shoulderY + upperArmLen * Math.sin(shRadE);
  const elRadE = shRadE + ((elbowAngle + errors.elbow) * Math.PI) / 180;
  const wrXE = elXE + forearmLen * Math.cos(elRadE);
  const wrYE = elYE + forearmLen * Math.sin(elRadE);
  const wrRadE = elRadE + ((wristAngle + errors.wrist) * Math.PI) / 180;
  const haXE = wrXE + handLen * Math.cos(wrRadE);
  const haYE = wrYE + handLen * Math.sin(wrRadE);

  const tipErr = Math.sqrt((haX - haXE) ** 2 + (haY - haYE) ** 2);

  return (
    <svg width="260" height="240" className="bg-slate-900 rounded-xl">
      {/* Grid */}
      <defs>
        <pattern id="grid" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1F2937" strokeWidth="0.5"/>
        </pattern>
        <linearGradient id="shell" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF"/>
          <stop offset="100%" stopColor="#D1D5DB"/>
        </linearGradient>
      </defs>
      <rect width="260" height="240" fill="url(#grid)"/>
      
      {/* Body */}
      <path d="M 100,80 Q 130,68 160,80 L 155,170 Q 130,180 105,170 Z" fill="#1F2937"/>
      <path d="M 105,85 Q 130,75 155,85 L 152,140 Q 130,148 108,140 Z" fill="url(#shell)"/>
      <text x="130" y="118" fill="#6B7280" fontSize="7" textAnchor="middle" fontWeight="bold">TESLA</text>

      {/* Ideal arm (cyan ghost) */}
      <g opacity="0.4">
        <line x1={shoulderX} y1={shoulderY} x2={elX} y2={elY} stroke="#06B6D4" strokeWidth="8" strokeLinecap="round"/>
        <line x1={elX} y1={elY} x2={wrX} y2={wrY} stroke="#06B6D4" strokeWidth="6" strokeLinecap="round"/>
        <line x1={wrX} y1={wrY} x2={haX} y2={haY} stroke="#06B6D4" strokeWidth="4" strokeLinecap="round"/>
        <circle cx={haX} cy={haY} r="4" fill="#06B6D4"/>
      </g>

      {/* Actual arm (white shell + black joints) */}
      {showError && (
        <g>
          {/* Upper arm */}
          <line x1={shoulderX} y1={shoulderY} x2={elXE} y2={elYE} stroke="#111827" strokeWidth="14" strokeLinecap="round"/>
          <line x1={shoulderX} y1={shoulderY} x2={elXE} y2={elYE} stroke="url(#shell)" strokeWidth="10" strokeLinecap="round"/>
          
          {/* Forearm */}
          <line x1={elXE} y1={elYE} x2={wrXE} y2={wrYE} stroke="#111827" strokeWidth="10" strokeLinecap="round"/>
          <line x1={elXE} y1={elYE} x2={wrXE} y2={wrYE} stroke="url(#shell)" strokeWidth="7" strokeLinecap="round"/>
          
          {/* Hand */}
          <line x1={wrXE} y1={wrYE} x2={haXE} y2={haYE} stroke="#111827" strokeWidth="6" strokeLinecap="round"/>
          <line x1={wrXE} y1={wrYE} x2={haXE} y2={haYE} stroke="url(#shell)" strokeWidth="4" strokeLinecap="round"/>
          
          {/* Egg */}
          <ellipse cx={haXE + 10 * Math.cos(wrRadE)} cy={haYE + 10 * Math.sin(wrRadE)} rx="6" ry="8" fill="#FCD34D"/>
          <ellipse cx={haXE + 8 * Math.cos(wrRadE)} cy={haYE + 8 * Math.sin(wrRadE) - 2} rx="2" ry="2.5" fill="white" opacity="0.5"/>
          
          {/* Joints */}
          <circle cx={shoulderX} cy={shoulderY} r="10" fill="#1F2937" stroke="#374151" strokeWidth="2"/>
          <circle cx={shoulderX} cy={shoulderY} r="4" fill="#4B5563"/>
          <circle cx={elXE} cy={elYE} r="8" fill="#1F2937" stroke="#374151" strokeWidth="2"/>
          <circle cx={elXE} cy={elYE} r="3" fill="#4B5563"/>
          <circle cx={wrXE} cy={wrYE} r="6" fill="#1F2937" stroke="#374151" strokeWidth="2"/>
        </g>
      )}

      {/* Error line */}
      {showError && tipErr > 0.5 && (
        <g>
          <line x1={haX} y1={haY} x2={haXE} y2={haYE} stroke="#EF4444" strokeWidth="1.5" strokeDasharray="3,2"/>
          <circle cx={haXE} cy={haYE} r="3" fill="#EF4444"/>
        </g>
      )}

      {/* Error display */}
      <rect x="175" y="205" width="70" height="20" rx="4" fill="#0F172A" opacity="0.9"/>
      <text x="210" y="219" fill="#EF4444" fontSize="10" fontFamily="monospace" textAnchor="middle">
        Δ={tipErr.toFixed(1)}
      </text>
      <text x="130" y="235" fill="#6B7280" fontSize="9" textAnchor="middle">Arm Control</text>
    </svg>
  );
}

// -----------------------------
// Hand Component
// -----------------------------

function RobotHand({ fingerAngles, fingerErrors, showError }) {
  const palmX = 80, palmY = 110;
  const fingerLen = 38;
  const configs = [
    { offX: -25, offY: 12, base: -40 },
    { offX: -10, offY: -20, base: -85 },
    { offX: 5, offY: -25, base: -90 },
    { offX: 20, offY: -18, base: -95 },
    { offX: 32, offY: -5, base: -110 },
  ];

  return (
    <svg width="180" height="200" className="bg-slate-900 rounded-xl">
      <defs>
        <pattern id="grid2" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1F2937" strokeWidth="0.5"/>
        </pattern>
        <linearGradient id="shell2" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF"/>
          <stop offset="100%" stopColor="#D1D5DB"/>
        </linearGradient>
      </defs>
      <rect width="180" height="200" fill="url(#grid2)"/>
      
      {/* Palm */}
      <path d="M 55,100 Q 50,80 60,70 L 100,70 Q 110,80 105,100 L 102,135 Q 80,145 58,135 Z" fill="#1F2937"/>
      
      {/* Fingers */}
      {configs.map((cfg, idx) => {
        const bx = palmX + cfg.offX;
        const by = palmY + cfg.offY;
        const ang = fingerAngles[idx] || 0;
        const err = fingerErrors[idx] || 0;
        
        // Ideal
        const rad = ((cfg.base + ang) * Math.PI) / 180;
        const tx = bx + fingerLen * Math.cos(rad);
        const ty = by + fingerLen * Math.sin(rad);
        
        // With error
        const radE = ((cfg.base + ang + err) * Math.PI) / 180;
        const txE = bx + fingerLen * Math.cos(radE);
        const tyE = by + fingerLen * Math.sin(radE);

        return (
          <g key={idx}>
            {/* Ideal ghost */}
            <line x1={bx} y1={by} x2={tx} y2={ty} stroke="#06B6D4" strokeWidth="3" opacity="0.3" strokeLinecap="round"/>
            
            {/* Actual */}
            {showError && (
              <g>
                <line x1={bx} y1={by} x2={txE} y2={tyE} stroke="#111827" strokeWidth="8" strokeLinecap="round"/>
                <line x1={bx} y1={by} x2={txE} y2={tyE} stroke="url(#shell2)" strokeWidth="6" strokeLinecap="round"/>
                <circle cx={bx} cy={by} r="4" fill="#1F2937"/>
                <circle cx={txE} cy={tyE} r="3" fill="#111827"/>
              </g>
            )}
          </g>
        );
      })}
      
      <text x="90" y="190" fill="#6B7280" fontSize="9" textAnchor="middle">Dexterous Hand</text>
    </svg>
  );
}

// -----------------------------
// Leg Component  
// -----------------------------

function RobotLeg({ legAngle, hipError, kneeError, showError, step }) {
  const hipX = 80, hipY = 45;
  const thighLen = 50, shinLen = 48;

  const hipA = legAngle;
  const kneeA = Math.abs(legAngle) * 0.8 + 12;
  
  // Ideal
  const hRad = (hipA * Math.PI) / 180;
  const kX = hipX + thighLen * Math.sin(hRad);
  const kY = hipY + thighLen * Math.cos(hRad);
  const kRad = ((hipA - kneeA) * Math.PI) / 180;
  const aX = kX + shinLen * Math.sin(kRad);
  const aY = kY + shinLen * Math.cos(kRad);

  // With error
  const hRadE = ((hipA + hipError) * Math.PI) / 180;
  const kXE = hipX + thighLen * Math.sin(hRadE);
  const kYE = hipY + thighLen * Math.cos(hRadE);
  const kRadE = ((hipA + hipError - kneeA - kneeError) * Math.PI) / 180;
  const aXE = kXE + shinLen * Math.sin(kRadE);
  const aYE = kYE + shinLen * Math.cos(kRadE);
  
  const footErr = Math.sqrt((aX - aXE) ** 2 + (aY - aYE) ** 2);

  return (
    <svg width="180" height="200" className="bg-slate-900 rounded-xl">
      <defs>
        <pattern id="grid3" width="20" height="20" patternUnits="userSpaceOnUse">
          <path d="M 20 0 L 0 0 0 20" fill="none" stroke="#1F2937" strokeWidth="0.5"/>
        </pattern>
        <linearGradient id="shell3" x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor="#FFFFFF"/>
          <stop offset="100%" stopColor="#D1D5DB"/>
        </linearGradient>
      </defs>
      <rect width="180" height="200" fill="url(#grid3)"/>
      
      {/* Pelvis */}
      <path d="M 50,20 L 110,20 L 100,45 L 60,45 Z" fill="#1F2937"/>
      <path d="M 55,24 L 105,24 L 97,42 L 63,42 Z" fill="url(#shell3)"/>
      
      {/* Ideal ghost */}
      <g opacity="0.3">
        <line x1={hipX} y1={hipY} x2={kX} y2={kY} stroke="#06B6D4" strokeWidth="10" strokeLinecap="round"/>
        <line x1={kX} y1={kY} x2={aX} y2={aY} stroke="#06B6D4" strokeWidth="8" strokeLinecap="round"/>
      </g>

      {/* Actual leg */}
      {showError && (
        <g>
          {/* Thigh */}
          <line x1={hipX} y1={hipY} x2={kXE} y2={kYE} stroke="#111827" strokeWidth="16" strokeLinecap="round"/>
          <line x1={hipX} y1={hipY} x2={kXE} y2={kYE} stroke="url(#shell3)" strokeWidth="12" strokeLinecap="round"/>
          
          {/* Shin */}
          <line x1={kXE} y1={kYE} x2={aXE} y2={aYE} stroke="#111827" strokeWidth="12" strokeLinecap="round"/>
          <line x1={kXE} y1={kYE} x2={aXE} y2={aYE} stroke="url(#shell3)" strokeWidth="9" strokeLinecap="round"/>
          
          {/* Foot */}
          <ellipse cx={aXE} cy={aYE + 6} rx="14" ry="6" fill="#111827"/>
          <ellipse cx={aXE} cy={aYE + 5} rx="11" ry="4" fill="url(#shell3)"/>
          
          {/* Joints */}
          <circle cx={hipX} cy={hipY} r="9" fill="#1F2937" stroke="#374151" strokeWidth="2"/>
          <circle cx={kXE} cy={kYE} r="7" fill="#1F2937" stroke="#374151" strokeWidth="2"/>
        </g>
      )}

      {/* Ground */}
      <line x1="10" y1="168" x2="170" y2="168" stroke="#374151" strokeWidth="2"/>
      
      <text x="90" y="185" fill="#6B7280" fontSize="9" textAnchor="middle">
        Step {step} | Δ={footErr.toFixed(1)}
      </text>
    </svg>
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

  const [isRunning, setIsRunning] = useState(false);
  const [progress, setProgress] = useState(0);
  const [results, setResults] = useState(null);

  const [animTime, setAnimTime] = useState(0);
  const [isAnimating, setIsAnimating] = useState(true);
  const animRef = useRef(null);
  const runIdRef = useRef(0);

  // Animation loop
  useEffect(() => {
    if (isAnimating) {
      const animate = () => {
        setAnimTime(t => t + 0.025);
        animRef.current = requestAnimationFrame(animate);
      };
      animRef.current = requestAnimationFrame(animate);
    }
    return () => { if (animRef.current) cancelAnimationFrame(animRef.current); };
  }, [isAnimating]);

  // Compute robot angles
  const armData = useMemo(() => {
    const t = animTime;
    const errScale = results ? results.statsLog.meanRmse * 12 : 0.6;
    return {
      shoulder: 50 + 25 * Math.sin(t * 0.8),
      elbow: 35 + 35 * Math.sin(t * 1.2),
      wrist: 15 * Math.sin(t * 1.8),
      errors: {
        shoulder: errScale * (0.4 + 0.6 * Math.sin(t * 4)),
        elbow: errScale * (0.5 + 0.5 * Math.cos(t * 5)),
        wrist: errScale * (0.3 + 0.7 * Math.sin(t * 7)),
      }
    };
  }, [animTime, results]);

  const fingerData = useMemo(() => {
    const t = animTime;
    const errScale = results ? results.statsLog.meanRmse * 6 : 0.35;
    return {
      angles: [
        25 + 12 * Math.sin(t * 0.6),
        35 + 18 * Math.sin(t * 0.9),
        40 + 20 * Math.sin(t * 0.85),
        35 + 18 * Math.sin(t * 0.75),
        28 + 12 * Math.sin(t * 1.0),
      ],
      errors: [0, 1, 2, 3, 4].map(i => errScale * (0.25 + 0.75 * Math.sin(t * (2.5 + i * 0.5)))),
    };
  }, [animTime, results]);

  const legData = useMemo(() => {
    const t = animTime;
    const errScale = results ? results.statsLog.meanRmse * 10 : 0.5;
    return {
      angle: 22 * Math.sin(t * 1.8),
      step: Math.floor(t / Math.PI) + 1,
      hipError: errScale * (0.35 + 0.65 * Math.sin(t * 5)),
      kneeError: errScale * (0.4 + 0.6 * Math.cos(t * 6)),
    };
  }, [animTime, results]);

  // Run simulation
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
    const eps = 1e-12;
    const chunk = 128;

    for (let pos0 = 0; pos0 < seqLen; pos0 += chunk) {
      if (runIdRef.current !== runId) return;
      const pos1 = Math.min(seqLen, pos0 + chunk);
      
      for (let pos = pos0; pos < pos1; pos++) {
        const logPos = pos <= 0 ? 0 : Math.log(pos);
        let sumSqLog = 0;
        let sumSqNaive = 0;

        for (let i = 0; i < halfEven; i++) {
          const xEven = rand();
          const xOdd = rand();
          const thetaRef = pos * invFreq[i];
          const cosRef = Math.cos(thetaRef);
          const sinRef = Math.sin(thetaRef);
          const yRefEven = xEven * cosRef - xOdd * sinRef;
          const yRefOdd = xEven * sinRef + xOdd * cosRef;

          // Log quantization
          let thetaHatLog = 0;
          if (pos > 0) {
            const logTheta = logPos + logInvFreq[i];
            const qLog = quantizeSigned(logTheta, scalesLog[i], qmaxLog);
            thetaHatLog = Math.exp(qLog * scalesLog[i]);
          }

          const cosHatLog = Math.cos(thetaHatLog);
          const sinHatLog = Math.sin(thetaHatLog);
          const yHatEven = xEven * cosHatLog - xOdd * sinHatLog;
          const yHatOdd = xEven * sinHatLog + xOdd * cosHatLog;
          
          sumSqLog += (yHatEven - yRefEven) ** 2 + (yHatOdd - yRefOdd) ** 2;

          // Naive quantization
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

    setResults({
      statsLog: {
        meanRmse: sumRmseLog / n,
        maxRmse: maxRmseLog,
        drift: (sumLastLog / n10) / (sumFirstLog / n10 + eps),
      },
      statsNaive: showNaive ? {
        meanRmse: sumRmseNaive / n,
        maxRmse: maxRmseNaive,
        drift: (sumLastNaive / n10) / (sumFirstNaive / n10 + eps),
      } : null,
      chartData,
    });
    setIsRunning(false);
    setProgress(100);
  };

  useEffect(() => { runSimulation(); }, []);

  return (
    <div className="min-h-screen bg-black text-gray-100 p-4">
      <div className="max-w-7xl mx-auto">
        {/* Header */}
        <div className="mb-6 border-b border-slate-800 pb-4">
          <div className="flex items-center gap-3 mb-2">
            <div className="w-3 h-3 bg-cyan-400 rounded-full animate-pulse"></div>
            <h1 className="text-2xl font-bold">
              RoPE <span className="text-cyan-400">×</span> Optimus Simulator
            </h1>
          </div>
          <p className="text-gray-500 text-sm">
            Tesla Patent US20260017019A1 — Mixed-Precision Quantization
          </p>
        </div>

        {/* Visualizations */}
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4 mb-6">
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col items-center">
            <h3 className="text-gray-400 text-sm mb-3">Arm Manipulation</h3>
            <RobotArm 
              shoulderAngle={armData.shoulder}
              elbowAngle={armData.elbow}
              wristAngle={armData.wrist}
              errors={armData.errors}
              showError={true}
            />
          </div>
          
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col items-center">
            <h3 className="text-gray-400 text-sm mb-3">Fine Motor Control</h3>
            <RobotHand 
              fingerAngles={fingerData.angles}
              fingerErrors={fingerData.errors}
              showError={true}
            />
          </div>

          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4 flex flex-col items-center">
            <h3 className="text-gray-400 text-sm mb-3">Locomotion Balance</h3>
            <RobotLeg 
              legAngle={legData.angle}
              hipError={legData.hipError}
              kneeError={legData.kneeError}
              showError={true}
              step={legData.step}
            />
          </div>
        </div>

        {/* Legend */}
        <div className="bg-slate-900/30 border border-slate-800 rounded-lg p-3 mb-6">
          <div className="flex flex-wrap gap-6 justify-center text-xs">
            <div className="flex items-center gap-2">
              <div className="w-4 h-1 bg-cyan-500 rounded opacity-50"></div>
              <span className="text-gray-400">Ideal position (float32)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-3 bg-gradient-to-b from-white to-gray-400 rounded-sm"></div>
              <span className="text-gray-400">Actual position (quantized)</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-4 h-0.5 bg-red-500"></div>
              <span className="text-gray-400">Error (Δ)</span>
            </div>
          </div>
        </div>

        {/* Controls & Results */}
        <div className="grid grid-cols-1 lg:grid-cols-4 gap-4">
          {/* Settings */}
          <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
            <h2 className="text-sm font-bold text-white mb-4">⚙️ Parameters</h2>
            <div className="space-y-3">
              <div>
                <label className="text-xs text-gray-500">Sequence Length</label>
                <input type="number" value={seqLen} 
                  onChange={e => setSeqLen(clamp(parseInt(e.target.value) || 4096, 64, 65536))} 
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm mt-1"/>
              </div>
              <div>
                <label className="text-xs text-gray-500">Dimension</label>
                <input type="number" value={dim} step={2}
                  onChange={e => setDim(clamp(parseInt(e.target.value) || 64, 8, 256))} 
                  className="w-full bg-slate-800 border border-slate-700 rounded px-3 py-1.5 text-sm mt-1"/>
              </div>
              <div>
                <label className="text-xs text-gray-500">Quantization Bits</label>
                <div className="flex items-center gap-2 mt-1">
                  <input type="range" min="2" max="8" value={bits} 
                    onChange={e => setBits(parseInt(e.target.value))} 
                    className="flex-1 accent-cyan-500"/>
                  <span className="text-cyan-400 font-mono text-sm w-12">{bits}-bit</span>
                </div>
              </div>
              <button onClick={runSimulation} disabled={isRunning} 
                className={`w-full py-2.5 rounded-lg font-bold text-sm ${
                  isRunning ? 'bg-slate-700 text-slate-500' : 'bg-cyan-600 hover:bg-cyan-500 text-white'
                }`}>
                {isRunning ? `Processing ${progress}%` : 'Run Simulation'}
              </button>
              <button onClick={() => setIsAnimating(!isAnimating)} 
                className="w-full py-2 border border-slate-700 rounded-lg text-xs text-gray-400 hover:bg-slate-800">
                {isAnimating ? '⏸ Pause' : '▶ Play'}
              </button>
            </div>
          </div>

          {/* Results */}
          <div className="lg:col-span-3 space-y-4">
            {results && (
              <>
                {/* Stats */}
                <div className="grid grid-cols-2 gap-4">
                  <div className="bg-gradient-to-br from-slate-900 to-cyan-950/30 border border-cyan-900/30 rounded-xl p-4">
                    <h4 className="text-cyan-400 font-bold text-sm mb-2">Mixed-Precision (Log/Exp)</h4>
                    <div className="text-2xl font-mono text-white">{results.statsLog.meanRmse.toExponential(2)}</div>
                    <div className="text-xs text-gray-500">Mean RMSE | Drift: {results.statsLog.drift.toFixed(2)}x</div>
                  </div>
                  <div className="bg-gradient-to-br from-slate-900 to-orange-950/30 border border-orange-900/30 rounded-xl p-4">
                    <h4 className="text-orange-400 font-bold text-sm mb-2">Naive (Linear)</h4>
                    <div className="text-2xl font-mono text-white">
                      {results.statsNaive ? results.statsNaive.meanRmse.toExponential(2) : '—'}
                    </div>
                    <div className="text-xs text-gray-500">
                      Mean RMSE | Drift: {results.statsNaive ? results.statsNaive.drift.toFixed(2) : '—'}x
                    </div>
                  </div>
                </div>

                {/* Chart */}
                <div className="bg-slate-900/50 border border-slate-800 rounded-xl p-4">
                  <h3 className="text-gray-400 text-sm mb-3">Error vs Position</h3>
                  <ResponsiveContainer width="100%" height={200}>
                    <LineChart data={results.chartData}>
                      <CartesianGrid strokeDasharray="3 3" stroke="#1F2937" />
                      <XAxis dataKey="pos" stroke="#4B5563" tickFormatter={v => v >= 1000 ? `${v/1000}k` : v} fontSize={10}/>
                      <YAxis stroke="#4B5563" tickFormatter={v => v.toExponential(0)} fontSize={10}/>
                      <Tooltip contentStyle={{backgroundColor: '#0F172A', border: '1px solid #1E293B'}} />
                      <Legend />
                      <Line type="monotone" dataKey="logExp" name="Mixed" stroke="#22D3EE" strokeWidth={2} dot={false} />
                      {showNaive && <Line type="monotone" dataKey="naive" name="Naive" stroke="#F97316" strokeWidth={2} dot={false} />}
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </>
            )}
          </div>
        </div>

        {/* Footer */}
        <div className="mt-6 bg-slate-900/30 border border-slate-800 rounded-lg p-4 text-xs text-gray-500">
          <span className="text-cyan-400">θ (angle)</span> → Joint angle | 
          <span className="text-cyan-400 ml-2">log(θ) quantization</span> → Preserve high precision | 
          <span className="text-cyan-400 ml-2">Error accumulation</span> → Amplifies from shoulder → elbow → wrist
        </div>
      </div>
    </div>
  );
}
