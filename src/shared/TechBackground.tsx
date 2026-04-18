import { useEffect, useRef } from 'react';
import * as THREE from 'three';

export const TechBackground: React.FC<{ className?: string }> = ({ className = '' }) => {
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const container = ref.current;
    if (!container) return;

    const renderer = new THREE.WebGLRenderer({
      antialias: true,
      alpha: true,
      powerPreference: 'high-performance',
    });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setClearColor(0x000000, 0);
    const canvas = renderer.domElement;
    canvas.style.display = 'block';
    canvas.style.width = '100%';
    canvas.style.height = '100%';
    container.appendChild(canvas);

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(45, 1, 0.1, 100);
    camera.position.z = 5;

    const group = new THREE.Group();
    scene.add(group);

    const baseGeom = new THREE.IcosahedronGeometry(1.8, 3);

    const wireframe = new THREE.Mesh(
      baseGeom,
      new THREE.MeshBasicMaterial({
        color: 0x38bdf8,
        wireframe: true,
        transparent: true,
        opacity: 0.12,
      }),
    );
    group.add(wireframe);

    const innerGeom = new THREE.IcosahedronGeometry(1.3, 2);
    const innerWire = new THREE.Mesh(
      innerGeom,
      new THREE.MeshBasicMaterial({
        color: 0x7dd3fc,
        wireframe: true,
        transparent: true,
        opacity: 0.08,
      }),
    );
    group.add(innerWire);

    const vertexPositions = baseGeom.getAttribute('position');
    const dotsGeom = new THREE.BufferGeometry();
    dotsGeom.setAttribute('position', vertexPositions);
    const dots = new THREE.Points(
      dotsGeom,
      new THREE.PointsMaterial({
        color: 0x38bdf8,
        size: 0.035,
        transparent: true,
        opacity: 0.6,
        sizeAttenuation: true,
        depthWrite: false,
      }),
    );
    group.add(dots);

    const starCount = 600;
    const starPositions = new Float32Array(starCount * 3);
    for (let i = 0; i < starCount; i++) {
      const r = 8 + Math.random() * 14;
      const theta = Math.random() * Math.PI * 2;
      const phi = Math.acos(2 * Math.random() - 1);
      starPositions[i * 3 + 0] = r * Math.sin(phi) * Math.cos(theta);
      starPositions[i * 3 + 1] = r * Math.sin(phi) * Math.sin(theta);
      starPositions[i * 3 + 2] = r * Math.cos(phi);
    }
    const starsGeom = new THREE.BufferGeometry();
    starsGeom.setAttribute(
      'position',
      new THREE.Float32BufferAttribute(starPositions, 3),
    );
    const stars = new THREE.Points(
      starsGeom,
      new THREE.PointsMaterial({
        color: 0xffffff,
        size: 0.025,
        transparent: true,
        opacity: 0.35,
        sizeAttenuation: true,
        depthWrite: false,
      }),
    );
    scene.add(stars);

    const atmosphereGeom = new THREE.SphereGeometry(2.3, 48, 48);
    const atmosphereMat = new THREE.ShaderMaterial({
      transparent: true,
      side: THREE.BackSide,
      blending: THREE.AdditiveBlending,
      uniforms: { glowColor: { value: new THREE.Color(0x22d3ee) } },
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
          float intensity = pow(0.55 - dot(vNormal, vec3(0.0, 0.0, 1.0)), 2.2);
          gl_FragColor = vec4(glowColor, 1.0) * intensity * 0.55;
        }
      `,
    });
    const atmosphere = new THREE.Mesh(atmosphereGeom, atmosphereMat);
    group.add(atmosphere);

    let running = true;
    let rafId = 0;
    const animate = (t: number) => {
      if (!running) return;
      group.rotation.x = Math.sin(t * 0.00005) * 0.2;
      group.rotation.y += 0.0011;
      wireframe.rotation.z = t * 0.0003;
      innerWire.rotation.x = t * 0.0005;
      innerWire.rotation.y = t * -0.0008;
      stars.rotation.y += 0.0002;
      renderer.render(scene, camera);
      rafId = requestAnimationFrame(animate);
    };
    rafId = requestAnimationFrame(animate);

    const resize = () => {
      const w = container.clientWidth;
      const h = container.clientHeight;
      if (w <= 0 || h <= 0) return;
      renderer.setSize(w, h, false);
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
    };
    resize();
    const ro = new ResizeObserver(resize);
    ro.observe(container);

    return () => {
      running = false;
      cancelAnimationFrame(rafId);
      ro.disconnect();
      baseGeom.dispose();
      innerGeom.dispose();
      dotsGeom.dispose();
      starsGeom.dispose();
      atmosphereGeom.dispose();
      (wireframe.material as THREE.Material).dispose();
      (innerWire.material as THREE.Material).dispose();
      (dots.material as THREE.Material).dispose();
      (stars.material as THREE.Material).dispose();
      atmosphereMat.dispose();
      renderer.dispose();
      canvas.remove();
    };
  }, []);

  return <div ref={ref} className={`pointer-events-none ${className}`} />;
};
