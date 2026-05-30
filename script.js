/* ═══════════════════════════════════════════════════════════════
   PÁSSAROS FURIOSOS — script.js
   Motor de física próprio + renderer canvas + sistema de fases
   ═══════════════════════════════════════════════════════════════ */

'use strict';

// ──────────────────────────────────────────
// CONSTANTES DE FÍSICA E GAMEPLAY
// ──────────────────────────────────────────
const GRAVITY      = 0.35;   // Aceleração gravitacional (px/frame²)
const FRICTION     = 0.985;  // Fator de atrito (retarda movimento)
const RESTITUTION  = 0.45;   // Elasticidade nos rebotes
const MIN_BOUNCE   = 1.5;    // Velocidade mínima para gerar rebote
const SLING_ORIGIN = { x: 130, y: 0 }; // x fixo, y calculado em resize
const SLING_MAX    = 90;     // Raio máximo do estilingue
const TRAJECTORY_DOTS = 22;  // Pontos na trajetória preditiva

// Pontuação
const SCORE_PIG     = 500;
const SCORE_BLOCK   = 100;
const SCORE_BONUS   = 200;   // Bônus por pássaro extra

// ──────────────────────────────────────────
// ESTADO GLOBAL
// ──────────────────────────────────────────
let canvas, ctx;
let gameState   = 'idle'; // idle | aiming | flying | settling | win | lose
let currentLevel = 1;
let score        = 0;
let pigs         = [];
let blocks       = [];
let particles    = [];
let birds        = [];
let activeBird   = null;
let slingAnchor  = { x: 0, y: 0 };
let dragPos      = null;
let hintShown    = false;
let settled      = false;
let settleTimer  = 0;
let savedProgress = {};

// ──────────────────────────────────────────
// UTILITÁRIOS
// ──────────────────────────────────────────
const clamp = (v, lo, hi) => Math.max(lo, Math.min(hi, v));
const dist  = (a, b)     => Math.hypot(a.x - b.x, a.y - b.y);
const lerp  = (a, b, t)  => a + (b - a) * t;

// Audio simples com Web Audio API
const AudioCtx = window.AudioContext || window.webkitAudioContext;
let audioCtx;

function getAudio() {
  if (!audioCtx) audioCtx = new AudioCtx();
  return audioCtx;
}

function playTone(freq, type, dur, vol = 0.4, detune = 0) {
  try {
    const ac = getAudio();
    const osc  = ac.createOscillator();
    const gain = ac.createGain();
    osc.connect(gain); gain.connect(ac.destination);
    osc.type = type;
    osc.frequency.value  = freq;
    osc.detune.value     = detune;
    gain.gain.setValueAtTime(vol, ac.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ac.currentTime + dur);
    osc.start(); osc.stop(ac.currentTime + dur);
  } catch(e) {}
}

function sfxLaunch()  { playTone(220, 'sawtooth', 0.25, 0.3); playTone(440, 'square', 0.15, 0.15); }
function sfxHit()     { playTone(80,  'square', 0.18, 0.5, 50); }
function sfxPig()     { playTone(300, 'sawtooth', 0.4, 0.45); playTone(200, 'triangle', 0.3, 0.35); }
function sfxExplode() { playTone(60,  'sawtooth', 0.5, 0.6, 100); playTone(120, 'square', 0.35, 0.4); }
function sfxWin()     { [523,659,784,1047].forEach((f,i) => setTimeout(() => playTone(f,'sine',0.5,0.4), i*120)); }
function sfxLose()    { [400,300,200,100].forEach((f,i) => setTimeout(() => playTone(f,'sawtooth',0.35,0.35), i*120)); }

// ──────────────────────────────────────────
// DEFINIÇÃO DAS FASES
// ──────────────────────────────────────────
/*
  Cada fase define:
    birds : array de tipos ('red'|'yellow'|'black')
    pigs  : array de {x, y, radius, hp}
    blocks: array de {x, y, w, h, material:'wood'|'stone'|'ice', angle?:0}
*/
function getLevelData(lvl) {
  const GY = canvas.height;  // ground y
  const GH = 32;             // altura do chão

  // Helpers
  const gy = GY - GH; // y do chão (topo)

  if (lvl === 1) {
    // FASE 1 — Fazenda: estrutura simples de madeira, 3 porcos
    return {
      birds: ['red', 'red', 'yellow', 'red'],
      pigs: [
        { x: 620, y: gy - 28, radius: 28, hp: 1 },
        { x: 780, y: gy - 28, radius: 28, hp: 1 },
        { x: 710, y: gy - 110, radius: 28, hp: 1 },
      ],
      blocks: [
        // Torre esquerda
        { x: 590, y: gy - 60,  w: 20, h: 60,  mat: 'wood' },
        { x: 640, y: gy - 60,  w: 20, h: 60,  mat: 'wood' },
        { x: 590, y: gy - 80,  w: 70, h: 20,  mat: 'wood' },
        // Torre direita
        { x: 750, y: gy - 60,  w: 20, h: 60,  mat: 'wood' },
        { x: 800, y: gy - 60,  w: 20, h: 60,  mat: 'wood' },
        { x: 750, y: gy - 80,  w: 70, h: 20,  mat: 'wood' },
        // Topo central
        { x: 680, y: gy - 140, w: 70, h: 20,  mat: 'wood' },
      ]
    };
  }

  if (lvl === 2) {
    // FASE 2 — Floresta: mistura de madeira e gelo, 4 porcos
    return {
      birds: ['red', 'yellow', 'yellow', 'black', 'red'],
      pigs: [
        { x: 580, y: gy - 28,  radius: 28, hp: 2 },
        { x: 730, y: gy - 28,  radius: 28, hp: 2 },
        { x: 860, y: gy - 28,  radius: 28, hp: 1 },
        { x: 730, y: gy - 170, radius: 28, hp: 1 },
      ],
      blocks: [
        // Base esquerda
        { x: 555, y: gy - 60,  w: 20, h: 60, mat: 'stone' },
        { x: 595, y: gy - 60,  w: 20, h: 60, mat: 'stone' },
        { x: 555, y: gy - 80,  w: 60, h: 20, mat: 'wood' },
        // Torre central
        { x: 695, y: gy - 80,  w: 20, h: 80, mat: 'wood' },
        { x: 745, y: gy - 80,  w: 20, h: 80, mat: 'wood' },
        { x: 695, y: gy - 100, w: 70, h: 20, mat: 'ice' },
        { x: 695, y: gy - 180, w: 20, h: 80, mat: 'wood' },
        { x: 745, y: gy - 180, w: 20, h: 80, mat: 'wood' },
        { x: 695, y: gy - 200, w: 70, h: 20, mat: 'ice' },
        // Torre direita
        { x: 840, y: gy - 60,  w: 20, h: 60, mat: 'stone' },
        { x: 880, y: gy - 60,  w: 20, h: 60, mat: 'stone' },
        { x: 840, y: gy - 80,  w: 60, h: 20, mat: 'wood' },
      ]
    };
  }

  if (lvl === 3) {
    // FASE 3 — Fortaleza: pedra + gelo + 5 porcos
    return {
      birds: ['red', 'yellow', 'black', 'black', 'red', 'yellow'],
      pigs: [
        { x: 570, y: gy - 28,  radius: 28, hp: 3 },
        { x: 700, y: gy - 28,  radius: 28, hp: 3 },
        { x: 830, y: gy - 28,  radius: 28, hp: 2 },
        { x: 700, y: gy - 170, radius: 28, hp: 2 },
        { x: 700, y: gy - 320, radius: 28, hp: 1 },
      ],
      blocks: [
        // Parede esquerda
        { x: 545, y: gy - 100, w: 20, h: 100, mat: 'stone' },
        { x: 585, y: gy - 100, w: 20, h: 100, mat: 'stone' },
        { x: 545, y: gy - 120, w: 60, h: 20,  mat: 'stone' },
        // Torre central — nível 1
        { x: 660, y: gy - 100, w: 20, h: 100, mat: 'stone' },
        { x: 740, y: gy - 100, w: 20, h: 100, mat: 'stone' },
        { x: 660, y: gy - 120, w: 100, h: 20, mat: 'stone' },
        // Torre central — nível 2
        { x: 660, y: gy - 240, w: 20, h: 120, mat: 'wood' },
        { x: 740, y: gy - 240, w: 20, h: 120, mat: 'wood' },
        { x: 660, y: gy - 260, w: 100, h: 20, mat: 'ice' },
        // Torre central — nível 3
        { x: 675, y: gy - 360, w: 20, h: 100, mat: 'wood' },
        { x: 725, y: gy - 360, w: 20, h: 100, mat: 'wood' },
        { x: 675, y: gy - 380, w: 70, h: 20,  mat: 'ice' },
        // Parede direita
        { x: 810, y: gy - 100, w: 20, h: 100, mat: 'stone' },
        { x: 850, y: gy - 100, w: 20, h: 100, mat: 'stone' },
        { x: 810, y: gy - 120, w: 60, h: 20,  mat: 'stone' },
        // Travessas extras
        { x: 620, y: gy - 60,  w: 30, h: 20,  mat: 'wood' },
        { x: 760, y: gy - 60,  w: 30, h: 20,  mat: 'wood' },
      ]
    };
  }
}

// ──────────────────────────────────────────
// CLASSES DE OBJETOS DO JOGO
// ──────────────────────────────────────────

/**
 * Bird — representa um pássaro a ser lançado
 * tipos: 'red' (comum), 'yellow' (veloz), 'black' (explosivo)
 */
class Bird {
  constructor(type) {
    this.type   = type;
    this.radius = type === 'black' ? 22 : 18;
    this.x      = slingAnchor.x;
    this.y      = slingAnchor.y;
    this.vx     = 0;
    this.vy     = 0;
    this.active = false;  // está em voo?
    this.dead   = false;
    this.onGround = false;
    this.trail  = [];     // rastro visual
    this.exploded = false;
    this.mass   = type === 'black' ? 2.5 : (type === 'yellow' ? 0.9 : 1.4);
    this.alpha  = 1;
    this.angle  = 0;
  }

  launch(vx, vy) {
    if (this.type === 'yellow') { vx *= 1.55; vy *= 1.3; }  // amarelo mais rápido
    this.vx = vx; this.vy = vy;
    this.active = true;
    sfxLaunch();
  }

  update(gY) {
    if (!this.active) return;

    // Rastro
    this.trail.push({ x: this.x, y: this.y, alpha: 1 });
    if (this.trail.length > 18) this.trail.shift();
    this.trail.forEach(t => t.alpha -= 0.06);

    this.vy += GRAVITY * this.mass;
    this.vx *= FRICTION;
    this.x  += this.vx;
    this.y  += this.vy;
    this.angle = Math.atan2(this.vy, this.vx);

    // Colisão com o chão
    if (this.y + this.radius >= gY) {
      this.y  = gY - this.radius;
      if (Math.abs(this.vy) > MIN_BOUNCE) {
        this.vy *= -RESTITUTION;
        sfxHit();
      } else {
        this.vy = 0;
        this.onGround = true;
      }
      this.vx *= 0.7;
    }

    // Colisão com bordas laterais
    if (this.x - this.radius < 0) { this.x = this.radius; this.vx *= -0.5; }

    // Fade out quando parado
    if (this.onGround && Math.abs(this.vx) < 0.3) {
      this.alpha -= 0.02;
      if (this.alpha <= 0) this.dead = true;
    }
  }

  // Explosão do pássaro preto
  explode(px, py) {
    if (this.exploded || this.type !== 'black') return;
    this.exploded = true;
    const R = 110; // raio da explosão
    sfxExplode();

    // Gerar partículas de fogo
    for (let i = 0; i < 28; i++) {
      const ang = (Math.PI * 2 / 28) * i;
      const spd = 4 + Math.random() * 5;
      particles.push(new Particle(
        px, py,
        Math.cos(ang) * spd, Math.sin(ang) * spd,
        ['#ff6f00','#fdd835','#ff5722','#ff8f00'][Math.floor(Math.random()*4)],
        0.8 + Math.random() * 0.4,
        6 + Math.random() * 6
      ));
    }

    // Dano em área
    [...pigs, ...blocks].forEach(obj => {
      const d = dist({x: px, y: py}, {x: obj.x, y: obj.y});
      if (d < R) {
        const force = (1 - d / R) * 18;
        const ang   = Math.atan2(obj.y - py, obj.x - px);
        if (obj instanceof Block) {
          obj.vx += Math.cos(ang) * force;
          obj.vy += Math.sin(ang) * force * 0.8;
          obj.hp -= (1 - d / R) * 60;
          if (obj.hp <= 0 && !obj.destroyed) { obj.destroyed = true; spawnBlockParticles(obj); score += SCORE_BLOCK; }
        } else if (obj instanceof Pig) {
          obj.hp -= 2;
          obj.vx += Math.cos(ang) * force * 1.2;
          obj.vy += Math.sin(ang) * force * 0.8;
        }
      }
    });

    this.dead = true;
  }

  draw(ctx) {
    // Rastro
    this.trail.forEach(t => {
      ctx.save();
      ctx.globalAlpha = Math.max(0, t.alpha) * this.alpha;
      ctx.beginPath();
      ctx.arc(t.x, t.y, this.radius * 0.55, 0, Math.PI * 2);
      ctx.fillStyle = this.trailColor();
      ctx.fill();
      ctx.restore();
    });

    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.translate(this.x, this.y);
    if (this.active) ctx.rotate(this.angle);

    // Sombra
    ctx.beginPath();
    ctx.ellipse(0, this.radius + 2, this.radius * 0.7, 5, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.18)';
    ctx.fill();

    // Corpo
    const r = this.radius;
    const colors = { red: '#e53935', yellow: '#fdd835', black: '#37474f' };
    const col = colors[this.type] || '#e53935';
    const grad = ctx.createRadialGradient(-r*0.3, -r*0.3, r*0.1, 0, 0, r);
    grad.addColorStop(0, lighten(col, 40));
    grad.addColorStop(1, col);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = darken(col, 30);
    ctx.lineWidth = 2;
    ctx.stroke();

    // Olhos
    const ex = r * 0.3, ey = -r * 0.1;
    ctx.beginPath(); ctx.arc(ex, ey, r * 0.22, 0, Math.PI * 2);
    ctx.fillStyle = 'white'; ctx.fill();
    ctx.beginPath(); ctx.arc(ex + r * 0.06, ey + r * 0.04, r * 0.1, 0, Math.PI * 2);
    ctx.fillStyle = '#333'; ctx.fill();

    // Bico / ícone por tipo
    if (this.type === 'yellow') {
      ctx.beginPath();
      ctx.moveTo(r*0.5, -r*0.12);
      ctx.lineTo(r*0.9, 0);
      ctx.lineTo(r*0.5, r*0.12);
      ctx.fillStyle = '#f57f17';
      ctx.fill();
    } else if (this.type === 'black') {
      // Pavio/mecha
      ctx.strokeStyle = '#795548'; ctx.lineWidth = 3;
      ctx.beginPath(); ctx.moveTo(-r*0.1, -r); ctx.quadraticCurveTo(r*0.2, -r*1.3, r*0.1, -r*1.5);
      ctx.stroke();
      // Brilho do pavio
      ctx.beginPath(); ctx.arc(r*0.08, -r*1.45, 4, 0, Math.PI*2);
      ctx.fillStyle = '#ff6f00'; ctx.fill();
    } else {
      // Bico do pássaro vermelho
      ctx.beginPath();
      ctx.moveTo(r*0.5, -r*0.1); ctx.lineTo(r*0.9, r*0.1); ctx.lineTo(r*0.5, r*0.3);
      ctx.fillStyle = '#ff8f00'; ctx.fill();
    }

    ctx.restore();
  }

  trailColor() {
    return { red: '#ef9a9a', yellow: '#fff176', black: '#90a4ae' }[this.type] || '#ef9a9a';
  }
}

/**
 * Pig — inimigo a ser eliminado
 */
class Pig {
  constructor(x, y, radius, hp) {
    this.x = x; this.y = y;
    this.radius = radius;
    this.hp = hp; this.maxHp = hp;
    this.vx = 0; this.vy = 0;
    this.dead = false;
    this.onGround = false;
    this.angle = 0;
    this.alpha = 1;
    this.dazed = 0; // timer de atordoamento
  }

  update(gY) {
    if (this.dead) return;
    this.vy += GRAVITY * 1.2;
    this.vx *= FRICTION;
    this.vy *= FRICTION;
    this.x  += this.vx;
    this.y  += this.vy;

    // Rolamento no chão
    if (Math.abs(this.vx) > 0.5) this.angle += this.vx * 0.04;

    if (this.y + this.radius >= gY) {
      this.y = gY - this.radius;
      if (Math.abs(this.vy) > MIN_BOUNCE) {
        this.vy *= -RESTITUTION * 0.7;
        sfxHit();
      } else {
        this.vy = 0;
        this.onGround = true;
      }
      this.vx *= 0.75;
    }

    if (this.x - this.radius < 0) { this.x = this.radius; this.vx *= -0.5; }
    if (this.dazed > 0) this.dazed--;

    if (this.hp <= 0 && !this.dead) { this.dead = true; spawnPigParticles(this); sfxPig(); score += SCORE_PIG; }
  }

  draw(ctx) {
    if (this.dead) return;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);

    // Sombra
    ctx.beginPath();
    ctx.ellipse(0, this.radius, this.radius * 0.8, 6, 0, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(0,0,0,0.2)';
    ctx.fill();

    const r = this.radius;
    const dmg = 1 - (this.hp / this.maxHp);
    const col = dmg > 0.5 ? '#558b2f' : '#689f38';

    // Corpo
    const grad = ctx.createRadialGradient(-r*0.25, -r*0.25, r*0.05, 0, 0, r);
    grad.addColorStop(0, '#a5d6a7');
    grad.addColorStop(1, col);
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#33691e';
    ctx.lineWidth = 2.5;
    ctx.stroke();

    // Snout
    ctx.beginPath();
    ctx.ellipse(r*0.1, r*0.3, r*0.32, r*0.22, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#a5d6a7';
    ctx.fill();
    ctx.strokeStyle = '#33691e'; ctx.lineWidth = 1.5; ctx.stroke();

    // Nariz
    [-0.12, 0.12].forEach(dx => {
      ctx.beginPath(); ctx.arc(r*0.1 + dx*r, r*0.32, r*0.07, 0, Math.PI*2);
      ctx.fillStyle = '#33691e'; ctx.fill();
    });

    // Olhos
    [[-0.3, -0.15], [0.35, -0.15]].forEach(([ex, ey]) => {
      ctx.beginPath(); ctx.arc(r*ex, r*ey, r*0.2, 0, Math.PI*2);
      ctx.fillStyle = 'white'; ctx.fill();
      ctx.strokeStyle = '#33691e'; ctx.lineWidth = 1.5; ctx.stroke();
      ctx.beginPath(); ctx.arc(r*ex + r*0.04, r*ey + r*0.04, r*0.09, 0, Math.PI*2);
      ctx.fillStyle = '#1b5e20'; ctx.fill();
    });

    // Sobrancelhas furiosas
    ctx.strokeStyle = '#33691e'; ctx.lineWidth = 2.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(-r*0.48, -r*0.32); ctx.lineTo(-r*0.12, -r*0.22); ctx.stroke();
    ctx.beginPath(); ctx.moveTo(r*0.48, -r*0.32); ctx.lineTo(r*0.12, -r*0.22); ctx.stroke();

    // Marcas de dano
    if (dmg > 0) {
      ctx.strokeStyle = 'rgba(0,0,0,0.3)'; ctx.lineWidth = 1.5;
      for (let i = 0; i < Math.floor(dmg * 3); i++) {
        const ang = (i * 2.1) + this.angle;
        ctx.beginPath();
        ctx.moveTo(Math.cos(ang) * r*0.4, Math.sin(ang) * r*0.4);
        ctx.lineTo(Math.cos(ang) * r*0.7, Math.sin(ang) * r*0.7);
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}

/**
 * Block — bloco destrutível
 * mat: 'wood' | 'stone' | 'ice'
 */
class Block {
  constructor(x, y, w, h, mat = 'wood') {
    this.x = x; this.y = y;
    this.w = w; this.h = h;
    this.mat = mat;
    this.maxHp = { wood: 40, stone: 100, ice: 30 }[mat] || 40;
    this.hp    = this.maxHp;
    this.vx    = 0; this.vy    = 0;
    this.angle = 0;
    this.destroyed = false;
    this.onGround  = false;
    this.alpha = 1;
  }

  get cx() { return this.x + this.w / 2; }
  get cy() { return this.y + this.h / 2; }

  update(gY) {
    if (this.destroyed) return;
    this.vy += GRAVITY * 1.1;
    this.vx *= FRICTION * 0.98;
    this.vy *= FRICTION;
    this.x  += this.vx;
    this.y  += this.vy;

    // Rotação por movimento
    if (Math.abs(this.vx) > 0.4 || !this.onGround) this.angle += this.vx * 0.02;

    const bot = this.y + this.h;
    if (bot >= gY) {
      this.y = gY - this.h;
      if (Math.abs(this.vy) > MIN_BOUNCE) {
        this.vy *= -RESTITUTION * 0.6;
        sfxHit();
      } else {
        this.vy = 0;
        this.onGround = true;
      }
      this.vx *= 0.72;
    }
    if (this.x < 0) { this.x = 0; this.vx *= -0.4; }
  }

  draw(ctx) {
    if (this.destroyed) return;
    ctx.save();
    ctx.globalAlpha = this.alpha;
    ctx.translate(this.cx, this.cy);
    ctx.rotate(this.angle);

    const hw = this.w / 2, hh = this.h / 2;
    const dmg = 1 - this.hp / this.maxHp;

    const matColors = {
      wood:  { fill: '#795548', dark: '#4e342e', grain: '#6d4c41', light: '#a1887f' },
      stone: { fill: '#607d8b', dark: '#37474f', grain: '#546e7a', light: '#90a4ae' },
      ice:   { fill: '#80deea', dark: '#00acc1', grain: '#4dd0e1', light: '#e0f7fa' }
    };
    const mc = matColors[this.mat] || matColors.wood;

    // Sombra
    ctx.shadowColor = 'rgba(0,0,0,0.25)';
    ctx.shadowBlur  = 6;
    ctx.shadowOffsetY = 3;

    // Corpo principal
    ctx.beginPath();
    roundRect(ctx, -hw, -hh, this.w, this.h, 3);
    ctx.fillStyle = mc.fill;
    ctx.fill();
    ctx.shadowBlur = 0; ctx.shadowOffsetY = 0;

    // Borda / profundidade
    ctx.strokeStyle = mc.dark;
    ctx.lineWidth   = 2;
    ctx.stroke();

    // Grão/textura
    ctx.strokeStyle = mc.grain; ctx.lineWidth = 1; ctx.globalAlpha *= 0.4;
    if (this.mat === 'wood') {
      for (let i = -hw + 8; i < hw; i += 10) {
        ctx.beginPath(); ctx.moveTo(i, -hh); ctx.lineTo(i, hh); ctx.stroke();
      }
    } else if (this.mat === 'stone') {
      ctx.beginPath(); ctx.moveTo(-hw, 0); ctx.lineTo(hw, 0); ctx.stroke();
      ctx.beginPath(); ctx.moveTo(0, -hh); ctx.lineTo(0, hh); ctx.stroke();
    } else {
      ctx.globalAlpha *= 2;
      ctx.fillStyle = 'rgba(255,255,255,0.25)';
      ctx.fillRect(-hw, -hh, this.w * 0.4, this.h);
    }
    ctx.globalAlpha = this.alpha;

    // Highlight
    ctx.fillStyle = mc.light;
    ctx.globalAlpha *= 0.3;
    roundRect(ctx, -hw + 2, -hh + 2, this.w * 0.35, this.h * 0.25, 2);
    ctx.fill();
    ctx.globalAlpha = this.alpha;

    // Rachaduras conforme o dano
    if (dmg > 0.15) {
      ctx.strokeStyle = mc.dark; ctx.lineWidth = 1.5; ctx.globalAlpha *= 0.7;
      const crackCount = Math.floor(dmg * 5);
      for (let i = 0; i < crackCount; i++) {
        const sx = lerp(-hw * 0.6, hw * 0.6, (i + 0.5) / crackCount);
        ctx.beginPath();
        ctx.moveTo(sx, -hh * 0.5);
        ctx.lineTo(sx + (Math.random() - 0.5) * hw * 0.5, hh * 0.6);
        ctx.stroke();
      }
    }

    ctx.restore();
  }
}

/**
 * Particle — fragmento visual de destruição
 */
class Particle {
  constructor(x, y, vx, vy, color, life = 1, size = 5) {
    this.x = x; this.y = y;
    this.vx = vx; this.vy = vy;
    this.color = color;
    this.life  = life;
    this.maxLife = life;
    this.size  = size;
    this.dead  = false;
    this.gravity = 0.22;
    this.spin  = (Math.random() - 0.5) * 0.3;
    this.angle = Math.random() * Math.PI * 2;
  }

  update() {
    this.vy += this.gravity;
    this.x  += this.vx;
    this.y  += this.vy;
    this.vx *= 0.98;
    this.vy *= 0.98;
    this.angle += this.spin;
    this.life  -= 0.022;
    if (this.life <= 0) this.dead = true;
  }

  draw(ctx) {
    ctx.save();
    ctx.globalAlpha = Math.max(0, this.life / this.maxLife);
    ctx.translate(this.x, this.y);
    ctx.rotate(this.angle);
    ctx.fillStyle = this.color;
    ctx.fillRect(-this.size / 2, -this.size / 2, this.size, this.size);
    ctx.restore();
  }
}

// ──────────────────────────────────────────
// HELPERS DE DESENHO
// ──────────────────────────────────────────
function roundRect(ctx, x, y, w, h, r) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

function lighten(hex, pct) {
  const n = parseInt(hex.slice(1), 16);
  const r = clamp(((n >> 16) & 0xff) + pct, 0, 255);
  const g = clamp(((n >> 8)  & 0xff) + pct, 0, 255);
  const b = clamp((n & 0xff) + pct, 0, 255);
  return `rgb(${r},${g},${b})`;
}

function darken(hex, pct) { return lighten(hex, -pct); }

// ──────────────────────────────────────────
// SPAWNERS DE PARTÍCULAS
// ──────────────────────────────────────────
function spawnBlockParticles(block) {
  const matPalette = {
    wood:  ['#795548','#6d4c41','#a1887f','#d7ccc8'],
    stone: ['#607d8b','#546e7a','#90a4ae','#b0bec5'],
    ice:   ['#80deea','#4dd0e1','#e0f7fa','#b2ebf2']
  };
  const pal = matPalette[block.mat] || matPalette.wood;
  const count = 14 + Math.floor(block.w * 0.3);
  for (let i = 0; i < count; i++) {
    const ang = Math.random() * Math.PI * 2;
    const spd = 2 + Math.random() * 5;
    particles.push(new Particle(
      block.cx, block.cy,
      Math.cos(ang) * spd + block.vx,
      Math.sin(ang) * spd + block.vy - 2,
      pal[Math.floor(Math.random() * pal.length)],
      0.7 + Math.random() * 0.6,
      4 + Math.random() * 5
    ));
  }
}

function spawnPigParticles(pig) {
  const pal = ['#69f0ae','#a5d6a7','#ffd54f','#c8e6c9','#ffffff'];
  for (let i = 0; i < 20; i++) {
    const ang = (Math.PI * 2 / 20) * i;
    const spd = 2 + Math.random() * 4;
    particles.push(new Particle(
      pig.x, pig.y,
      Math.cos(ang) * spd + pig.vx,
      Math.sin(ang) * spd + pig.vy,
      pal[Math.floor(Math.random() * pal.length)],
      0.9 + Math.random() * 0.6,
      5 + Math.random() * 6
    ));
  }
}

// ──────────────────────────────────────────
// FÍSICA — COLISÃO BIRD ↔ PIG / BLOCK
// ──────────────────────────────────────────
function handleBirdCollisions(bird) {
  if (!bird.active || bird.dead) return;

  // vs Pigs
  pigs.forEach(pig => {
    if (pig.dead) return;
    const d = dist(bird, pig);
    if (d < bird.radius + pig.radius) {
      // Vetor normal de saída
      const nx = (pig.x - bird.x) / d;
      const ny = (pig.y - bird.y) / d;
      const speed = Math.hypot(bird.vx, bird.vy);

      // Impulso no porco
      pig.vx += nx * speed * 1.1;
      pig.vy += ny * speed * 0.8 - 2;
      pig.hp  -= 1 + speed * 0.12;
      pig.dazed = 60;

      // Empurra o pássaro
      bird.vx -= nx * speed * 0.35;
      bird.vy -= ny * speed * 0.35;

      if (bird.type === 'black') bird.explode(bird.x, bird.y);
    }
  });

  // vs Blocks
  blocks.forEach(block => {
    if (block.destroyed) return;

    // Colisão simplificada: bounding box expandido
    const cx = block.cx, cy = block.cy;
    const hw = block.w / 2 + bird.radius;
    const hh = block.h / 2 + bird.radius;
    const dx = bird.x - cx, dy = bird.y - cy;

    if (Math.abs(dx) < hw && Math.abs(dy) < hh) {
      const speed = Math.hypot(bird.vx, bird.vy);
      const dmg   = speed * (bird.type === 'black' ? 2 : 1.2) *
                    (bird.type === 'yellow' ? 0.85 : 1);

      block.hp -= dmg;
      // Impulso no bloco
      const frac = { wood: 0.9, stone: 0.45, ice: 1 }[block.mat] || 0.9;
      block.vx += (bird.vx / (block.w * 0.05)) * frac;
      block.vy += (bird.vy / (block.h * 0.05)) * frac - 1;

      // Rebote do pássaro
      if (Math.abs(dx) > Math.abs(dy)) {
        bird.vx *= -0.4;
      } else {
        bird.vy *= -0.4;
      }
      bird.vx *= 0.7;

      if (block.hp <= 0 && !block.destroyed) {
        block.destroyed = true;
        spawnBlockParticles(block);
        score += SCORE_BLOCK;
        sfxHit();
      } else {
        sfxHit();
      }

      if (bird.type === 'black') bird.explode(bird.x, bird.y);
    }
  });
}

// ──────────────────────────────────────────
// FÍSICA — COLISÃO BLOCK ↔ PIG (queda)
// ──────────────────────────────────────────
function handleBlockPigCollisions() {
  blocks.forEach(block => {
    if (block.destroyed) return;
    pigs.forEach(pig => {
      if (pig.dead) return;
      const d = dist(block, pig);
      const minD = Math.max(block.w, block.h) / 2 + pig.radius;
      if (d < minD * 0.85) {
        const spd = Math.hypot(block.vx, block.vy);
        if (spd > 2) {
          pig.hp -= spd * 0.3;
          pig.vx += block.vx * 0.5;
          pig.vy += block.vy * 0.5 - 1;
        }
      }
    });
  });
}

// ──────────────────────────────────────────
// PREPARAR / INICIAR FASE
// ──────────────────────────────────────────
function initLevel(lvl) {
  currentLevel = lvl;
  score = 0;
  gameState = 'idle';
  particles = [];
  settleTimer = 0;
  hintShown = false;

  const data = getLevelData(lvl);
  birds  = data.birds.map(t => new Bird(t));
  pigs   = data.pigs.map(p => new Pig(p.x, p.y, p.radius, p.hp));
  blocks = data.blocks.map(b => new Block(b.x, b.y, b.w, b.h, b.mat));

  activeBird = null;
  prepareBird();
  updateHUD();
  updateBirdQueue();
  document.getElementById('aim-hint').classList.remove('hidden');

  showScreen('game');
}

function prepareBird() {
  // Coloca o próximo pássaro no estilingue
  const next = birds.find(b => !b.active && !b.dead);
  if (!next) { activeBird = null; return; }
  next.x = slingAnchor.x;
  next.y = slingAnchor.y;
  activeBird = next;
  gameState = 'idle';
}

// ──────────────────────────────────────────
// TRAJETÓRIA PREDITIVA
// ──────────────────────────────────────────
function computeTrajectory(ox, oy, vx, vy, steps, dt = 1) {
  const pts = [];
  let x = ox, y = oy, tvx = vx, tvy = vy;
  const bird = activeBird;
  const mass = bird ? bird.mass : 1.4;
  for (let i = 0; i < steps; i++) {
    tvy += GRAVITY * mass;
    tvx *= FRICTION;
    x += tvx * dt;
    y += tvy * dt;
    if (y + 16 >= canvas.height - 32) break;
    pts.push({ x, y });
  }
  return pts;
}

// ──────────────────────────────────────────
// HUD
// ──────────────────────────────────────────
function updateHUD() {
  document.getElementById('hud-level').textContent = currentLevel;
  document.getElementById('hud-score').textContent = score;
}

function updateBirdQueue() {
  const q = document.getElementById('bird-queue');
  q.innerHTML = '';
  const icons = { red: '🐦', yellow: '⚡', black: '💣' };
  birds.forEach((b, i) => {
    if (b.dead) return;
    const el = document.createElement('div');
    el.className = 'queue-bird' + (b === activeBird ? ' current' : '');
    el.textContent = icons[b.type] || '🐦';
    q.appendChild(el);
  });
}

// ──────────────────────────────────────────
// GESTÃO DE TELAS
// ──────────────────────────────────────────
function showScreen(name) {
  document.querySelectorAll('.screen').forEach(s => s.classList.remove('active'));
  const el = document.getElementById('screen-' + name);
  if (el) el.classList.add('active');
}

// ──────────────────────────────────────────
// FIM DE JOGO — vitória / derrota
// ──────────────────────────────────────────
function checkWin() {
  if (gameState === 'win' || gameState === 'lose') return;
  const alivePigs  = pigs.filter(p => !p.dead).length;
  const birdsLeft  = birds.filter(b => !b.active && !b.dead).length;
  const flying     = birds.some(b => b.active && !b.dead);

  if (alivePigs === 0) {
    // VITÓRIA
    gameState = 'win';
    const bonusScore = birdsLeft * SCORE_BONUS;
    score += bonusScore;
    const stars = calcStars(score, currentLevel);

    // Salvar progresso
    savedProgress[currentLevel] = Math.max(savedProgress[currentLevel] || 0, stars);
    savedProgress['score_' + currentLevel] = Math.max(savedProgress['score_' + currentLevel] || 0, score);
    try { localStorage.setItem('slingshot_progress', JSON.stringify(savedProgress)); } catch(e) {}

    sfxWin();
    showWinScreen(stars, bonusScore, birdsLeft);
    updateStarsDisplay();

  } else if (!flying && activeBird === null) {
    // DERROTA — sem pássaros e ainda há porcos
    gameState = 'lose';
    sfxLose();
    showLoseScreen();
  }
}

function calcStars(sc, lvl) {
  const thresholds = {
    1: [1000, 2000, 3500],
    2: [2000, 4000, 6500],
    3: [4000, 7000, 11000]
  }[lvl] || [500, 1000, 2000];
  if (sc >= thresholds[2]) return 3;
  if (sc >= thresholds[1]) return 2;
  if (sc >= thresholds[0]) return 1;
  return 0;
}

function showWinScreen(stars, bonus, birdsLeft) {
  document.getElementById('win-score').textContent = score;
  const starsEl = document.getElementById('win-stars');
  starsEl.innerHTML = '';
  for (let i = 1; i <= 3; i++) {
    const s = document.createElement('span');
    s.className = 'result-star' + (i <= stars ? ' earned' : '');
    s.textContent = '⭐';
    s.style.animationDelay = (i * 0.25) + 's';
    starsEl.appendChild(s);
  }
  const bd = document.getElementById('win-breakdown');
  bd.innerHTML = `
    <div class="breakdown-row"><span>Porcos eliminados</span><strong>${pigs.filter(p=>p.dead).length * SCORE_PIG}</strong></div>
    <div class="breakdown-row"><span>Blocos destruídos</span><strong>${blocks.filter(b=>b.destroyed).length * SCORE_BLOCK}</strong></div>
    <div class="breakdown-row"><span>Bônus de pássaros (×${birdsLeft})</span><strong>+${bonus}</strong></div>
  `;

  // Botão próxima fase
  const btnNext = document.getElementById('btn-win-next');
  if (currentLevel >= 3) {
    btnNext.textContent = '🏠 Menu';
    btnNext.onclick = () => showScreen('intro');
  } else {
    btnNext.textContent = 'Próxima ▶';
    btnNext.onclick = () => initLevel(currentLevel + 1);
  }

  setTimeout(() => showScreen('win'), 600);
}

function showLoseScreen() {
  document.getElementById('lose-score').textContent = score;
  setTimeout(() => showScreen('lose'), 500);
}

// ──────────────────────────────────────────
// ESTRELAS NA TELA INICIAL
// ──────────────────────────────────────────
function updateStarsDisplay() {
  for (let lvl = 1; lvl <= 3; lvl++) {
    const stars = savedProgress[lvl] || 0;
    const el = document.getElementById('stars-' + lvl);
    if (el) {
      el.innerHTML = '⭐⭐⭐'.split('').map((s, i) =>
        `<span class="star" style="opacity:${i < stars ? 1 : 0.2}">${s}</span>`
      ).join('');
    }
  }
}

// ──────────────────────────────────────────
// RENDERIZAÇÃO DO CENÁRIO
// ──────────────────────────────────────────
function drawBackground() {
  const W = canvas.width, H = canvas.height;
  const GH = 32;

  // Céu gradiente
  const skyGrad = ctx.createLinearGradient(0, 0, 0, H * 0.75);
  skyGrad.addColorStop(0,   '#4fc3f7');
  skyGrad.addColorStop(0.6, '#81d4fa');
  skyGrad.addColorStop(1,   '#b3e5fc');
  ctx.fillStyle = skyGrad;
  ctx.fillRect(0, 0, W, H);

  // Nuvens estáticas de fundo
  drawCloud(ctx, W * 0.1, H * 0.1, 90);
  drawCloud(ctx, W * 0.45, H * 0.08, 120);
  drawCloud(ctx, W * 0.72, H * 0.14, 80);
  drawCloud(ctx, W * 0.88, H * 0.06, 65);

  // Montanhas silhueta
  ctx.fillStyle = '#a5c8a0';
  ctx.beginPath();
  ctx.moveTo(0, H - GH - 60);
  ctx.lineTo(W * 0.1, H - GH - 160);
  ctx.lineTo(W * 0.2, H - GH - 80);
  ctx.lineTo(W * 0.32, H - GH - 200);
  ctx.lineTo(W * 0.44, H - GH - 100);
  ctx.lineTo(W * 0.6,  H - GH - 180);
  ctx.lineTo(W * 0.75, H - GH - 90);
  ctx.lineTo(W * 0.9,  H - GH - 150);
  ctx.lineTo(W, H - GH - 70);
  ctx.lineTo(W, H - GH);
  ctx.lineTo(0, H - GH);
  ctx.closePath();
  ctx.fill();

  // Grama
  const grassGrad = ctx.createLinearGradient(0, H - GH - 20, 0, H);
  grassGrad.addColorStop(0, '#66bb6a');
  grassGrad.addColorStop(0.3, '#4caf50');
  grassGrad.addColorStop(1, '#388e3c');
  ctx.fillStyle = grassGrad;
  ctx.fillRect(0, H - GH, W, GH);

  // Linha de terra
  ctx.strokeStyle = '#2e7d32';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, H - GH); ctx.lineTo(W, H - GH);
  ctx.stroke();

  // Pedrinhas / detalhes no chão
  ctx.fillStyle = '#2e7d32';
  for (let i = 20; i < W; i += 80 + Math.sin(i) * 30) {
    ctx.beginPath();
    ctx.ellipse(i, H - GH + 8, 12, 5, 0, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawCloud(ctx, x, y, size) {
  ctx.save();
  ctx.fillStyle = 'rgba(255,255,255,0.85)';
  ctx.beginPath();
  ctx.arc(x, y, size * 0.5, 0, Math.PI * 2);
  ctx.arc(x + size * 0.35, y - size * 0.15, size * 0.38, 0, Math.PI * 2);
  ctx.arc(x - size * 0.3, y - size * 0.1, size * 0.32, 0, Math.PI * 2);
  ctx.arc(x + size * 0.1, y + size * 0.1, size * 0.3, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

// ──────────────────────────────────────────
// ESTILINGUE
// ──────────────────────────────────────────
function drawSlingshot() {
  const GH = 32;
  const gY = canvas.height - GH;
  const ax = SLING_ORIGIN.x;
  const ay = gY;

  // Fundo do toco
  ctx.fillStyle = '#5d4037';
  ctx.beginPath();
  ctx.ellipse(ax, ay, 22, 10, 0, 0, Math.PI);
  ctx.fill();

  // Haste principal (Y shape)
  ctx.strokeStyle = '#4e342e';
  ctx.lineWidth   = 12;
  ctx.lineCap     = 'round';
  ctx.beginPath();
  ctx.moveTo(ax, ay);
  ctx.lineTo(ax, slingAnchor.y + 30);
  ctx.stroke();

  // Garfos
  ctx.lineWidth = 8;
  ctx.beginPath();
  ctx.moveTo(ax, slingAnchor.y + 30);
  ctx.lineTo(ax - 28, slingAnchor.y);
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(ax, slingAnchor.y + 30);
  ctx.lineTo(ax + 28, slingAnchor.y);
  ctx.stroke();

  // Pontas dos garfos (bulbos)
  ctx.fillStyle = '#6d4c41';
  ctx.beginPath(); ctx.arc(ax - 28, slingAnchor.y, 7, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.arc(ax + 28, slingAnchor.y, 7, 0, Math.PI * 2); ctx.fill();

  // Elástico
  if (dragPos && activeBird && !activeBird.active) {
    ctx.strokeStyle = '#ff8f00';
    ctx.lineWidth   = 4;
    ctx.lineCap     = 'round';

    // Elástico esquerdo
    ctx.beginPath();
    ctx.moveTo(ax - 28, slingAnchor.y);
    ctx.lineTo(dragPos.x, dragPos.y);
    ctx.stroke();

    // Elástico direito
    ctx.beginPath();
    ctx.moveTo(ax + 28, slingAnchor.y);
    ctx.lineTo(dragPos.x, dragPos.y);
    ctx.stroke();
  } else {
    // Elástico em repouso
    ctx.strokeStyle = '#ff8f00';
    ctx.lineWidth   = 3;
    ctx.beginPath();
    ctx.moveTo(ax - 28, slingAnchor.y);
    ctx.lineTo(ax + 28, slingAnchor.y);
    ctx.stroke();
  }
}

// ──────────────────────────────────────────
// TRAJETÓRIA PREDITIVA
// ──────────────────────────────────────────
function drawTrajectory() {
  if (!dragPos || !activeBird || activeBird.active) return;

  const dx = slingAnchor.x - dragPos.x;
  const dy = slingAnchor.y - dragPos.y;
  const speedMult = 0.28;
  let vx = dx * speedMult;
  let vy = dy * speedMult;
  if (activeBird.type === 'yellow') { vx *= 1.55; vy *= 1.3; }

  const pts = computeTrajectory(slingAnchor.x, slingAnchor.y, vx, vy, TRAJECTORY_DOTS, 1.2);

  pts.forEach((pt, i) => {
    const alpha = (1 - i / pts.length) * 0.7;
    const r     = 5 - i * 0.15;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.fillStyle   = 'white';
    ctx.beginPath();
    ctx.arc(pt.x, pt.y, Math.max(2, r), 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  });
}

// ──────────────────────────────────────────
// LOOP PRINCIPAL
// ──────────────────────────────────────────
let lastTime = 0;

function gameLoop(ts) {
  const dt = Math.min(ts - lastTime, 50);
  lastTime = ts;

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  drawBackground();
  drawSlingshot();

  const GH = 32;
  const gY = canvas.height - GH;

  // Atualizar blocos
  blocks.forEach(b => b.update(gY));
  handleBlockPigCollisions();

  // Atualizar porcos
  pigs.forEach(p => p.update(gY));

  // Atualizar pássaro ativo
  if (activeBird && activeBird.active) {
    activeBird.update(gY);
    handleBirdCollisions(activeBird);
    updateHUD();

    // Verificar se saiu da tela ou parou
    if (activeBird.dead || activeBird.x > canvas.width + 50) {
      activeBird.dead = true;
      settleTimer = 90; // aguarda acomodar objetos
    }
  }

  // Aguardar acomodação
  if (settleTimer > 0) {
    settleTimer--;
    if (settleTimer === 0) {
      prepareBird();
      updateBirdQueue();
      checkWin();
    }
  }

  // Partículas
  particles.forEach(p => { p.update(); p.draw(ctx); });
  particles = particles.filter(p => !p.dead);

  // Desenhar tudo
  blocks.forEach(b => b.draw(ctx));
  pigs.forEach(p => p.draw(ctx));

  // Pássaros em espera (fila no chão abaixo do estilingue)
  drawBirdQueue();

  if (activeBird && !activeBird.active) {
    // Posiciona no estilingue
    if (dragPos) {
      activeBird.x = dragPos.x;
      activeBird.y = dragPos.y;
    } else {
      activeBird.x = slingAnchor.x;
      activeBird.y = slingAnchor.y;
    }
    activeBird.draw(ctx);
    drawTrajectory();
  } else if (activeBird && activeBird.active) {
    activeBird.draw(ctx);
  }

  requestAnimationFrame(gameLoop);
}

function drawBirdQueue() {
  const qBirds = birds.filter(b => !b.active && !b.dead && b !== activeBird);
  const startX = 40;
  const gY     = canvas.height - 32;
  qBirds.forEach((b, i) => {
    b.x = startX + i * 28;
    b.y = gY - b.radius - 2;
    b.draw(ctx);
  });
}

// ──────────────────────────────────────────
// CONTROLES — MOUSE + TOUCH
// ──────────────────────────────────────────
function getEventPos(e) {
  const rect = canvas.getBoundingClientRect();
  const scX  = canvas.width  / rect.width;
  const scY  = canvas.height / rect.height;
  if (e.touches) {
    return {
      x: (e.touches[0].clientX - rect.left) * scX,
      y: (e.touches[0].clientY - rect.top)  * scY
    };
  }
  return {
    x: (e.clientX - rect.left) * scX,
    y: (e.clientY - rect.top)  * scY
  };
}

function onPointerDown(e) {
  if (!activeBird || activeBird.active || gameState === 'win' || gameState === 'lose') return;
  const pos = getEventPos(e);
  const d   = dist(pos, { x: slingAnchor.x, y: slingAnchor.y });
  if (d < activeBird.radius + 30) {
    gameState = 'aiming';
    dragPos   = { ...pos };
    if (!hintShown) {
      document.getElementById('aim-hint').classList.add('hidden');
      hintShown = true;
    }
  }
  e.preventDefault();
}

function onPointerMove(e) {
  if (gameState !== 'aiming' || !activeBird) return;
  const pos = getEventPos(e);
  const dx  = pos.x - slingAnchor.x;
  const dy  = pos.y - slingAnchor.y;
  const d   = Math.hypot(dx, dy);
  if (d > SLING_MAX) {
    dragPos = {
      x: slingAnchor.x + (dx / d) * SLING_MAX,
      y: slingAnchor.y + (dy / d) * SLING_MAX
    };
  } else {
    dragPos = { x: pos.x, y: pos.y };
  }
  e.preventDefault();
}

function onPointerUp(e) {
  if (gameState !== 'aiming' || !activeBird || !dragPos) return;
  const dx = slingAnchor.x - dragPos.x;
  const dy = slingAnchor.y - dragPos.y;
  const speedMult = 0.28;
  activeBird.launch(dx * speedMult, dy * speedMult);
  gameState = 'flying';
  dragPos   = null;
  settleTimer = 0;
  e.preventDefault();
}

// ──────────────────────────────────────────
// RESIZE
// ──────────────────────────────────────────
function resize() {
  const container = document.getElementById('screen-game');
  canvas.width    = container.clientWidth  || window.innerWidth;
  canvas.height   = container.clientHeight - 56; // menos o HUD
  if (canvas.height < 300) canvas.height = 300;
  slingAnchor.x   = SLING_ORIGIN.x;
  slingAnchor.y   = canvas.height - 32 - 110; // 110px acima do chão
}

// ──────────────────────────────────────────
// INICIALIZAÇÃO
// ──────────────────────────────────────────
function init() {
  canvas = document.getElementById('game-canvas');
  ctx    = canvas.getContext('2d');

  // Carregar progresso salvo
  try {
    const raw = localStorage.getItem('slingshot_progress');
    if (raw) savedProgress = JSON.parse(raw);
  } catch(e) {}

  resize();
  window.addEventListener('resize', () => {
    resize();
    if (currentLevel) initLevel(currentLevel);
  });

  // Eventos do canvas
  canvas.addEventListener('mousedown',  onPointerDown, { passive: false });
  canvas.addEventListener('mousemove',  onPointerMove, { passive: false });
  canvas.addEventListener('mouseup',    onPointerUp,   { passive: false });
  canvas.addEventListener('touchstart', onPointerDown, { passive: false });
  canvas.addEventListener('touchmove',  onPointerMove, { passive: false });
  canvas.addEventListener('touchend',   onPointerUp,   { passive: false });

  // Botões HUD
  document.getElementById('btn-back').addEventListener('click', () => {
    updateStarsDisplay();
    showScreen('intro');
  });
  document.getElementById('btn-restart').addEventListener('click', () => initLevel(currentLevel));

  // Tela inicial — seleção de fase
  document.querySelectorAll('.level-btn').forEach(btn => {
    btn.addEventListener('click', () => {
      const lvl = parseInt(btn.dataset.level);
      initLevel(lvl);
      requestAnimationFrame(gameLoop);
    });
  });

  // Tela de vitória
  document.getElementById('btn-win-replay').addEventListener('click', () => initLevel(currentLevel));

  // Tela de derrota
  document.getElementById('btn-lose-menu').addEventListener('click', () => {
    updateStarsDisplay();
    showScreen('intro');
  });
  document.getElementById('btn-lose-retry').addEventListener('click', () => initLevel(currentLevel));

  // Atualizar estrelas na tela inicial
  updateStarsDisplay();

  // Iniciar loop de renderização SEMPRE (para o menu e intro poderem animar)
  showScreen('intro');
}

// Garantir que o DOM esteja pronto
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
