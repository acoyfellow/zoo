import type { Creature, Egg, Encounter } from "../messages";
import { cracks, eggHue, hatchProgress, type Speckle, STAGE_LABELS, speckles, stageLook } from "./egg";
import {
  angleSpringStep,
  breathScale,
  clamp01,
  easeOutBack,
  easeOutCubic,
  hashUnit,
  interpolate,
  type Spring,
  springStep,
  squashFor,
  type Vec,
} from "./math";
import { drawMesh } from "./mesh";
import { Sound } from "./sound";
import { glyphArt, loadFloor, loadSprite, type SpriteArt } from "./sprites";

const WORLD = 800;

const TICK_SECONDS = 1.5;

const LIGHT = { x: 6, y: 10 };

const MESH_BUDGET_MS = 2;

interface Body {
  creature: Creature;
  from: Vec;
  to: Vec;
  position: Vec;
  heading: Spring;
  sway: Spring;
  speed: number;
  art: SpriteArt | null;
  artState: string;
  bornAt: number;
  saidAt: number;
  said: string;
  dying: number;
  hatched: boolean;
}

interface Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  hue: number;
  size: number;
  heart: boolean;
}

interface Bubble {
  id: string;
  text: string;
  at: number;
}

interface Focus {
  aId: string;
  bId: string;
  at: number;
  encounter: Encounter | null;
  outcomeAt: number;
}

interface Incubation {
  egg: Egg;
  dots: Speckle[];
  hue: number;
  hatchAt: number;
  failAt: number;
}

interface Pointer {
  x: number;
  y: number;
}

export interface FrameStats {
  samples: number;
  averageMs: number;
  p95Ms: number;
  fps: number;
  mesh: boolean;
  creatures: number;
}

export class WorldRenderer {
  readonly sound = new Sound();
  private readonly context: CanvasRenderingContext2D;
  private readonly bodies = new Map<string, Body>();
  private particles: Particle[] = [];
  private bubbles: Bubble[] = [];
  private readonly eggs = new Map<string, Incubation>();
  private floor: ImageBitmap | null = null;
  private fog: HTMLCanvasElement | null = null;
  private snapshotAt = 0;
  private lastFrame = 0;
  private worldTime = 0;
  private camera = { x: WORLD / 2, y: WORLD / 2, zoom: 1 };
  private cameraTarget = { x: WORLD / 2, y: WORLD / 2, zoom: 1 };
  private following: string | null = null;
  private focus: Focus | null = null;
  private shakeUntil = 0;
  private useMesh = true;
  private meshCost = 0;
  private frameTimes: number[] = [];
  private pointers = new Map<number, Pointer>();
  private lastTap = 0;
  private pinchStart = 0;
  private running = false;
  private readonly reducedMotion: boolean;
  private readonly dust: Vec[];

  constructor(private readonly canvas: HTMLCanvasElement) {
    const context = canvas.getContext("2d");

    if (!context) throw new Error("canvas 2d unavailable");
    this.context = context;
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)").matches;
    this.dust = Array.from({ length: this.reducedMotion ? 12 : 40 }, (_, i) => ({
      x: hashUnit(`d${i}`, 3) * WORLD,
      y: hashUnit(`d${i}`, 4) * WORLD,
    }));
    this.fog = this.makeFog();
    this.bindInput();
    void loadFloor().then((floor) => {
      this.floor = floor;
    });
  }

  start(): void {
    this.running = true;
    requestAnimationFrame((time) => this.frame(time));
  }

  stop(): void {
    this.running = false;
  }

  stats(): FrameStats {
    const sorted = [...this.frameTimes].sort((a, b) => a - b);
    const average = sorted.reduce((sum, value) => sum + value, 0) / Math.max(1, sorted.length);

    return {
      samples: sorted.length,
      averageMs: Number(average.toFixed(2)),
      p95Ms: Number((sorted[Math.floor(sorted.length * 0.95)] ?? 0).toFixed(2)),
      fps: Number((1000 / Math.max(average, 1000 / 240)).toFixed(1)),
      mesh: this.useMesh,
      creatures: this.bodies.size,
    };
  }

  update(creatures: Creature[]): void {
    const now = performance.now();
    this.snapshotAt = now;
    const seen = new Set<string>();

    for (const creature of creatures) {
      seen.add(creature.id);
      const body = this.bodies.get(creature.id);

      if (body) {
        body.from = { ...body.position };
        body.to = { x: creature.x, y: creature.y };

        if (creature.said && creature.said !== body.said) this.speak(body, creature.said, now);
        body.creature = creature;
        this.refreshArt(body);
      } else {
        this.bodies.set(creature.id, this.spawnBody(creature, now));
      }
    }

    for (const [id, body] of this.bodies) {
      if (!seen.has(id) && body.dying === 0 && !id.startsWith("bench-")) body.dying = now;
    }
  }

  bench(count: number): void {
    const sources = [...this.bodies.values()].filter((body) => body.art !== null);
    const now = performance.now();

    for (let i = 0; i < count; i++) {
      const source = sources[i % Math.max(1, sources.length)];

      if (!source) return;
      const angle = (i / count) * Math.PI * 2 + now / 3000;
      const ring = 120 + (i % 5) * 50;
      const position = { x: 400 + Math.cos(angle) * ring, y: 400 + Math.sin(angle) * ring };
      const id = `bench-${i}`;
      const existing = this.bodies.get(id);
      const creature = { ...source.creature, id, x: position.x, y: position.y };

      if (existing) {
        existing.from = { ...existing.position };
        existing.to = position;
        continue;
      }

      const body = this.spawnBody(creature, now);
      body.art = source.art;
      body.artState = "bench";
      this.bodies.set(id, body);
    }

    this.snapshotAt = now;
  }

  setSprite(id: string, sprite: Creature["sprite"]): void {
    const body = this.bodies.get(id);

    if (!body) return;
    body.creature = { ...body.creature, sprite };
    this.refreshArt(body);
  }

  setEgg(egg: Egg): void {
    const now = performance.now();
    const existing = this.eggs.get(egg.id);

    const incubation: Incubation = existing ?? {
      egg,
      dots: speckles(egg.seed, 14),
      hue: eggHue(egg.seed),
      hatchAt: 0,
      failAt: 0,
    };

    if (existing && existing.egg.seed !== egg.seed && egg.seed) {
      incubation.dots = speckles(egg.seed, 14);
      incubation.hue = eggHue(egg.seed);
    }

    incubation.egg = existing ? { ...egg, x: existing.egg.x, y: existing.egg.y } : egg;

    if (egg.stage === "ready" && incubation.hatchAt === 0) this.hatchEgg(incubation, now);

    if (egg.stage === "failed" && incubation.failAt === 0) incubation.failAt = now;
    this.eggs.set(egg.id, incubation);
  }

  syncEggs(eggs: Egg[]): void {
    for (const egg of eggs) this.setEgg(egg);
  }

  dropEgg(id: string): void {
    this.eggs.delete(id);
  }

  private hatchEgg(incubation: Incubation, now: number): void {
    incubation.hatchAt = now;
    const count = this.reducedMotion ? 10 : 40;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const speed = 40 + hashUnit(`${incubation.egg.id}${i}`, 31) * 90;
      this.emit({
        x: incubation.egg.x,
        y: incubation.egg.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.1,
        max: 1.1,
        hue: incubation.hue,
        size: 3,
        heart: false,
      });
    }

    const body = incubation.egg.creatureId ? this.bodies.get(incubation.egg.creatureId) : undefined;

    if (body) {
      body.bornAt = now + 250;
      body.hatched = true;
      body.position = { x: incubation.egg.x, y: incubation.egg.y };
    }

    this.sound.hatch();
  }

  meeting(aId: string, bId: string): void {
    this.focus = { aId, bId, at: performance.now(), encounter: null, outcomeAt: 0 };
  }

  encounter(encounter: Encounter): void {
    const now = performance.now();

    const focus =
      this.focus && this.focus.aId === encounter.aId ? this.focus : { aId: encounter.aId, bId: encounter.bId, at: now };

    this.focus = { ...focus, encounter, outcomeAt: now };
    const a = this.bodies.get(encounter.aId);
    const b = this.bodies.get(encounter.bId);

    if (encounter.outcome === "befriend") {
      this.sound.befriend();

      for (const body of [a, b]) if (body) this.hearts(body);

      return;
    }

    const loser = encounter.outcome === "a_wins" ? b : a;
    this.sound.win();

    if (!this.reducedMotion) this.shakeUntil = now + 120;

    if (loser) this.dissolve(loser, now);
  }

  private spawnBody(creature: Creature, now: number): Body {
    const position = { x: creature.x, y: creature.y };

    const body: Body = {
      creature,
      from: position,
      to: position,
      position: { ...position },
      heading: { value: hashUnit(creature.id, 5) * Math.PI * 2, velocity: 0 },
      sway: { value: 0, velocity: 0 },
      speed: 0,
      art: null,
      artState: "",
      bornAt: now,
      saidAt: 0,
      said: creature.said,
      dying: 0,
      hatched: false,
    };

    this.refreshArt(body);

    if (this.snapshotAt > 0 && now - this.snapshotAt < 50 && this.lastFrame > 0) this.sound.hatch();

    return body;
  }

  private refreshArt(body: Body): void {
    const state = body.creature.sprite;

    if (body.artState === state) return;
    body.artState = state;
    const id = body.creature.id;
    const hue = body.creature.hue;
    const name = body.creature.name;
    const fallback = () => glyphArt(name, hue);
    const load = state === "glyph" ? fallback() : loadSprite(id).then((art) => art ?? fallback());
    void load.then((art) => {
      if (art && (!body.art || body.art.glyph)) body.art = art;
    });
  }

  private speak(body: Body, text: string, now: number): void {
    body.said = text;
    body.saidAt = now;
    this.bubbles = [
      ...this.bubbles.filter((bubble) => bubble.id !== body.creature.id),
      { id: body.creature.id, text, at: now },
    ];
  }

  private hueOf(body: Body): number {
    return body.art?.hue ?? body.creature.hue;
  }

  private emit(particle: Particle): void {
    const cap = this.reducedMotion ? 150 : 600;

    if (this.particles.length < cap) this.particles.push(particle);
  }

  private dissolve(body: Body, now: number): void {
    body.dying = now;
    const count = this.reducedMotion ? 12 : 48;

    for (let i = 0; i < count; i++) {
      const angle = (i / count) * Math.PI * 2;
      const speed = 20 + hashUnit(`${body.creature.id}${i}`, 7) * 60;
      this.emit({
        x: body.position.x,
        y: body.position.y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: 1.2,
        max: 1.2,
        hue: this.hueOf(body),
        size: 3,
        heart: false,
      });
    }
  }

  private hearts(body: Body): void {
    const count = this.reducedMotion ? 2 : 6;

    for (let i = 0; i < count; i++) {
      this.emit({
        x: body.position.x + (hashUnit(`${body.creature.id}h${i}`, 8) - 0.5) * 20,
        y: body.position.y - 10,
        vx: (hashUnit(`${body.creature.id}h${i}`, 9) - 0.5) * 20,
        vy: -30 - i * 4,
        life: 1.8,
        max: 1.8,
        hue: 330,
        size: 6,
        heart: true,
      });
    }
  }

  private makeFog(): HTMLCanvasElement | null {
    const size = 128;
    const fog = document.createElement("canvas");
    fog.width = size;
    fog.height = size;
    const context = fog.getContext("2d");

    if (!context) return null;
    const image = context.createImageData(size, size);

    for (let y = 0; y < size; y++) {
      for (let x = 0; x < size; x++) {
        const value =
          Math.sin(x * 0.11 + Math.sin(y * 0.07) * 2) * 0.5 +
          Math.sin(y * 0.09 + Math.cos(x * 0.05) * 3) * 0.5 +
          Math.sin((x + y) * 0.031) * 0.6;

        const offset = (y * size + x) * 4;
        image.data[offset] = 90;
        image.data[offset + 1] = 140;
        image.data[offset + 2] = 170;
        image.data[offset + 3] = Math.max(0, Math.min(255, (value + 0.4) * 38));
      }
    }

    context.putImageData(image, 0, 0);

    return fog;
  }

  private timeScale(now: number): number {
    if (this.reducedMotion || !this.focus) return 1;
    const since = now - this.focus.at;

    return since < 600 ? 0.4 : 1;
  }

  private frame(time: number): void {
    if (!this.running) return;
    const started = performance.now();
    const realDt = this.lastFrame === 0 ? 1 / 60 : Math.min(0.1, (time - this.lastFrame) / 1000);
    this.lastFrame = time;
    const dt = realDt * this.timeScale(time);
    this.worldTime += dt;
    this.resize();
    this.step(time, dt, realDt);
    this.draw(time);
    const spent = performance.now() - started;
    this.frameTimes = [...this.frameTimes.slice(-299), spent];
    this.canvas.dataset.frameMs = String(this.stats().averageMs);
    requestAnimationFrame((next) => this.frame(next));
  }

  private resize(): void {
    const ratio = Math.min(2, devicePixelRatio || 1);
    const width = Math.round(this.canvas.clientWidth * ratio);
    const height = Math.round(this.canvas.clientHeight * ratio);

    if (this.canvas.width !== width || this.canvas.height !== height) {
      this.canvas.width = width;
      this.canvas.height = height;
    }
  }

  private step(now: number, dt: number, realDt: number): void {
    const alpha = clamp01((now - this.snapshotAt) / (TICK_SECONDS * 1000));

    for (const [id, body] of this.bodies) {
      if (body.dying > 0 && now - body.dying > 1200) {
        this.bodies.delete(id);
        continue;
      }

      const previous = body.position;
      body.position = interpolate(body.from, body.to, alpha);
      const vx = (body.position.x - previous.x) / Math.max(dt, 1e-4);
      const vy = (body.position.y - previous.y) / Math.max(dt, 1e-4);
      const speed = Math.hypot(vx, vy);
      body.speed = springStep({ value: body.speed, velocity: 0 }, speed, 10, dt).value;

      if (speed > 2) body.heading = angleSpringStep(body.heading, Math.atan2(vy, vx) + Math.PI / 2, 6, dt);
      else body.heading = angleSpringStep(body.heading, body.heading.value, 6, dt);
      body.sway = springStep(body.sway, -Math.min(speed, 40) * 0.25, 5, dt);

      if (speed > 6 && !this.reducedMotion && Math.random() < dt * 30) {
        this.emit({
          x: body.position.x,
          y: body.position.y,
          vx: -vx * 0.05,
          vy: -vy * 0.05,
          life: 0.8,
          max: 0.8,
          hue: this.hueOf(body),
          size: 2,
          heart: false,
        });
      }
    }

    this.particles = this.particles.flatMap((particle) => {
      const life = particle.life - dt;

      if (life <= 0) return [];

      return [
        {
          ...particle,
          life,
          x: particle.x + particle.vx * dt,
          y: particle.y + particle.vy * dt,
          vx: particle.vx * 0.97,
          vy: particle.vy * 0.97,
        },
      ];
    });
    this.bubbles = this.bubbles.filter((bubble) => now - bubble.at < 4000);

    for (const [id, incubation] of this.eggs) {
      const ended = incubation.hatchAt || incubation.failAt;

      if (ended > 0 && now - ended > (incubation.failAt ? 6000 : 1500)) this.eggs.delete(id);
    }

    this.stepCamera(now, realDt);
  }

  private stepCamera(now: number, dt: number): void {
    const focusBodies = this.focusBodies();
    const followed = this.following ? this.bodies.get(this.following) : undefined;

    if (focusBodies && now - (this.focus?.at ?? 0) < 2600) {
      const [a, b] = focusBodies;
      this.cameraTarget.x = (a.position.x + b.position.x) / 2;
      this.cameraTarget.y = (a.position.y + b.position.y) / 2;
      this.cameraTarget.zoom = Math.max(this.cameraTarget.zoom, 1.25);
    } else if (followed) {
      this.cameraTarget.x = followed.position.x;
      this.cameraTarget.y = followed.position.y;
    }

    const ease = 1 - Math.exp(-dt * 4);
    this.camera.x += (this.cameraTarget.x - this.camera.x) * ease;
    this.camera.y += (this.cameraTarget.y - this.camera.y) * ease;
    this.camera.zoom += (this.cameraTarget.zoom - this.camera.zoom) * ease;

    if (this.focus && now - this.focus.at > 2600 && this.cameraTarget.zoom > 1)
      this.cameraTarget.zoom = Math.max(1, this.cameraTarget.zoom - dt);
  }

  private focusBodies(): [Body, Body] | null {
    if (!this.focus) return null;
    const a = this.bodies.get(this.focus.aId);
    const b = this.bodies.get(this.focus.bId);

    return a && b ? [a, b] : null;
  }

  private scale(): number {
    return (Math.min(this.canvas.width, this.canvas.height) / WORLD) * this.camera.zoom;
  }

  private applyCamera(context: CanvasRenderingContext2D, now: number, depth: number): void {
    const scale = this.scale();
    const shake = now < this.shakeUntil ? 3 : 0;
    const shakeX = shake ? (Math.random() - 0.5) * shake * 2 : 0;
    const shakeY = shake ? (Math.random() - 0.5) * shake * 2 : 0;
    context.setTransform(scale, 0, 0, scale, this.canvas.width / 2 + shakeX, this.canvas.height / 2 + shakeY);
    context.translate(
      -this.camera.x * depth - (WORLD / 2) * (1 - depth),
      -this.camera.y * depth - (WORLD / 2) * (1 - depth),
    );
  }

  private draw(now: number): void {
    const context = this.context;
    context.setTransform(1, 0, 0, 1, 0, 0);
    context.globalCompositeOperation = "source-over";
    context.globalAlpha = 1;
    context.fillStyle = "#03060a";
    context.fillRect(0, 0, this.canvas.width, this.canvas.height);
    this.applyCamera(context, now, 1);

    if (this.floor) context.drawImage(this.floor, -40, -40, WORLD + 80, WORLD + 80);
    this.drawShadows(context);
    this.drawParticles(context, false);
    this.drawCreatures(context, now);
    this.drawBloom(context, now);
    this.drawParticles(context, true);
    this.drawEggs(context, now);
    this.drawEncounterRing(context, now);
    this.drawBubbles(context, now);
    this.applyCamera(context, now, 0.6);
    this.drawFog(context);
    this.drawDust(context);
    this.drawLight(context);
    this.drawBars(context, now);
  }

  private drawShadows(context: CanvasRenderingContext2D): void {
    context.fillStyle = "rgba(0, 0, 0, 0.45)";

    for (const body of this.bodies.values()) {
      const size = this.sizeOf(body);
      context.beginPath();
      context.ellipse(
        body.position.x + LIGHT.x,
        body.position.y + LIGHT.y,
        size * 0.32,
        size * 0.16,
        0,
        0,
        Math.PI * 2,
      );
      context.fill();
    }
  }

  private sizeOf(body: Body): number {
    return 72 + Math.min(body.creature.energy, 20);
  }

  private isIncubating(id: string): boolean {
    for (const incubation of this.eggs.values())
      if (incubation.egg.creatureId === id && incubation.hatchAt === 0) return true;

    return false;
  }

  private bodyScale(body: Body, now: number): number {
    if (this.isIncubating(body.creature.id)) return 0;
    const born = clamp01((now - body.bornAt) / 700);
    const appear = body.creature.generation > 0 || body.hatched ? easeOutBack(born) : easeOutCubic(born);
    const fade = body.dying > 0 ? 1 - clamp01((now - body.dying) / 600) : 1;

    return appear * fade;
  }

  private drawBody(context: CanvasRenderingContext2D, body: Body, now: number, allowMesh: boolean): void {
    const art = body.art;

    if (!art) return;
    const size = this.sizeOf(body) * this.bodyScale(body, now);

    if (size <= 0.5) return;
    const squash = squashFor(body.speed, 0.3);
    const breath = breathScale(body.creature.id, now / 1000);
    context.save();
    context.translate(body.position.x, body.position.y);
    context.rotate(body.heading.value);
    context.scale(squash.across * breath, squash.along * breath);

    if (allowMesh && this.useMesh && !art.glyph) {
      context.translate(-size / 2, -size / 2);
      context.scale(size / art.bitmap.width, size / art.bitmap.height);
      context.translate(art.bitmap.width / 2, art.bitmap.height / 2);
      drawMesh(context, art.bitmap, art.bitmap.width, (body.sway.value / size) * art.bitmap.width);
    } else {
      context.drawImage(art.bitmap, -size / 2, -size / 2, size, size);
    }

    context.restore();
  }

  private drawCreatures(context: CanvasRenderingContext2D, now: number): void {
    const started = performance.now();

    for (const body of this.bodies.values()) {
      context.globalAlpha = body.dying > 0 ? 1 - clamp01((now - body.dying) / 600) : 1;
      this.drawBody(context, body, now, true);
    }

    context.globalAlpha = 1;
    const cost = performance.now() - started;
    this.meshCost = this.meshCost * 0.9 + cost * 0.1;

    if (this.useMesh && this.meshCost > MESH_BUDGET_MS && this.frameTimes.length > 60) this.useMesh = false;
  }

  private drawBloom(context: CanvasRenderingContext2D, now: number): void {
    context.globalCompositeOperation = "lighter";

    for (const body of this.bodies.values()) {
      const speaking = now - body.saidAt < 1500 ? 0.25 : 0;
      context.globalAlpha = 0.18 + speaking;
      this.drawBody(context, body, now, false);
    }

    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
  }

  private drawParticles(context: CanvasRenderingContext2D, additive: boolean): void {
    context.globalCompositeOperation = additive ? "lighter" : "source-over";

    for (const particle of this.particles) {
      if (particle.heart !== additive && !additive) continue;
      const fade = particle.life / particle.max;
      context.globalAlpha = fade * (additive ? 0.9 : 0.5);
      context.fillStyle = `hsl(${particle.hue}, 100%, ${particle.heart ? 75 : 65}%)`;

      if (particle.heart) this.heart(context, particle.x, particle.y, particle.size);
      else
        context.fillRect(particle.x - particle.size / 2, particle.y - particle.size / 2, particle.size, particle.size);
    }

    context.globalAlpha = 1;
    context.globalCompositeOperation = "source-over";
  }

  private heart(context: CanvasRenderingContext2D, x: number, y: number, size: number): void {
    context.beginPath();
    context.moveTo(x, y + size * 0.4);
    context.bezierCurveTo(x - size, y - size * 0.3, x - size * 0.4, y - size, x, y - size * 0.4);
    context.bezierCurveTo(x + size * 0.4, y - size, x + size, y - size * 0.3, x, y + size * 0.4);
    context.fill();
  }

  private eggShellPath(context: CanvasRenderingContext2D, width: number, height: number): void {
    context.beginPath();
    context.ellipse(0, 0, width, height, 0, 0, Math.PI * 2);
  }

  private drawEggs(context: CanvasRenderingContext2D, now: number): void {
    for (const incubation of this.eggs.values()) this.drawEgg(context, incubation, now);
  }

  private drawEgg(context: CanvasRenderingContext2D, incubation: Incubation, now: number): void {
    const { egg, hue } = incubation;
    const look = stageLook(egg.stage);
    const seconds = now / 1000;
    const failed = incubation.failAt > 0;
    const width = 22;
    const height = 29;
    const breath = failed ? 0.15 : 0.55 + Math.sin(seconds * 2.2) * 0.25;
    const wobble = this.reducedMotion ? 0 : Math.sin(seconds * look.wobbleRate * Math.PI) * look.wobbleAngle;
    const hatch = incubation.hatchAt > 0 ? hatchProgress(now - incubation.hatchAt) : null;

    context.save();
    context.translate(egg.x, egg.y + height);
    context.rotate(wobble);
    context.translate(0, -height);

    if (!failed) {
      context.globalCompositeOperation = "lighter";
      const halo = context.createRadialGradient(0, 0, 4, 0, 0, height * 2.2);
      halo.addColorStop(0, `hsla(${hue}, 100%, 65%, ${0.35 * breath})`);
      halo.addColorStop(1, `hsla(${hue}, 100%, 50%, 0)`);
      context.fillStyle = halo;
      context.fillRect(-height * 2.2, -height * 2.2, height * 4.4, height * 4.4);
      context.globalCompositeOperation = "source-over";
    }

    const halves = hatch ? [-1, 1] : [0];

    for (const side of halves) {
      context.save();

      if (hatch) {
        const fly = hatch.split * 34;
        context.translate(side * fly, -hatch.split * 12 + hatch.split * hatch.split * 30);
        context.rotate(side * hatch.split * 1.4);
        context.globalAlpha = 1 - hatch.split;
        context.beginPath();
        context.rect(side < 0 ? -width - 2 : 0, -height - 2, width + 2, height * 2 + 4);
        context.clip();
      }

      this.drawShell(context, incubation, width, height, breath, failed);
      context.restore();
    }

    context.restore();

    if (!hatch) this.drawEggLabel(context, egg.x, egg.y + height * 2 + 10, STAGE_LABELS[egg.stage], failed);
  }

  private drawShell(
    context: CanvasRenderingContext2D,
    incubation: Incubation,
    width: number,
    height: number,
    breath: number,
    failed: boolean,
  ): void {
    const { hue, egg } = incubation;
    const look = stageLook(egg.stage);
    const lightness = failed ? 14 : 78;
    const shell = context.createRadialGradient(-width * 0.35, -height * 0.4, 2, 0, 0, height * 1.1);
    shell.addColorStop(0, `hsl(${hue}, ${failed ? 5 : 40}%, ${lightness + 10}%)`);
    shell.addColorStop(1, `hsl(${hue}, ${failed ? 5 : 35}%, ${lightness - 30}%)`);
    this.eggShellPath(context, width, height);
    context.fillStyle = shell;
    context.fill();

    if (!failed) {
      context.save();
      this.eggShellPath(context, width, height);
      context.clip();
      context.globalCompositeOperation = "lighter";
      const core = context.createRadialGradient(0, height * 0.15, 1, 0, height * 0.15, height * 0.9);
      core.addColorStop(0, `hsla(${hue}, 100%, 70%, ${0.55 * breath})`);
      core.addColorStop(1, `hsla(${hue}, 100%, 50%, 0)`);
      context.fillStyle = core;
      context.fillRect(-width, -height, width * 2, height * 2);
      context.restore();
    }

    context.fillStyle = `hsla(${(hue + 180) % 360}, 30%, ${failed ? 8 : 35}%, 0.75)`;

    for (const dot of incubation.dots) {
      context.beginPath();
      context.ellipse(
        Math.cos(dot.angle) * dot.radius * width,
        Math.sin(dot.angle) * dot.radius * height,
        dot.size * width,
        dot.size * width * 0.8,
        dot.angle,
        0,
        Math.PI * 2,
      );
      context.fill();
    }

    if (look.crackCount > 0) {
      const glow = look.crackGlow * (0.7 + breath * 0.5);
      context.lineWidth = 0.9;
      context.strokeStyle = failed
        ? "rgba(0, 0, 0, 0.9)"
        : `hsla(${hue}, 100%, ${60 + glow * 30}%, ${0.4 + glow * 0.6})`;
      context.shadowColor = failed ? "transparent" : `hsl(${hue}, 100%, 70%)`;
      context.shadowBlur = failed ? 0 : glow * 8;

      for (const crack of cracks(egg.seed || egg.id, look.crackCount)) {
        context.beginPath();

        for (const [index, point] of crack.points.entries()) {
          const x = point.x * width;
          const y = point.y * height;

          if (index === 0) context.moveTo(x, y);
          else context.lineTo(x, y);
        }

        context.stroke();
      }

      context.shadowBlur = 0;
    }

    context.strokeStyle = failed ? "rgba(60, 60, 60, 0.8)" : `hsla(${hue}, 60%, 85%, 0.6)`;
    context.lineWidth = 0.8;
    this.eggShellPath(context, width, height);
    context.stroke();
  }

  private drawEggLabel(context: CanvasRenderingContext2D, x: number, y: number, text: string, failed: boolean): void {
    context.font = "bold 10px ui-monospace, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";
    const width = context.measureText(text).width + 12;
    context.fillStyle = "rgba(4, 14, 18, 0.85)";
    context.fillRect(x - width / 2, y - 8, width, 16);
    context.fillStyle = failed ? "#fca5a5" : "#e6fff6";
    context.fillText(text, x, y);
  }

  private drawEncounterRing(context: CanvasRenderingContext2D, now: number): void {
    const pair = this.focusBodies();

    if (!pair || !this.focus) return;
    const since = now - this.focus.at;

    if (since > 4000) return;
    const [a, b] = pair;
    const cx = (a.position.x + b.position.x) / 2;
    const cy = (a.position.y + b.position.y) / 2;
    const radius = 20 + Math.hypot(a.position.x - b.position.x, a.position.y - b.position.y) / 2;
    const fade = since < 3000 ? 1 : 1 - (since - 3000) / 1000;
    context.globalCompositeOperation = "lighter";
    context.strokeStyle = `rgba(180, 255, 230, ${0.7 * fade})`;
    context.lineWidth = 2 + Math.sin(now / 120) * 0.8;
    context.beginPath();
    context.arc(cx, cy, radius * easeOutCubic(since / 500), 0, Math.PI * 2);
    context.stroke();

    if (this.focus.encounter?.outcome === "befriend" && this.focus.outcomeAt > 0) {
      const orbit = clamp01((now - this.focus.outcomeAt) / 1600) * Math.PI * 2;

      for (const [index, body] of [a, b].entries()) {
        const angle = orbit + index * Math.PI;
        body.position = { x: cx + Math.cos(angle) * radius * 0.6, y: cy + Math.sin(angle) * radius * 0.6 };
      }
    }

    context.globalCompositeOperation = "source-over";
  }

  private drawBubbles(context: CanvasRenderingContext2D, now: number): void {
    context.font = "bold 9px ui-monospace, monospace";
    context.textAlign = "center";
    context.textBaseline = "middle";

    for (const bubble of this.bubbles) {
      const body = this.bodies.get(bubble.id);

      if (!body) continue;
      const age = now - bubble.at;
      const pop = easeOutBack(age / 250);
      const fade = age > 3000 ? 1 - (age - 3000) / 1000 : 1;
      const text = bubble.text.slice(0, 32);
      const width = context.measureText(text).width + 10;
      const x = body.position.x;
      const y = body.position.y - this.sizeOf(body) * 0.7;
      context.save();
      context.globalAlpha = Math.max(0, fade);
      context.translate(x, y);
      context.scale(pop, pop);
      context.fillStyle = "rgba(4, 14, 18, 0.88)";
      context.strokeStyle = `hsl(${this.hueOf(body)}, 90%, 70%)`;
      context.lineWidth = 1;
      context.fillRect(-width / 2, -8, width, 16);
      context.strokeRect(-width / 2, -8, width, 16);
      context.fillStyle = "#e6fff6";
      context.fillText(text, 0, 0);
      context.restore();
    }
  }

  private drawFog(context: CanvasRenderingContext2D): void {
    if (!this.fog) return;
    const drift = this.worldTime * 6;
    context.globalAlpha = 0.35;
    context.imageSmoothingEnabled = true;

    for (const offset of [0, WORLD * 1.5])
      context.drawImage(
        this.fog,
        -WORLD * 0.5 + ((drift + offset) % (WORLD * 3)) - WORLD,
        -WORLD * 0.5,
        WORLD * 1.5,
        WORLD * 2,
      );
    context.globalAlpha = 1;
  }

  private drawDust(context: CanvasRenderingContext2D): void {
    context.globalCompositeOperation = "lighter";
    context.fillStyle = "rgba(200, 255, 240, 0.5)";

    for (const [index, mote] of this.dust.entries()) {
      const x = (mote.x + this.worldTime * (4 + (index % 5))) % WORLD;
      const y = (mote.y + Math.sin(this.worldTime * 0.5 + index) * 10 + WORLD) % WORLD;
      context.fillRect(x, y, 1.5, 1.5);
    }

    context.globalCompositeOperation = "source-over";
  }

  private drawLight(context: CanvasRenderingContext2D): void {
    context.setTransform(1, 0, 0, 1, 0, 0);
    const width = this.canvas.width;
    const height = this.canvas.height;

    const vignette = context.createRadialGradient(
      width / 2,
      height / 2,
      Math.min(width, height) * 0.25,
      width / 2,
      height / 2,
      Math.max(width, height) * 0.75,
    );

    vignette.addColorStop(0, "rgba(0, 0, 0, 0)");
    vignette.addColorStop(1, "rgba(0, 0, 0, 0.8)");
    context.fillStyle = vignette;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = "lighter";

    const light = context.createRadialGradient(
      width / 2,
      height / 2,
      0,
      width / 2,
      height / 2,
      Math.min(width, height) * 0.45,
    );

    light.addColorStop(0, "rgba(90, 200, 190, 0.10)");
    light.addColorStop(1, "rgba(90, 200, 190, 0)");
    context.fillStyle = light;
    context.fillRect(0, 0, width, height);
    context.globalCompositeOperation = "source-over";
  }

  private drawBars(context: CanvasRenderingContext2D, now: number): void {
    const encounter = this.focus?.encounter;

    if (!encounter || !this.focus) return;
    const since = now - this.focus.outcomeAt;

    if (since > 5000) return;
    const ratio = this.canvas.width / 400;
    const fade = since > 4200 ? 1 - (since - 4200) / 800 : 1;

    const rows: [string, number, number][] = [
      [`${encounter.a} wins`, encounter.probabilities.a_wins, 160],
      [`${encounter.b} wins`, encounter.probabilities.b_wins, 20],
      ["friends", encounter.probabilities.befriend, 320],
    ];

    const width = 150 * ratio;
    const x = this.canvas.width - width - 12 * ratio;
    context.globalAlpha = Math.max(0, fade);
    context.fillStyle = "rgba(2, 10, 12, 0.8)";
    context.fillRect(x - 8 * ratio, 8 * ratio, width + 16 * ratio, 66 * ratio);
    context.font = `${8 * ratio}px ui-monospace, monospace`;
    context.textAlign = "left";
    context.textBaseline = "alphabetic";

    for (const [index, [label, value, hue]] of rows.entries()) {
      const y = 22 * ratio + index * 20 * ratio;
      const fill = easeOutCubic((since - index * 120) / 700) * value;
      context.fillStyle = "#cfeee4";
      context.fillText(`${label.slice(0, 16)} ${Math.round(value * 100)}%`, x, y);
      context.fillStyle = "rgba(255, 255, 255, 0.1)";
      context.fillRect(x, y + 3 * ratio, width, 5 * ratio);
      context.fillStyle = `hsl(${hue}, 90%, 60%)`;
      context.fillRect(x, y + 3 * ratio, width * Math.max(0, fill), 5 * ratio);
    }

    context.globalAlpha = 1;
  }

  private toWorld(clientX: number, clientY: number): Vec {
    const rect = this.canvas.getBoundingClientRect();
    const ratio = this.canvas.width / Math.max(1, rect.width);
    const scale = this.scale();

    return {
      x: ((clientX - rect.left) * ratio - this.canvas.width / 2) / scale + this.camera.x,
      y: ((clientY - rect.top) * ratio - this.canvas.height / 2) / scale + this.camera.y,
    };
  }

  private pinchDistance(): number {
    const [a, b] = [...this.pointers.values()];

    return a && b ? Math.hypot(a.x - b.x, a.y - b.y) : 0;
  }

  private zoomBy(factor: number): void {
    this.cameraTarget.zoom = Math.min(3, Math.max(0.8, this.cameraTarget.zoom * factor));
  }

  private nearestBody(point: Vec): Body | null {
    let best: Body | null = null;
    let distance = 50;

    for (const body of this.bodies.values()) {
      const d = Math.hypot(body.position.x - point.x, body.position.y - point.y);

      if (d < distance) {
        distance = d;
        best = body;
      }
    }

    return best;
  }

  private bindInput(): void {
    const canvas = this.canvas;
    canvas.style.touchAction = "none";
    canvas.addEventListener("pointerdown", (event) => {
      canvas.setPointerCapture(event.pointerId);
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });
      this.pinchStart = this.pinchDistance();
      const now = performance.now();

      if (now - this.lastTap < 300) {
        this.following = this.nearestBody(this.toWorld(event.clientX, event.clientY))?.creature.id ?? null;
      }

      this.lastTap = now;
    });
    canvas.addEventListener("pointermove", (event) => {
      const previous = this.pointers.get(event.pointerId);

      if (!previous) return;
      this.pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

      if (this.pointers.size >= 2) {
        const distance = this.pinchDistance();

        if (this.pinchStart > 0) this.zoomBy(distance / this.pinchStart);
        this.pinchStart = distance;

        return;
      }

      const rect = canvas.getBoundingClientRect();
      const perPixel = canvas.width / Math.max(1, rect.width) / this.scale();
      this.following = null;
      this.cameraTarget.x = Math.min(WORLD, Math.max(0, this.cameraTarget.x - (event.clientX - previous.x) * perPixel));
      this.cameraTarget.y = Math.min(WORLD, Math.max(0, this.cameraTarget.y - (event.clientY - previous.y) * perPixel));
      this.camera.x = this.cameraTarget.x;
      this.camera.y = this.cameraTarget.y;
    });

    const release = (event: PointerEvent) => {
      this.pointers.delete(event.pointerId);
      this.pinchStart = this.pinchDistance();
    };

    canvas.addEventListener("pointerup", release);
    canvas.addEventListener("pointercancel", release);
    canvas.addEventListener(
      "wheel",
      (event) => {
        event.preventDefault();
        this.zoomBy(event.deltaY < 0 ? 1.1 : 1 / 1.1);
      },
      { passive: false },
    );
  }
}
