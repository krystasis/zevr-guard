// Photoreal day/night Earth for the welcome hero.
//
// Adapted from the three.js "webgpu_tsl_earth" example (MIT), itself based
// on the Three.js Journey earth-shaders lesson. Earth textures by Solar
// System Scope (CC BY 4.0), resized. Runs on WebGPU where available and
// falls back to WebGL2 transparently; callers should catch init failures
// and keep their non-3D hero.
import * as THREE from 'three/webgpu';
import {
  step,
  normalWorldGeometry,
  output,
  texture,
  vec3,
  vec4,
  normalize,
  positionWorld,
  bumpMap,
  cameraPosition,
  color,
  uniform,
  mix,
  uv,
  max,
} from 'three/tsl';

import dayTextureUrl from '../../assets/planets/earth_day_2048.jpg?url';
import nightTextureUrl from '../../assets/planets/earth_night_2048.jpg?url';
import bumpRoughnessCloudsUrl from '../../assets/planets/earth_bump_roughness_clouds_2048.jpg?url';

function loadTexture(loader: THREE.TextureLoader, url: string): Promise<THREE.Texture> {
  return new Promise((resolve, reject) => {
    loader.load(url, resolve, undefined, reject);
  });
}

/**
 * Mounts the globe into `canvas`, sized to its parent element.
 * Resolves once the first frame is renderable; rejects when neither WebGPU
 * nor WebGL can be initialised. Returns a dispose function.
 */
export async function initEarthHero(canvas: HTMLCanvasElement): Promise<() => void> {
  const host = canvas.parentElement ?? document.body;

  const loader = new THREE.TextureLoader();
  const [dayTexture, nightTexture, bumpRoughnessCloudsTexture] = await Promise.all([
    loadTexture(loader, dayTextureUrl),
    loadTexture(loader, nightTextureUrl),
    loadTexture(loader, bumpRoughnessCloudsUrl),
  ]);
  dayTexture.colorSpace = THREE.SRGBColorSpace;
  dayTexture.anisotropy = 8;
  nightTexture.colorSpace = THREE.SRGBColorSpace;
  nightTexture.anisotropy = 8;
  bumpRoughnessCloudsTexture.anisotropy = 8;

  const camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(0, 0.35, 3.1);

  const scene = new THREE.Scene();

  // sun: from the upper left so a terminator crosses the visible arc and
  // the night-side city lights face the viewer's right
  const sun = new THREE.DirectionalLight('#ffffff', 2);
  sun.position.set(-2.2, 1.1, 1.6);
  scene.add(sun);

  // uniforms — atmosphere tinted toward the product's cyan
  const atmosphereDayColor = uniform(color('#38bdf8'));
  const atmosphereTwilightColor = uniform(color('#bc490b'));
  const roughnessLow = uniform(0.25);
  const roughnessHigh = uniform(0.35);

  // fresnel
  const viewDirection = positionWorld.sub(cameraPosition).normalize();
  const fresnel = viewDirection.dot(normalWorldGeometry).abs().oneMinus().toVar();

  // sun orientation
  const sunOrientation = normalWorldGeometry.dot(normalize(sun.position)).toVar();

  // atmosphere color
  const atmosphereColor = mix(
    atmosphereTwilightColor,
    atmosphereDayColor,
    sunOrientation.smoothstep(-0.25, 0.75),
  );

  // globe
  const globeMaterial = new THREE.MeshStandardNodeMaterial();
  const cloudsStrength = texture(bumpRoughnessCloudsTexture, uv()).b.smoothstep(0.2, 1);
  globeMaterial.colorNode = mix(texture(dayTexture), vec3(1), cloudsStrength.mul(2));
  const roughness = max(
    texture(bumpRoughnessCloudsTexture).g,
    step(0.01, cloudsStrength),
  );
  globeMaterial.roughnessNode = roughness.remap(0, 1, roughnessLow, roughnessHigh);

  const night = texture(nightTexture);
  const dayStrength = sunOrientation.smoothstep(-0.25, 0.5);
  const atmosphereDayStrength = sunOrientation.smoothstep(-0.5, 1);
  const atmosphereMix = atmosphereDayStrength.mul(fresnel.pow(2)).clamp(0, 1);

  let finalOutput = mix(night.rgb, output.rgb, dayStrength);
  finalOutput = mix(finalOutput, atmosphereColor, atmosphereMix);
  globeMaterial.outputNode = vec4(finalOutput, output.a);

  const bumpElevation = max(texture(bumpRoughnessCloudsTexture).r, cloudsStrength);
  globeMaterial.normalNode = bumpMap(bumpElevation);

  const sphereGeometry = new THREE.SphereGeometry(1, 64, 64);
  const globe = new THREE.Mesh(sphereGeometry, globeMaterial);

  // atmosphere shell
  const atmosphereMaterial = new THREE.MeshBasicNodeMaterial({
    side: THREE.BackSide,
    transparent: true,
  });
  let alpha = fresnel.remap(0.73, 1, 1, 0).pow(3);
  alpha = alpha.mul(sunOrientation.smoothstep(-0.5, 1));
  atmosphereMaterial.outputNode = vec4(atmosphereColor, alpha);
  const atmosphere = new THREE.Mesh(sphereGeometry, atmosphereMaterial);
  atmosphere.scale.setScalar(1.04);

  // --- live connection arcs -----------------------------------------------
  // Ambient "who talks to whom" traffic between world cities, in the same
  // color language as the Live Globe. Parented to the globe so anchors
  // rotate with the surface. (latLngToVec3 math inlined rather than imported
  // from shared/globe to avoid pulling core 'three' next to 'three/webgpu'.)
  const latLngToVec3 = (lat: number, lng: number, radius: number): THREE.Vector3 => {
    const phi = (90 - lat) * (Math.PI / 180);
    const theta = (lng + 180) * (Math.PI / 180);
    return new THREE.Vector3(
      -radius * Math.sin(phi) * Math.cos(theta),
      radius * Math.cos(phi),
      radius * Math.sin(phi) * Math.sin(theta),
    );
  };

  const CITIES: Array<[number, number]> = [
    [35.68, 139.69], [37.56, 126.97], [1.35, 103.81], [28.61, 77.2],
    [55.75, 37.61], [52.52, 13.4], [51.5, -0.12], [40.71, -74.0],
    [37.77, -122.41], [19.43, -99.13], [-23.55, -46.63], [30.04, 31.23],
    [-33.86, 151.2], [39.9, 116.4], [25.2, 55.27], [59.33, 18.06],
  ];
  const ARC_COLORS = [0x38bdf8, 0x38bdf8, 0x38bdf8, 0x38bdf8, 0xfacc15, 0xef4444];
  const ARC_POINTS = 48;
  const ARC_LIFE = 4200;

  interface HeroArc {
    tube: THREE.Mesh;
    head: THREE.Mesh;
    dots: THREE.Mesh[];
    curve: THREE.QuadraticBezierCurve3;
    material: THREE.MeshBasicMaterial;
    dotMaterial: THREE.MeshBasicMaterial;
    bornAt: number;
  }
  const arcGroup = new THREE.Group();
  const liveArcs: HeroArc[] = [];
  const dotGeometry = new THREE.SphereGeometry(0.012, 8, 8);
  const headGeometry = new THREE.SphereGeometry(0.016, 8, 8);

  // Prefer endpoints on the camera-facing side of the sphere: with the
  // horizon composition only the front-top cap is visible, and an arc with
  // both ends behind the planet never shows up.
  // Endpoints must sit on the camera-facing upper cap — with the horizon
  // composition anything else is hidden behind the planet or below the fold.
  const worldProbe = new THREE.Vector3();
  function cityFacingCamera(): [number, number] {
    for (let i = 0; i < 12; i++) {
      const c = CITIES[Math.floor(Math.random() * CITIES.length)];
      worldProbe.copy(latLngToVec3(c[0], c[1], 1));
      globe.localToWorld(worldProbe);
      if (worldProbe.z > 0.1 && worldProbe.y > -1.2) return c;
    }
    return CITIES[Math.floor(Math.random() * CITIES.length)];
  }

  function spawnArc(now: number) {
    const a = cityFacingCamera();
    let b = cityFacingCamera();
    if (b === a) b = CITIES[(CITIES.indexOf(a) + 5) % CITIES.length];
    const from = latLngToVec3(a[0], a[1], 1.005);
    const to = latLngToVec3(b[0], b[1], 1.005);
    const lift = 1 + from.angleTo(to) * 0.35;
    const mid = from.clone().add(to).multiplyScalar(0.5).normalize().multiplyScalar(lift);
    const curve = new THREE.QuadraticBezierCurve3(from, mid, to);
    const colorHex = ARC_COLORS[Math.floor(Math.random() * ARC_COLORS.length)];
    const material = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const tube = new THREE.Mesh(
      new THREE.TubeGeometry(curve, ARC_POINTS, 0.006, 6, false),
      material,
    );
    const dotMaterial = new THREE.MeshBasicMaterial({
      color: colorHex,
      transparent: true,
      opacity: 0,
      blending: THREE.AdditiveBlending,
      depthWrite: false,
    });
    const dots = [from, to].map((p) => {
      const m = new THREE.Mesh(dotGeometry, dotMaterial);
      m.position.copy(p);
      return m;
    });
    const head = new THREE.Mesh(headGeometry, dotMaterial);
    head.position.copy(from);
    arcGroup.add(tube, head, ...dots);
    liveArcs.push({ tube, head, dots, curve, material, dotMaterial, bornAt: now });
  }

  const headPos = new THREE.Vector3();
  function updateArcs(now: number) {
    for (let i = liveArcs.length - 1; i >= 0; i--) {
      const arc = liveArcs[i];
      const age = (now - arc.bornAt) / ARC_LIFE;
      if (age >= 1) {
        arcGroup.remove(arc.tube, arc.head, ...arc.dots);
        arc.tube.geometry.dispose();
        arc.material.dispose();
        arc.dotMaterial.dispose();
        liveArcs.splice(i, 1);
        continue;
      }
      // fade in fast, hold, fade out; a bright head travels the curve
      const fadeIn = Math.min(1, age / 0.12);
      const fadeOut = age > 0.72 ? 1 - (age - 0.72) / 0.28 : 1;
      arc.material.opacity = 0.55 * fadeIn * fadeOut;
      arc.dotMaterial.opacity = 0.95 * fadeIn * fadeOut;
      const t = Math.min(1, age / 0.55);
      arc.curve.getPointAt(t, headPos);
      arc.head.position.copy(headPos);
    }
  }

  // "rising earth" composition: most of the sphere sits below the fold so
  // the lit horizon arcs across the hero's lower half
  const earthGroup = new THREE.Group();
  globe.add(arcGroup);
  earthGroup.add(globe, atmosphere);
  earthGroup.position.y = -2.05;
  earthGroup.rotation.z = -0.12;
  earthGroup.scale.setScalar(1.75);
  scene.add(earthGroup);

  const renderer = new THREE.WebGPURenderer({ canvas, antialias: true, alpha: true });
  renderer.setClearColor(0x000000, 0);
  await renderer.init(); // throws when neither WebGPU nor WebGL2 is available

  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  let last = performance.now();
  let nextArcAt = performance.now() + 800;
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const delta = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!reducedMotion) {
      globe.rotation.y += delta * 0.02;
      if (now >= nextArcAt && liveArcs.length < 22) {
        spawnArc(now);
        nextArcAt = now + 260 + Math.random() * 320;
      }
      updateArcs(now);
    }
    renderer.render(scene, camera);
  });

  function resize() {
    const w = host.clientWidth || 1;
    const h = host.clientHeight || 1;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    // Portrait viewports render the sphere proportionally larger — sink it
    // further so the horizon stays in the lower third of the hero.
    earthGroup.position.y = camera.aspect < 0.9 ? -2.45 : -2.05;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(w, h, false);
  }
  resize();
  const observer = new ResizeObserver(resize);
  observer.observe(host);

  return () => {
    observer.disconnect();
    renderer.setAnimationLoop(null);
    renderer.dispose();
    sphereGeometry.dispose();
    globeMaterial.dispose();
    atmosphereMaterial.dispose();
    dayTexture.dispose();
    nightTexture.dispose();
    bumpRoughnessCloudsTexture.dispose();
  };
}
