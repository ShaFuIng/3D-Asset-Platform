import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { resolveApiUrl } from '../api/client';

/*
 * AR preview (demo): composites the generated GLB into a real photo, with a
 * pre-baked depth-threshold alpha mask layered on top so a foreground object
 * in the photo visually occludes part of the model. Camera is fixed (no
 * OrbitControls) — this is a still "photo mockup" shot, not an inspection
 * tool. See scripts/generate_ar_mask.py for how the mask PNG is produced,
 * and backend/app/routers/demo_assets.py for how these files are served.
 */

type ARPreviewProps = {
  modelUrl?: string;
};

const SCENE_IMAGE_URL = resolveApiUrl('/api/demo-assets/ar-preview/scene.png');
const SCENE_MASK_URL = resolveApiUrl('/api/demo-assets/ar-preview/scene_mask.png');

// Fixed "camera" for the demo shot.
const CAMERA_FOV_DEG = 45;
const CAMERA_DISTANCE = 4; // camera sits at (0, 0, CAMERA_DISTANCE), looking at the origin.
const BACKGROUND_DISTANCE = 10; // how far behind the origin the background plane sits.

// Manually tuned placement for the model within the fixed shot. Applied
// AFTER auto-centering/normalizing the loaded GLB — different jobs produce
// wildly different raw scales/origins (same reason ModelViewer.tsx computes
// a bounding box instead of hardcoding a camera position), so a literal
// hardcoded position/scale would only ever look right for one specific
// model.
//
// Tuned (2026-08-05) for the current demo-assets/ar-preview/scene.png: sits
// on the clear desk gap between the mug and the laptop, sized close to the
// water bottle, with its right edge genuinely behind the bottle's mask
// silhouette (verified by sampling rendered pixel colors across several
// rows: a straight vertical seam where the model's flat gray abruptly
// becomes the bottle's blue/green, not the model's own curved edge —
// eyeballing a screenshot alone was not enough to tell the difference here
// and previously led to a placement that only looked adjacent to the
// bottle without any real occlusion).
//
// Re-tune these three constants whenever scene.png is replaced, and
// re-verify the same way: temporarily blow up MODEL_TARGET_SIZE so the
// occlusion is unmistakable in a screenshot, then check the "cut" edge is a
// straight seam (real occlusion) rather than the model's own silhouette.
//
// Known limitation: because the model sits at a fixed world position while
// the background photo is "cover"-cropped to fit the container, this
// placement is tuned for the viewer panel's normal (wide) aspect ratio.
// Very narrow/tall containers crop the photo very differently and can shift
// the model noticeably relative to the mug/bottle/laptop.
const MODEL_TARGET_SIZE = 1.8; // normalized so the model's longest side is this many world units.
const MODEL_OFFSET = new THREE.Vector3(1.8, -0.55, 0.5);
const MODEL_ROTATION_Y = THREE.MathUtils.degToRad(25);

export function ARPreview({ modelUrl }: ARPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(modelUrl));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!modelUrl || !container) {
      setIsLoading(Boolean(modelUrl));
      setError(null);
      return;
    }
    const mount = container;

    let disposed = false;
    let backgroundTexture: THREE.Texture | null = null;
    setIsLoading(true);
    setError(null);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x14181c);

    const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.01, 1000);
    camera.position.set(0, 0, CAMERA_DISTANCE);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = false;
    mount.appendChild(renderer.domElement);

    addPreviewLights(scene);

    // Background plane: resized on every layout change to exactly cover the
    // camera frustum at BACKGROUND_DISTANCE (see fitBackgroundPlane), the
    // same "fill the canvas" effect as CSS background-size: cover.
    const backgroundMaterial = new THREE.MeshBasicMaterial();
    const backgroundPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), backgroundMaterial);
    backgroundPlane.position.set(0, 0, -BACKGROUND_DISTANCE);
    scene.add(backgroundPlane);

    function render() {
      renderer.render(scene, camera);
    }

    function fitBackgroundPlane() {
      const width = mount.clientWidth || 1;
      const height = mount.clientHeight || 1;
      // Frustum size scales with distance FROM THE CAMERA, not from the
      // origin — the camera itself sits CAMERA_DISTANCE in front of the
      // origin, so the plane (BACKGROUND_DISTANCE behind the origin) is
      // actually CAMERA_DISTANCE + BACKGROUND_DISTANCE away from the camera.
      const distanceFromCamera = CAMERA_DISTANCE + BACKGROUND_DISTANCE;
      const viewHeight = 2 * distanceFromCamera * Math.tan(THREE.MathUtils.degToRad(CAMERA_FOV_DEG) / 2);
      const viewWidth = viewHeight * (width / height);
      backgroundPlane.scale.set(viewWidth, viewHeight, 1);

      const image = backgroundTexture?.image;
      if (backgroundTexture && image instanceof HTMLImageElement && image.naturalWidth && image.naturalHeight) {
        // "Cover" crop via UV repeat/offset instead of stretching the photo
        // to match the container's aspect ratio.
        const containerAspect = width / height;
        const imageAspect = image.naturalWidth / image.naturalHeight;
        if (imageAspect > containerAspect) {
          const repeatX = containerAspect / imageAspect;
          backgroundTexture.repeat.set(repeatX, 1);
          backgroundTexture.offset.set((1 - repeatX) / 2, 0);
        } else {
          const repeatY = imageAspect / containerAspect;
          backgroundTexture.repeat.set(1, repeatY);
          backgroundTexture.offset.set(0, (1 - repeatY) / 2);
        }
      }
    }

    let pendingLoads = 2;
    function finishLoad() {
      pendingLoads -= 1;
      if (disposed) {
        return;
      }
      render();
      if (pendingLoads <= 0) {
        setIsLoading(false);
      }
    }
    function failLoad(message: string) {
      if (!disposed) {
        setIsLoading(false);
        setError(message);
      }
    }

    new THREE.TextureLoader().load(
      SCENE_IMAGE_URL,
      (texture) => {
        if (disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.SRGBColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        backgroundTexture = texture;
        backgroundMaterial.map = texture;
        backgroundMaterial.needsUpdate = true;
        fitBackgroundPlane();
        finishLoad();
      },
      undefined,
      () => failLoad('無法載入 AR 背景照片。'),
    );

    const loader = new GLTFLoader();
    loader.load(
      modelUrl,
      (gltf) => {
        if (disposed) {
          disposeObject(gltf.scene);
          return;
        }
        placeModel(gltf.scene);
        scene.add(gltf.scene);
        finishLoad();
      },
      undefined,
      () => failLoad('無法載入這個 GLB 模型。'),
    );

    function placeModel(model: THREE.Object3D) {
      const box = new THREE.Box3().setFromObject(model);
      const size = box.getSize(new THREE.Vector3());
      const center = box.getCenter(new THREE.Vector3());
      const maxDimension = Math.max(size.x, size.y, size.z) || 1;
      const scale = MODEL_TARGET_SIZE / maxDimension;

      // Center at the origin, normalize to a consistent size, then apply
      // the manual demo-shot placement on top.
      model.position.sub(center);
      model.scale.setScalar(scale);
      model.position.multiplyScalar(scale);
      model.position.add(MODEL_OFFSET);
      model.rotation.y = MODEL_ROTATION_Y;
    }

    function resize() {
      const width = mount.clientWidth || 1;
      const height = mount.clientHeight || 1;
      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      fitBackgroundPlane();
      render();
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    return () => {
      disposed = true;
      resizeObserver.disconnect();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          disposeMaterial(object.material);
        }
      });
      backgroundTexture?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [modelUrl]);

  if (!modelUrl) {
    return (
      <div className="viewer-placeholder">
        尚未取得 GLB 模型。完成 3D Job 後會在這裡顯示 AR 預覽。
      </div>
    );
  }

  return (
    <div className="viewer-shell">
      <div className="viewer-stats" aria-live="polite">
        AR Preview（Demo：固定機位、離線深度遮罩）
      </div>
      <img className="ar-preview-mask" src={SCENE_MASK_URL} alt="" aria-hidden="true" draggable={false} />
      {isLoading && <div className="viewer-overlay">Loading AR preview...</div>}
      {error && <div className="viewer-error">{error}</div>}
      <div ref={containerRef} className="three-canvas" aria-label="AR preview of the generated 3D asset" />
    </div>
  );
}

// No continuous rAF loop: unlike ModelViewer.tsx (OrbitControls damping needs
// one), this is a static shot — render() is only called after each async
// load and on resize.

function addPreviewLights(scene: THREE.Scene) {
  scene.add(new THREE.AmbientLight(0xffffff, 1.1));

  const lights: Array<[number, number, number, number]> = [
    [2, 4, 4, 1.2],
    [-3, 2, 2, 0.7],
    [0, -2, 3, 0.4],
  ];

  lights.forEach(([x, y, z, intensity]) => {
    const light = new THREE.DirectionalLight(0xffffff, intensity);
    light.position.set(x, y, z);
    light.castShadow = false;
    scene.add(light);
  });
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
