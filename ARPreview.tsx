import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { resolveApiUrl } from '../api/client';

/*
 * AR preview (demo): composites the generated GLB into a real photo using
 * PER-PIXEL DEPTH COMPARISON rather than a pre-baked 2D alpha mask.
 *
 * How it works (two render passes):
 *   1. The model is rendered alone into a WebGLRenderTarget that also
 *      carries a DepthTexture, so we keep both its colour and its depth.
 *   2. A full-screen quad composites photo + model. For every pixel it
 *      linearises the model's depth-buffer value into a real distance from
 *      the camera, converts the photo's greyscale depth value into a
 *      distance using the calibration below, and shows whichever is nearer.
 *
 * Why this replaces the old mask approach: a flat mask PNG has no idea where
 * the model actually sits in 3D, so it cuts the model along a fixed
 * silhouette regardless of depth — which is how the model ended up sliced
 * across the middle. Comparing depths per pixel makes occlusion a genuine
 * front/back relationship, so the model can be placed anywhere and still be
 * occluded correctly.
 *
 * Camera is fixed (no OrbitControls) — this is a still "photo mockup" shot.
 * scene_depth.png comes straight from Depth Anything V2 (near = bright,
 * far = dark). scene_mask.png is no longer used by this component.
 */

type ARPreviewProps = {
  modelUrl?: string;
  /** Distance (world units from the camera) represented by the BRIGHTEST depth pixel. */
  nearDistance?: number;
  /** Distance (world units from the camera) represented by the DARKEST depth pixel. */
  farDistance?: number;
  /** Tints occluded pixels red so it is obvious which pixels the depth test rejected. */
  debugOcclusion?: boolean;
  /** Shows sliders for tuning nearDistance / farDistance live. Dev use only. */
  calibrationUI?: boolean;
};

const SCENE_IMAGE_URL = resolveApiUrl('/api/demo-assets/ar-preview/scene.png');
const SCENE_DEPTH_URL = resolveApiUrl('/api/demo-assets/ar-preview/scene_depth.png');

// Fixed "camera" for the demo shot.
const CAMERA_FOV_DEG = 45;
const CAMERA_NEAR = 0.1;
const CAMERA_FAR = 100;
const CAMERA_DISTANCE = 4; // camera sits at (0, 0, CAMERA_DISTANCE), looking at the origin.

// Placement of the model within the fixed shot, applied AFTER auto-centering
// and normalising the loaded GLB (different jobs produce wildly different raw
// scales/origins, same reason ModelViewer.tsx computes a bounding box).
//
// Unlike the old mask version, MODEL_OFFSET.z is now MEANINGFUL: it decides
// how far from the camera the model sits, and therefore what it occludes and
// what occludes it. Camera distance is 4, so z = +0.5 puts the model 3.5
// units from the camera.
const MODEL_TARGET_SIZE = 1.8;
const MODEL_OFFSET = new THREE.Vector3(1.4, -0.5, 0.5);
const MODEL_ROTATION_Y = THREE.MathUtils.degToRad(25);

// Calibration defaults. Depth Anything outputs RELATIVE depth, so these two
// numbers map its 0..1 greyscale range onto real distances in this scene.
// Tune them with calibrationUI until the model's feet sit convincingly
// behind the bottle, then paste the final values back here.
const DEFAULT_NEAR_DISTANCE = 2.2;
const DEFAULT_FAR_DISTANCE = 14;

const COMPOSITE_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const COMPOSITE_FRAGMENT_SHADER = /* glsl */ `
  #include <packing>

  uniform sampler2D uPhoto;
  uniform sampler2D uPhotoDepth;
  uniform sampler2D uModelColor;
  uniform sampler2D uModelDepth;
  uniform vec2 uPhotoRepeat;
  uniform vec2 uPhotoOffset;
  uniform float uCameraNear;
  uniform float uCameraFar;
  uniform float uNearDistance;
  uniform float uFarDistance;
  uniform float uFeather;
  uniform float uDebug;

  varying vec2 vUv;

  // Photo/depth PNGs are sampled raw (colorSpace = NoColorSpace) so the depth
  // values stay untouched; the photo therefore needs decoding by hand.
  vec3 sRGBToLinear(vec3 c) {
    return mix(
      c / 12.92,
      pow((c + 0.055) / 1.055, vec3(2.4)),
      step(vec3(0.04045), c)
    );
  }

  void main() {
    vec2 photoUv = vUv * uPhotoRepeat + uPhotoOffset;
    vec3 photo = sRGBToLinear(texture2D(uPhoto, photoUv).rgb);
    vec4 model = texture2D(uModelColor, vUv);

    if (model.a < 0.01) {
      gl_FragColor = vec4(photo, 1.0);
      return;
    }

    // Model depth: linearise the depth buffer into distance from the camera.
    float rawDepth = texture2D(uModelDepth, vUv).x;
    float modelDistance = -perspectiveDepthToViewZ(rawDepth, uCameraNear, uCameraFar);

    // Photo depth: bright = near, dark = far.
    float grey = texture2D(uPhotoDepth, photoUv).r;
    float photoDistance = mix(uFarDistance, uNearDistance, grey);

    // occlusion = 1 when the photo is in front of the model.
    float occlusion = smoothstep(-uFeather, uFeather, modelDistance - photoDistance);
    float visible = model.a * (1.0 - occlusion);

    vec3 color = mix(photo, model.rgb, visible);

    if (uDebug > 0.5) {
      color = mix(color, vec3(1.0, 0.15, 0.15), occlusion * model.a * 0.65);
    }

    gl_FragColor = vec4(color, 1.0);
  }
`;

export function ARPreview({
  modelUrl,
  nearDistance = DEFAULT_NEAR_DISTANCE,
  farDistance = DEFAULT_FAR_DISTANCE,
  debugOcclusion = false,
  calibrationUI = false,
}: ARPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const uniformsRef = useRef<Record<string, THREE.IUniform> | null>(null);
  const renderRef = useRef<(() => void) | null>(null);

  const [isLoading, setIsLoading] = useState(Boolean(modelUrl));
  const [error, setError] = useState<string | null>(null);
  const [near, setNear] = useState(nearDistance);
  const [far, setFar] = useState(farDistance);
  const [debug, setDebug] = useState(debugOcclusion);

  useEffect(() => {
    const container = containerRef.current;
    if (!modelUrl || !container) {
      setIsLoading(Boolean(modelUrl));
      setError(null);
      return;
    }
    const mount = container;

    let disposed = false;
    let photoTexture: THREE.Texture | null = null;
    let photoDepthTexture: THREE.Texture | null = null;
    setIsLoading(true);
    setError(null);

    // --- Pass 1: the model on its own -------------------------------------
    const modelScene = new THREE.Scene();
    addPreviewLights(modelScene);

    const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 1, CAMERA_NEAR, CAMERA_FAR);
    camera.position.set(0, 0, CAMERA_DISTANCE);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = false;
    mount.appendChild(renderer.domElement);

    const depthTexture = new THREE.DepthTexture(1, 1);
    depthTexture.format = THREE.DepthFormat;
    depthTexture.type = THREE.UnsignedIntType;

    const modelTarget = new THREE.WebGLRenderTarget(1, 1, {
      depthTexture,
      depthBuffer: true,
      stencilBuffer: false,
    });

    // --- Pass 2: full-screen composite ------------------------------------
    const uniforms: Record<string, THREE.IUniform> = {
      uPhoto: { value: null },
      uPhotoDepth: { value: null },
      uModelColor: { value: modelTarget.texture },
      uModelDepth: { value: modelTarget.depthTexture },
      uPhotoRepeat: { value: new THREE.Vector2(1, 1) },
      uPhotoOffset: { value: new THREE.Vector2(0, 0) },
      uCameraNear: { value: CAMERA_NEAR },
      uCameraFar: { value: CAMERA_FAR },
      uNearDistance: { value: near },
      uFarDistance: { value: far },
      uFeather: { value: 0.04 },
      uDebug: { value: debug ? 1 : 0 },
    };
    uniformsRef.current = uniforms;

    const compositeScene = new THREE.Scene();
    const compositeCamera = new THREE.OrthographicCamera(-1, 1, 1, -1, 0, 1);
    const compositeMaterial = new THREE.ShaderMaterial({
      uniforms,
      vertexShader: COMPOSITE_VERTEX_SHADER,
      fragmentShader: COMPOSITE_FRAGMENT_SHADER,
      depthTest: false,
      depthWrite: false,
    });
    const compositeQuad = new THREE.Mesh(new THREE.PlaneGeometry(2, 2), compositeMaterial);
    compositeQuad.frustumCulled = false;
    compositeScene.add(compositeQuad);

    function render() {
      if (disposed) {
        return;
      }
      renderer.setRenderTarget(modelTarget);
      renderer.setClearColor(0x000000, 0);
      renderer.clear();
      renderer.render(modelScene, camera);

      renderer.setRenderTarget(null);
      renderer.render(compositeScene, compositeCamera);
    }
    renderRef.current = render;

    /** Mirrors CSS `background-size: cover` for both photo and depth map. */
    function fitPhotoUv() {
      const width = mount.clientWidth || 1;
      const height = mount.clientHeight || 1;
      const image = photoTexture?.image;
      if (!(image instanceof HTMLImageElement) || !image.naturalWidth || !image.naturalHeight) {
        return;
      }
      const containerAspect = width / height;
      const imageAspect = image.naturalWidth / image.naturalHeight;
      if (imageAspect > containerAspect) {
        const repeatX = containerAspect / imageAspect;
        uniforms.uPhotoRepeat.value.set(repeatX, 1);
        uniforms.uPhotoOffset.value.set((1 - repeatX) / 2, 0);
      } else {
        const repeatY = imageAspect / containerAspect;
        uniforms.uPhotoRepeat.value.set(1, repeatY);
        uniforms.uPhotoOffset.value.set(0, (1 - repeatY) / 2);
      }
    }

    let pendingLoads = 3;
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

    const textureLoader = new THREE.TextureLoader();

    // Sampled raw: the shader decodes the photo itself, and the depth map is
    // data rather than colour so it must not be colour-managed at all.
    textureLoader.load(
      SCENE_IMAGE_URL,
      (texture) => {
        if (disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.NoColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearFilter;
        photoTexture = texture;
        uniforms.uPhoto.value = texture;
        fitPhotoUv();
        finishLoad();
      },
      undefined,
      () => failLoad('無法載入 AR 背景照片。'),
    );

    textureLoader.load(
      SCENE_DEPTH_URL,
      (texture) => {
        if (disposed) {
          texture.dispose();
          return;
        }
        texture.colorSpace = THREE.NoColorSpace;
        texture.wrapS = THREE.ClampToEdgeWrapping;
        texture.wrapT = THREE.ClampToEdgeWrapping;
        texture.minFilter = THREE.LinearFilter;
        texture.generateMipmaps = false;
        photoDepthTexture = texture;
        uniforms.uPhotoDepth.value = texture;
        finishLoad();
      },
      undefined,
      () => failLoad('無法載入 AR 深度圖（scene_depth.png）。'),
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
        modelScene.add(gltf.scene);
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

      model.position.sub(center);
      model.scale.setScalar(scale);
      model.position.multiplyScalar(scale);
      model.position.add(MODEL_OFFSET);
      model.rotation.y = MODEL_ROTATION_Y;
    }

    function resize() {
      const width = mount.clientWidth || 1;
      const height = mount.clientHeight || 1;
      const pixelRatio = Math.min(window.devicePixelRatio, 2);

      camera.aspect = width / height;
      camera.updateProjectionMatrix();
      renderer.setSize(width, height, false);
      modelTarget.setSize(
        Math.max(1, Math.floor(width * pixelRatio)),
        Math.max(1, Math.floor(height * pixelRatio)),
      );
      fitPhotoUv();
      render();
    }

    const resizeObserver = new ResizeObserver(resize);
    resizeObserver.observe(mount);
    resize();

    return () => {
      disposed = true;
      uniformsRef.current = null;
      renderRef.current = null;
      resizeObserver.disconnect();
      modelScene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          disposeMaterial(object.material);
        }
      });
      compositeQuad.geometry.dispose();
      compositeMaterial.dispose();
      modelTarget.dispose();
      depthTexture.dispose();
      photoTexture?.dispose();
      photoDepthTexture?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [modelUrl]);

  // Live calibration: push slider values into the shader and redraw.
  useEffect(() => {
    const uniforms = uniformsRef.current;
    if (!uniforms) {
      return;
    }
    uniforms.uNearDistance.value = near;
    uniforms.uFarDistance.value = far;
    uniforms.uDebug.value = debug ? 1 : 0;
    renderRef.current?.();
  }, [near, far, debug]);

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
        AR Preview（Demo：固定機位、逐像素深度遮擋）
      </div>
      {isLoading && <div className="viewer-overlay">Loading AR preview...</div>}
      {error && <div className="viewer-error">{error}</div>}
      <div ref={containerRef} className="three-canvas" aria-label="AR preview of the generated 3D asset" />
      {calibrationUI && (
        <div className="ar-preview-calibration">
          <label>
            近 {near.toFixed(2)}
            <input
              type="range"
              min={0.5}
              max={8}
              step={0.05}
              value={near}
              onChange={(event) => setNear(Number(event.target.value))}
            />
          </label>
          <label>
            遠 {far.toFixed(1)}
            <input
              type="range"
              min={4}
              max={40}
              step={0.5}
              value={far}
              onChange={(event) => setFar(Number(event.target.value))}
            />
          </label>
          <label className="ar-preview-calibration-toggle">
            <input type="checkbox" checked={debug} onChange={(event) => setDebug(event.target.checked)} />
            標示被遮擋像素
          </label>
        </div>
      )}
    </div>
  );
}

// No continuous rAF loop: this is a static shot, so render() only runs after
// each async load, on resize, and when a calibration value changes.

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
