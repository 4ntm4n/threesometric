// ──────────────────────────────────────────────────────────────────────────────
// src/ops/stress.js
// Stress = 3D-vinkelavvikelse från node-nominal
//  • Degree 2:
//     – Välj närmsta nominella: 90°, 135°, 180°
//       • 90°: rotationsbar-undantag (bägge icke-riser + ~samma hor. fall) → fria
//               annars: Δ=|90−θ3D|  ;  Δ≤tol → OK ; tol<Δ≤wedgeMax → hint(wedge)
//                      ;  Δ>wedgeMax → meta.special={specialBend}, ingen stress
//       • 135°: meta.special={fixedElbow45}, ingen stress (ev. delta loggas)
//       • 180°: Δ=|180−θ3D| > tolInline → stress (hint/warn)
//  • Degree 3 (tee): runner≈180°, branch≈90° (3D), avvikelse > tol → stress
// ──────────────────────────────────────────────────────────────────────────────

const DEG = 180 / Math.PI;
const clamp = (x,a,b)=>Math.max(a,Math.min(b,x));

function sub(a,b){return {x:a.x-b.x,y:a.y-b.y,z:a.z-b.z};}
function len(v){return Math.hypot(v.x,v.y,v.z);}
function norm(v){const L=len(v)||1; return {x:v.x/L,y:v.y/L,z:v.z/L};}
function dot(a,b){return a.x*b.x + a.y*b.y + a.z*b.z;}
function angle3Ddeg(u,v){return Math.acos(clamp(dot(u,v),-1,1))*DEG;}

// Horisontell projektion / fall
function horizLen(v){return Math.hypot(v.x,v.z);}
function isRiserVec(v){return horizLen(v) <= 1e-9;}
function fallFracHoriz(v){const Lh=horizLen(v); return Lh? Math.abs(v.y)/Lh : 0;}

// Riktning från nid → otherId
function dirTo(graph, nid, otherId){
  const a = graph.getNodeWorldPos?.(nid);
  const b = graph.getNodeWorldPos?.(otherId);
  if (!a || !b) return null;
  return norm(sub(b,a));
}

export function evaluateNodeStress(graph, nodeIds, opts = {}) {
  const T = {
    tolBendDeg:      0.50,  // böj: |90−θ|   > tol → stress (om ej rotationsbar)
    wedgeMaxDeg:     4.00,  // böj: >4° → specialBend (ej stress)
    tolInlineDeg:    0.50,  // inline: |180−θ| > tol → stress
    tolTeeRunDeg:    0.50,  // tee runner 180
    tolTeeBrDeg:     0.50,  // tee branch 90
    tolEqualSlopeFrac: 0.0006, // ≈0.6 mm/m; lika hor. fall ⇒ rotationsbar (liggande 90°)
    debug: false,
    ...opts,
  };

  const ids = (nodeIds && nodeIds.length)
    ? nodeIds
    : (typeof graph.allNodes === 'function' ? [...graph.allNodes().keys()] : []);

  const changed = [];

  for (const nid of ids) {
    const n = graph.getNode?.(nid);
    if (!n) continue;

    const neigh = graph.neighbors?.(nid, { kind:'center' }) ?? [];
    const deg = neigh.length;

    let entries = [];
    let specialSet = false;

    // ---------------- Degree 2: bend / inline / fixed45 ----------------
    if (deg === 2) {
      const v0 = dirTo(graph, nid, neigh[0].otherId);
      const v1 = dirTo(graph, nid, neigh[1].otherId);
      if (!v0 || !v1) continue;

      const a3D = angle3Ddeg(v0, v1);                // faktisk 3D-vinkel
      // Välj närmast nominell (90, 135, 180)
      const cands = [
        { label:'90',  target: 90,  delta: Math.abs( 90 - a3D) },
        { label:'135', target:135,  delta: Math.abs(135 - a3D) },
        { label:'180', target:180,  delta: Math.abs(180 - a3D) },
      ].sort((A,B)=>A.delta - B.delta);
      const nearest = cands[0];

      if (T.debug) console.debug('[Stress/deg2]', {
        nid, angle3D:+a3D.toFixed(3),
        nearest:{label:nearest.label, delta:+nearest.delta.toFixed(3)}
      });

      if (nearest.label === '90') {
        // ROTATIONSBAR UNDANTAG (liggande 90°): bägge icke-riser + ~samma hor. fall ⇒ fria
        const r0 = isRiserVec(v0), r1 = isRiserVec(v1);
        if (!r0 && !r1) {
          const s0 = fallFracHoriz(v0), s1 = fallFracHoriz(v1);
          if (Math.abs(s0 - s1) <= T.tolEqualSlopeFrac) {
            if (T.debug) console.debug('[Stress] freed by rotation', { nid });
            // rensa special/stress nedan
            n.meta = n.meta || {};
            n.meta.special = null;
            entries = [];
          } else {
            const delta = nearest.delta;
            if (delta > T.wedgeMaxDeg) {
              n.meta = n.meta || {};
              n.meta.special = {
                kind: 'specialBend',
                angleDeg: +a3D.toFixed(3),
                deltaFrom90: +delta.toFixed(3),
              };
              specialSet = true;
              entries = []; // ingen stress
              if (T.debug) console.debug('[Stress] specialBend (>wedgeMax)', { nid, delta:+delta.toFixed(3) });
            } else if (delta > T.tolBendDeg) {
              entries.push({
                kind: 'bendAngleDeviation',
                deltaDeg: +delta.toFixed(3),
                note: 'bend deviates from nominal 90° (wedge/trim)',
                severity: 'hint',
              });
              if (T.debug) console.debug('[Stress] wedge (hint)', { nid, delta:+delta.toFixed(3) });
            }
          }
        } else {
          // Minst en riser: klassisk “stående böj”
          const delta = nearest.delta;
          if (delta > T.wedgeMaxDeg) {
            n.meta = n.meta || {};
            n.meta.special = {
              kind: 'specialBend',
              angleDeg: +a3D.toFixed(3),
              deltaFrom90: +delta.toFixed(3),
            };
            specialSet = true;
            entries = [];
            if (T.debug) console.debug('[Stress] specialBend (>wedgeMax, riser-case)', { nid, delta:+delta.toFixed(3) });
          } else if (delta > T.tolBendDeg) {
            entries.push({
              kind: 'bendAngleDeviation',
              deltaDeg: +delta.toFixed(3),
              note: 'bend deviates from nominal 90° (wedge/trim)',
              severity: 'hint',
            });
            if (T.debug) console.debug('[Stress] wedge (riser, hint)', { nid, delta:+delta.toFixed(3) });
          }
        }
      }
      else if (nearest.label === '135') {
        // Fast 45°-böj – ingen stress, bara meta.special (så backend kan matcha komponent)
        n.meta = n.meta || {};
        n.meta.special = {
          kind: 'fixedElbow45',
          angleDeg: +a3D.toFixed(3),
          deltaFrom135: +nearest.delta.toFixed(3),
        };
        specialSet = true;
        entries = [];
        if (T.debug) console.debug('[Stress] fixedElbow45 (no stress)', { nid, delta:+nearest.delta.toFixed(3) });
      }
      else { // nearest 180
        const delta = nearest.delta;
        if (delta > T.tolInlineDeg) {
          entries.push({
            kind: 'inlineAngleDeviation',
            deltaDeg: +delta.toFixed(3),
            note: 'inline component deviates from nominal 180°',
            severity: delta > (2*T.tolInlineDeg) ? 'warn' : 'hint',
          });
        }
      }
    }

    // ---------------- Degree 3: tee ----------------
    if (deg === 3) {
      const dirs = neigh
        .map(it => ({ v: dirTo(graph, nid, it.otherId), otherId: it.otherId }))
        .filter(x => !!x.v);
      if (dirs.length === 3) {
        // välj runner-par som närmast 180° i 3D (inte bara i plan)
        const a01 = Math.abs(180 - angle3Ddeg(dirs[0].v, dirs[1].v));
        const a02 = Math.abs(180 - angle3Ddeg(dirs[0].v, dirs[2].v));
        const a12 = Math.abs(180 - angle3Ddeg(dirs[1].v, dirs[2].v));
        const pairs = [
          { i:[0,1], d:a01 },
          { i:[0,2], d:a02 },
          { i:[1,2], d:a12 },
        ].sort((A,B)=>A.d - B.d);
        const [iR0,iR1] = pairs[0].i;
        const iB = [0,1,2].find(i => i!==iR0 && i!==iR1);

        const vR0 = dirs[iR0].v, vR1 = dirs[iR1].v, vB = dirs[iB].v;

        // Runner
        const aR = angle3Ddeg(vR0, vR1);
        const dRun = Math.abs(180 - aR);
        if (dRun > T.tolTeeRunDeg) {
          entries.push({
            kind: 'teeRunnerAngleDeviation',
            deltaDeg: +dRun.toFixed(3),
            note: 'tee runner deviates from nominal 180°',
            severity: dRun > (2*T.tolTeeRunDeg) ? 'warn' : 'hint',
          });
        }

        // Branch mot båda runners
        const aB0 = angle3Ddeg(vB, vR0);
        const aB1 = angle3Ddeg(vB, vR1);
        const dBr  = Math.min(Math.abs(90 - aB0), Math.abs(90 - aB1));
        if (dBr > T.tolTeeBrDeg) {
          entries.push({
            kind: 'teeBranchAngleDeviation',
            deltaDeg: +dBr.toFixed(3),
            note: 'tee branch deviates from nominal 90°',
            severity: dBr > (2*T.tolTeeBrDeg) ? 'warn' : 'hint',
          });
        }

        if (T.debug) console.debug('[Stress/tee]', {
          nid, runnerDelta:+dRun.toFixed(3), branchDelta:+dBr.toFixed(3)
        });
      }
    }

    // ----- Städa/meta -----
    if (!specialSet && n.meta?.special?.kind) n.meta.special = null;

    const prevStress = !!n.meta?.stress?.present;
    const present = entries.length > 0;

    n.meta = n.meta || {};
    n.meta.stress = present
      ? { present:true, entries, severity: entries.some(e=>e.severity==='warn') ? 'warn' : 'hint' }
      : { present:false, entries:[], severity:null };

    if (T.debug) console.debug('[Stress/node]', {
      nid,
      stress: n.meta.stress,
      special: n.meta.special ?? null
    });

    const prevSpecial = !!(n.meta && n.meta._prevSpecialFlag);
    const currSpecial = !!(n.meta?.special && n.meta.special.kind);
    if (present !== prevStress || prevSpecial !== currSpecial) changed.push(nid);
    n.meta._prevSpecialFlag = currSpecial;
  }

  return { changedNodes: changed };
}
