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

  // "rising earth" composition: most of the sphere sits below the fold so
  // the lit horizon arcs across the hero's lower half
  const earthGroup = new THREE.Group();
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
  renderer.setAnimationLoop(() => {
    const now = performance.now();
    const delta = Math.min((now - last) / 1000, 0.1);
    last = now;
    if (!reducedMotion) globe.rotation.y += delta * 0.02;
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
