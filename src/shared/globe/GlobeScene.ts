import * as THREE from 'three';
import { latLngToVec3, greatCircleDistance, type LatLng } from './latLng';
import { loadLandDots } from './landDots';

export type GlobeRisk = 'safe' | 'tracker' | 'suspicious' | 'dangerous';

export interface GlobeArcInput {
  from: LatLng;
  to: LatLng;
  risk: GlobeRisk;
  label?: string;
}

export interface GlobeOptions {
  landUrl: string;
  radius?: number;
  autoRotateSpeed?: number;
  background?: boolean;
  initialCamera?: number;
}

const RISK_COLOR: Record<GlobeRisk, number> = {
  safe: 0x22c55e,
  tracker: 0x38bdf8,
  suspicious: 0xfacc15,
  dangerous: 0xef4444,
};

const ARC_SEGMENTS = 64;
const ARC_LIFETIME = 4200;

interface LiveArc {
  group: THREE.Group;
  line: THREE.Line;
  head: THREE.Mesh;
  ring: THREE.Mesh;
  curve: THREE.QuadraticBezierCurve3;
  color: THREE.Color;
  bornAt: number;
}

export class GlobeScene {
  private container: HTMLElement;
  private options: Required<Omit<GlobeOptions, 'landUrl'>> & { landUrl: string };
  private renderer!: THREE.WebGLRenderer;
  private scene!: THREE.Scene;
  private camera!: THREE.PerspectiveCamera;
  private globeGroup!: THREE.Group;
  private arcsGroup!: THREE.Group;
  private atmosphere!: THREE.Mesh;
  private stars!: THREE.Points;
  private land: THREE.Points | null = null;
  private liveArcs: LiveArc[] = [];
  private pointers: Map<string, THREE.Mesh> = new Map();
  private running = false;
  private rafId = 0;
  private lastFrame = 0;
  private resizeObserver: ResizeObserver | null = null;
  private dragging = false;
  private lastPointer = { x: 0, y: 0 };
  private targetRotY = 0;
  private targetRotX = 0.1;
  private onPointerDown = (e: PointerEvent) => this.handlePointerDown(e);
  private onPointerMove = (e: PointerEvent) => this.handlePointerMove(e);
  private onPointerUp = () => this.handlePointerUp();

  constructor(container: HTMLElement, options: GlobeOptions) {
    this.container = container;
    this.options = {
      radius: options.radius ?? 1,
      autoRotateSpeed: options.autoRotateSpeed ?? 0.04,
      background: options.background ?? true,
      initialCamera: options.initialCamera ?? 2.8,
      landUrl: options.landUrl,
    };
    this.init();
  }

  private init(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    this.renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.renderer.setSize(Math.max(w, 1), Math.max(h, 1));
    this.renderer.setClearColor(0x000000, 0);
    this.container.appendChild(this.renderer.domElement);
    this.renderer.domElement.style.display = 'block';
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.renderer.domElement.style.touchAction = 'none';

    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(
      45,
      Math.max(w, 1) / Math.max(h, 1),
      0.1,
      100,
    );
    this.camera.position.set(0, 0, this.options.initialCamera);

    this.scene.add(new THREE.AmbientLight(0x668899, 0.6));
    const dir = new THREE.DirectionalLight(0xffffff, 0.8);
    dir.position.set(4, 3, 5);
    this.scene.add(dir);

    this.globeGroup = new THREE.Group();
    this.scene.add(this.globeGroup);

    this.arcsGroup = new THREE.Group();
    this.globeGroup.add(this.arcsGroup);

    this.addBaseSphere();
    this.atmosphere = this.createAtmosphere();
    this.globeGroup.add(this.atmosphere);

    if (this.options.background) {
      this.stars = this.createStars();
      this.scene.add(this.stars);
    } else {
      this.stars = new THREE.Points();
    }

    void this.loadLand();

    this.resizeObserver = new ResizeObserver(() => this.handleResize());
    this.resizeObserver.observe(this.container);

    this.renderer.domElement.addEventListener('pointerdown', this.onPointerDown);
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
  }

  private addBaseSphere(): void {
    const radius = this.options.radius;

    const solid = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 0.995, 64, 64),
      new THREE.MeshPhongMaterial({
        color: 0x0b1e2e,
        emissive: 0x0a1626,
        specular: 0x113355,
        shininess: 18,
        transparent: true,
        opacity: 0.95,
      }),
    );
    this.globeGroup.add(solid);

    const wire = new THREE.Mesh(
      new THREE.SphereGeometry(radius * 1.001, 48, 32),
      new THREE.MeshBasicMaterial({
        color: 0x22d3ee,
        wireframe: true,
        transparent: true,
        opacity: 0.08,
      }),
    );
    this.globeGroup.add(wire);
  }

  private createAtmosphere(): THREE.Mesh {
    const radius = this.options.radius;
    const geometry = new THREE.SphereGeometry(radius * 1.18, 64, 64);
    const material = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      uniforms: {
        glowColor: { value: new THREE.Color(0x3ee0ff) },
      },
      vertexShader: /* glsl */ `
        varying vec3 vNormal;
        void main() {
          vNormal = normalize(normalMatrix * normal);
          gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
        }
      `,
      fragmentShader: /* glsl */ `
        uniform vec3 glowColor;
        varying vec3 vNormal;
        void main() {
          float intensity = pow(0.68 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.2);
          gl_FragColor = vec4(glowColor, 1.0) * intensity;
        }
      `,
    });
    return new THREE.Mesh(geometry, material);
  }

  private createStars(): THREE.Points {
    const count = 1500;
    const positions = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      const r = 30 + Math.random() * 20;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      positions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      positions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      positions[i * 3 + 2] = r * Math.cos(phi);
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
    const mat = new THREE.PointsMaterial({
      color: 0xffffff,
      size: 0.08,
      sizeAttenuation: true,
      transparent: true,
      opacity: 0.7,
      depthWrite: false,
    });
    return new THREE.Points(geom, mat);
  }

  private async loadLand(): Promise<void> {
    try {
      this.land = await loadLandDots(this.options.landUrl, this.options.radius * 1.002, {
        stepDeg: 1.8,
      });
      this.globeGroup.add(this.land);
    } catch (err) {
      console.warn('[Zevr Guard] Failed to load land geojson:', err);
    }
  }

  private handleResize(): void {
    const { clientWidth: w, clientHeight: h } = this.container;
    if (w <= 0 || h <= 0) return;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private handlePointerDown(e: PointerEvent): void {
    this.dragging = true;
    this.lastPointer.x = e.clientX;
    this.lastPointer.y = e.clientY;
    this.renderer.domElement.setPointerCapture(e.pointerId);
  }

  private handlePointerMove(e: PointerEvent): void {
    if (!this.dragging) return;
    const dx = e.clientX - this.lastPointer.x;
    const dy = e.clientY - this.lastPointer.y;
    this.lastPointer.x = e.clientX;
    this.lastPointer.y = e.clientY;
    this.targetRotY += dx * 0.005;
    this.targetRotX = Math.max(
      -Math.PI / 2.2,
      Math.min(Math.PI / 2.2, this.targetRotX + dy * 0.005),
    );
  }

  private handlePointerUp(): void {
    this.dragging = false;
  }

  start(): void {
    if (this.running) return;
    this.running = true;
    this.lastFrame = performance.now();
    this.animate();
  }

  stop(): void {
    this.running = false;
    cancelAnimationFrame(this.rafId);
  }

  private animate = (): void => {
    if (!this.running) return;
    const now = performance.now();
    const dt = (now - this.lastFrame) / 1000;
    this.lastFrame = now;

    if (!this.dragging) {
      this.targetRotY += this.options.autoRotateSpeed * dt;
    }
    this.globeGroup.rotation.y += (this.targetRotY - this.globeGroup.rotation.y) * 0.08;
    this.globeGroup.rotation.x += (this.targetRotX - this.globeGroup.rotation.x) * 0.08;

    if (this.stars) this.stars.rotation.y += 0.00015;

    this.updateArcs(now);
    this.updatePointers(now);

    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.animate);
  };

  private updateArcs(now: number): void {
    for (let i = this.liveArcs.length - 1; i >= 0; i--) {
      const arc = this.liveArcs[i];
      const age = now - arc.bornAt;
      const t = age / ARC_LIFETIME;
      if (t >= 1) {
        this.arcsGroup.remove(arc.group);
        arc.line.geometry.dispose();
        (arc.line.material as THREE.Material).dispose();
        arc.head.geometry.dispose();
        (arc.head.material as THREE.Material).dispose();
        arc.ring.geometry.dispose();
        (arc.ring.material as THREE.Material).dispose();
        this.liveArcs.splice(i, 1);
        continue;
      }

      const drawT = Math.min(1, t * 1.8);
      const segs = Math.max(2, Math.floor(ARC_SEGMENTS * drawT));
      const positions = arc.line.geometry.attributes.position as THREE.BufferAttribute;
      for (let s = 0; s <= segs; s++) {
        const u = (s / ARC_SEGMENTS);
        const p = arc.curve.getPoint(u);
        positions.setXYZ(s, p.x, p.y, p.z);
      }
      for (let s = segs + 1; s <= ARC_SEGMENTS; s++) {
        const p = arc.curve.getPoint(drawT * (ARC_SEGMENTS / ARC_SEGMENTS));
        positions.setXYZ(s, p.x, p.y, p.z);
      }
      positions.needsUpdate = true;
      (arc.line.geometry as THREE.BufferGeometry).setDrawRange(0, segs + 1);

      const headPos = arc.curve.getPoint(drawT);
      arc.head.position.copy(headPos);
      const headOpacity = t < 0.55 ? 1 : Math.max(0, 1 - (t - 0.55) / 0.45);
      (arc.head.material as THREE.MeshBasicMaterial).opacity = headOpacity;

      const lineOpacity =
        t < 0.6 ? 0.4 + drawT * 0.6 : Math.max(0, 1 - (t - 0.6) / 0.4);
      (arc.line.material as THREE.LineBasicMaterial).opacity = lineOpacity;

      const ringAge = Math.max(0, (age - ARC_LIFETIME * 0.48) / (ARC_LIFETIME * 0.52));
      if (ringAge > 0) {
        const s = 1 + ringAge * 3;
        arc.ring.scale.setScalar(s);
        (arc.ring.material as THREE.MeshBasicMaterial).opacity = Math.max(
          0,
          0.9 - ringAge,
        );
        arc.ring.visible = true;
      } else {
        arc.ring.visible = false;
      }
    }
  }

  private updatePointers(now: number): void {
    const pulse = 0.85 + Math.sin(now * 0.004) * 0.25;
    this.pointers.forEach((m) => {
      m.scale.setScalar(pulse);
    });
  }

  addArc(input: GlobeArcInput): void {
    const color = new THREE.Color(RISK_COLOR[input.risk]);
    const radius = this.options.radius;
    const from = latLngToVec3(input.from.lat, input.from.lng, radius * 1.005);
    const to = latLngToVec3(input.to.lat, input.to.lng, radius * 1.005);

    const mid = from.clone().add(to).multiplyScalar(0.5);
    const angle = greatCircleDistance(input.from, input.to);
    const lift = radius * (0.35 + angle * 0.65);
    mid.setLength(radius + lift);

    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);

    const positions = new Float32Array((ARC_SEGMENTS + 1) * 3);
    const startPt = curve.getPoint(0);
    for (let i = 0; i <= ARC_SEGMENTS; i++) {
      positions[i * 3 + 0] = startPt.x;
      positions[i * 3 + 1] = startPt.y;
      positions[i * 3 + 2] = startPt.z;
    }
    const geom = new THREE.BufferGeometry();
    geom.setAttribute('position', new THREE.BufferAttribute(positions, 3));
    geom.setDrawRange(0, 1);
    const mat = new THREE.LineBasicMaterial({
      color,
      transparent: true,
      opacity: 0.9,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const line = new THREE.Line(geom, mat);

    const headMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 1,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const head = new THREE.Mesh(new THREE.SphereGeometry(radius * 0.012, 12, 12), headMat);
    head.position.copy(from);

    const ringMat = new THREE.MeshBasicMaterial({
      color,
      transparent: true,
      opacity: 0.8,
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
      depthWrite: false,
    });
    const ring = new THREE.Mesh(
      new THREE.RingGeometry(radius * 0.012, radius * 0.018, 32),
      ringMat,
    );
    ring.position.copy(to);
    ring.lookAt(new THREE.Vector3(0, 0, 0));
    ring.visible = false;

    const group = new THREE.Group();
    group.add(line);
    group.add(head);
    group.add(ring);
    this.arcsGroup.add(group);

    this.liveArcs.push({
      group,
      line,
      head,
      ring,
      curve,
      color,
      bornAt: performance.now(),
    });

    const destKey = `${input.to.lat.toFixed(1)}_${input.to.lng.toFixed(1)}_${input.risk}`;
    if (!this.pointers.has(destKey)) {
      const pointerMat = new THREE.MeshBasicMaterial({
        color,
        transparent: true,
        opacity: 0.9,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const pointer = new THREE.Mesh(
        new THREE.SphereGeometry(radius * 0.008, 10, 10),
        pointerMat,
      );
      pointer.position.copy(to);
      this.globeGroup.add(pointer);
      this.pointers.set(destKey, pointer);
    }
  }

  clearArcs(): void {
    for (const arc of this.liveArcs) {
      this.arcsGroup.remove(arc.group);
      arc.line.geometry.dispose();
      (arc.line.material as THREE.Material).dispose();
      arc.head.geometry.dispose();
      (arc.head.material as THREE.Material).dispose();
      arc.ring.geometry.dispose();
      (arc.ring.material as THREE.Material).dispose();
    }
    this.liveArcs = [];
  }

  clearPointers(): void {
    this.pointers.forEach((m) => {
      this.globeGroup.remove(m);
      m.geometry.dispose();
      (m.material as THREE.Material).dispose();
    });
    this.pointers.clear();
  }

  dispose(): void {
    this.stop();
    this.clearArcs();
    this.clearPointers();
    this.resizeObserver?.disconnect();
    this.renderer.domElement.removeEventListener('pointerdown', this.onPointerDown);
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    if (this.land) {
      this.land.geometry.dispose();
      (this.land.material as THREE.Material).dispose();
    }
    this.stars.geometry?.dispose();
    (this.stars.material as THREE.Material | undefined)?.dispose();
    this.atmosphere.geometry.dispose();
    (this.atmosphere.material as THREE.Material).dispose();
    this.renderer.dispose();
    this.renderer.domElement.remove();
  }
}
