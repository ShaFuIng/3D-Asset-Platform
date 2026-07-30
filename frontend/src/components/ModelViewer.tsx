import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

type ModelViewerProps = {
  src?: string;
};

export function ModelViewer({ src }: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(src));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!src || !container) {
      setIsLoading(Boolean(src));
      setError(null);
      return;
    }
    const mount = container;

    let frameId = 0;
    let disposed = false;
    setIsLoading(true);
    setError(null);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0xeef3f1);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    camera.position.set(2.5, 1.8, 2.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = true;
    controls.autoRotateSpeed = 1.2;

    scene.add(new THREE.HemisphereLight(0xffffff, 0x8a98a5, 2.4));
    const directionalLight = new THREE.DirectionalLight(0xffffff, 2.2);
    directionalLight.position.set(3, 4, 5);
    scene.add(directionalLight);

    function resize() {
      const width = mount.clientWidth || 1;
      const height = mount.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    const loader = new GLTFLoader();
    loader.load(
      src,
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }

        const model = gltf.scene;
        scene.add(model);
        frameModel(model, camera, controls);
        setIsLoading(false);
      },
      undefined,
      () => {
        if (!disposed) {
          setIsLoading(false);
          setError('無法載入這個 GLB 模型。');
        }
      },
    );

    function animate() {
      controls.update();
      renderer.render(scene, camera);
      frameId = window.requestAnimationFrame(animate);
    }
    animate();

    return () => {
      disposed = true;
      window.cancelAnimationFrame(frameId);
      resizeObserver.disconnect();
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          disposeMaterial(object.material);
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [src]);

  if (!src) {
    return (
      <div className="viewer-placeholder">
        尚未取得 GLB 模型。完成 3D Job 後會在這裡顯示預覽。
      </div>
    );
  }

  return (
    <div className="viewer-shell">
      {isLoading && <div className="viewer-overlay">Loading model...</div>}
      {error && <div className="viewer-error">{error}</div>}
      <div ref={containerRef} className="three-canvas" aria-label="Generated 3D asset preview" />
    </div>
  );
}

function frameModel(
  model: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
) {
  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const center = box.getCenter(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z) || 1;

  model.position.sub(center);
  const distance = maxSize / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  camera.position.set(distance * 0.9, distance * 0.65, distance * 1.35);
  camera.near = Math.max(distance / 100, 0.01);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();

  controls.target.set(0, 0, 0);
  controls.minDistance = distance * 0.25;
  controls.maxDistance = distance * 5;
  controls.update();
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    material.forEach((item) => item.dispose());
    return;
  }
  material.dispose();
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      disposeMaterial(child.material);
    }
  });
}
