import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { resolveApiUrl } from '../api/client';

/*
 * AR preview (demo): composites the generated GLB into a real photo.
 *
 * Occlusion model — the character sits at ONE depth in the scene, and every
 * photo pixel nearer than that depth covers it:
 *
 *     depth(photo pixel) > characterDepth  ->  the photo wins (occlusion)
 *
 * scene_depth.png comes from Depth Anything V2, where BRIGHT = NEAR, so a
 * larger greyscale value means closer to the camera. characterDepth is on
 * that same 0..1 greyscale scale: raise it and the character walks toward
 * the camera (in front of the bottle), lower it and the character retreats
 * behind the bottle, the mug, the laptop, and so on.
 *
 * Why not compare against the model's own per-pixel depth buffer: the model
 * is a 3D object, so its depth varies across its surface, and a monocular
 * depth map varies smoothly too. Subtracting the two gives a slowly varying
 * difference across the whole model, which dissolves it in a soft gradient
 * instead of cutting it cleanly along the bottle's edge. Treating the
 * character as a single depth keeps the occlusion edge hard, which is what
 * actually reads as "standing behind that object".
 *
 * CONTROLLED COMPONENT: this component owns no placement state of its own.
 * Every placement value (position/size/rotation/depth/debug) is a prop, and
 * the caller (e.g. ARStudioPage) is expected to own the actual <input>
 * sliders and render them WHEREVER it wants in its own layout — this
 * component only ever renders the photo+model canvas, nothing overlaid on
 * top of it. Re-exports DEFAULT_* below so callers have a single source of
 * truth for the tuned starting values instead of duplicating magic numbers.
 *
 * Camera is fixed (no OrbitControls) — this is a still "photo mockup" shot.
 * scene_mask.png is no longer used by this component.
 */

type ARPreviewProps = {
  modelUrl?: string;
  // Optional, not required: callers that don't care about placement (e.g.
  // ViewerStagePage's quick "3D / AR" toggle, which only ever passes
  // modelUrl) get the tuned demo defaults for free. Callers that DO care
  // (ARStudioPage, DevARPreviewPage) pass explicit values from their own
  // slider state.
  positionX?: number;
  positionY?: number;
  size?: number;
  rotationDeg?: number;
  /** 0..1 on scene_depth.png's greyscale scale (1 = right up against the lens). */
  characterDepth?: number;
  /** Tints occluded pixels red so the depth cut is obvious. */
  debugOcclusion?: boolean;
};

const SCENE_IMAGE_URL = resolveApiUrl('/api/demo-assets/ar-preview/scene.png');
const SCENE_DEPTH_URL = resolveApiUrl('/api/demo-assets/ar-preview/scene_depth.png');

// Fixed "camera" for the demo shot.
const CAMERA_FOV_DEG = 45;
const CAMERA_DISTANCE = 4; // camera sits at (0, 0, CAMERA_DISTANCE), looking at the origin.

// Tuned starting values — the single source of truth for callers' initial
// slider state. Re-tune in the UI, then paste the final numbers back here.
export const DEFAULT_POSITION_X = 1.2;
export const DEFAULT_POSITION_Y = -0.5;
export const DEFAULT_SIZE = 1.8;
export const DEFAULT_ROTATION_DEG = 25;
export const DEFAULT_CHARACTER_DEPTH = 0.55;

const COMPOSITE_VERTEX_SHADER = /* glsl */ `
  varying vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = vec4(position.xy, 0.0, 1.0);
  }
`;

const COMPOSITE_FRAGMENT_SHADER = /* glsl */ `
  uniform sampler2D uPhoto;
  uniform sampler2D uPhotoDepth;
  uniform sampler2D uModelColor;
  uniform vec2 uPhotoRepeat;
  uniform vec2 uPhotoOffset;
  uniform float uCharacterDepth;
  uniform float uFeather;
  uniform float uDebug;

  varying vec2 vUv;

  // The photo and depth PNGs are sampled raw (colorSpace = NoColorSpace) so
  // the depth values stay untouched; the photo therefore needs decoding here.
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

    // Bright = near. Anything brighter than the character's own depth is in
    // front of it. uFeather is only wide enough to anti-alias the edge.
    float grey = texture2D(uPhotoDepth, photoUv).r;
    float occlusion = smoothstep(
      uCharacterDepth - uFeather,
      uCharacterDepth + uFeather,
      grey
    );

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
  positionX = DEFAULT_POSITION_X,
  positionY = DEFAULT_POSITION_Y,
  size = DEFAULT_SIZE,
  rotationDeg = DEFAULT_ROTATION_DEG,
  characterDepth = DEFAULT_CHARACTER_DEPTH,
  debugOcclusion = false,
}: ARPreviewProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const renderRef = useRef<(() => void) | null>(null);
  const applyTransformRef = useRef<
    ((x: number, y: number, targetSize: number, rotation: number) => void) | null
  >(null);

  // Built once, mutated in place, handed straight to the ShaderMaterial — so
  // the prop-sync effects below can always reach live uniforms regardless of
  // when the WebGL effect happens to run.
  const uniformsRef = useRef<Record<string, THREE.IUniform>>({
    uPhoto: { value: null },
    uPhotoDepth: { value: null },
    uModelColor: { value: null },
    uPhotoRepeat: { value: new THREE.Vector2(1, 1) },
    uPhotoOffset: { value: new THREE.Vector2(0, 0) },
    uCharacterDepth: { value: characterDepth },
    uFeather: { value: 0.012 },
    uDebug: { value: debugOcclusion ? 1 : 0 },
  });

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
    const uniforms = uniformsRef.current;

    let disposed = false;
    let photoTexture: THREE.Texture | null = null;
    let photoDepthTexture: THREE.Texture | null = null;
    let model: THREE.Object3D | null = null;
    // Measured once from the raw GLB so every transform is recomputed from
    // scratch rather than accumulated on top of the previous one.
    const modelCenter = new THREE.Vector3();
    let modelMaxDimension = 1;

    setIsLoading(true);
    setError(null);

    // --- Pass 1: the model alone, into a transparent render target -------
    const modelScene = new THREE.Scene();
    addPreviewLights(modelScene);

    const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEG, 1, 0.01, 1000);
    camera.position.set(0, 0, CAMERA_DISTANCE);
    camera.lookAt(0, 0, 0);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = false;
    mount.appendChild(renderer.domElement);

    const modelTarget = new THREE.WebGLRenderTarget(1, 1, {
      depthBuffer: true,
      stencilBuffer: false,
    });
    uniforms.uModelColor.value = modelTarget.texture;

    // --- Pass 2: full-screen composite -----------------------------------
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

    function applyTransform(x: number, y: number, targetSize: number, rotation: number) {
      if (!model) {
        return;
      }
      if (![x, y, targetSize, rotation].every(Number.isFinite)) {
        return; // Guard against NaN reaching model.position/scale.
      }
      const scale = targetSize / modelMaxDimension;
      // Always rebuilt from the measured original, never incremented.
      model.scale.setScalar(scale);
      model.position.copy(modelCenter).multiplyScalar(-scale).add(new THREE.Vector3(x, y, 0));
      model.rotation.set(0, THREE.MathUtils.degToRad(rotation), 0);
    }
    applyTransformRef.current = applyTransform;

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
        // Depth is data, not colour: no colour management, no mipmaps.
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
        const box = new THREE.Box3().setFromObject(gltf.scene);
        box.getCenter(modelCenter);
        const measured = box.getSize(new THREE.Vector3());
        modelMaxDimension = Math.max(measured.x, measured.y, measured.z) || 1;

        model = gltf.scene;
        modelScene.add(model);
        // Use the props' CURRENT values (via closure over the effect's own
        // scope is wrong here since this callback can fire after props
        // change — read from the refs updated by the prop-sync effect below
        // is not possible yet on first load, so apply the values this
        // effect closed over; the prop-sync effect will immediately correct
        // it if a change happened in between).
        applyTransform(positionX, positionY, size, rotationDeg);
        finishLoad();
      },
      undefined,
      () => failLoad('無法載入這個 GLB 模型。'),
    );

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
      renderRef.current = null;
      applyTransformRef.current = null;
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
      photoTexture?.dispose();
      photoDepthTexture?.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    };
    // Only modelUrl rebuilds the WebGL scene; prop changes below are pushed
    // in through the refs so the GLB is never re-downloaded on every drag.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [modelUrl]);

  // Placement props -> re-apply transform (no GLB reload).
  useEffect(() => {
    applyTransformRef.current?.(positionX, positionY, size, rotationDeg);
    renderRef.current?.();
  }, [positionX, positionY, size, rotationDeg]);

  // Depth/debug props -> push straight into the shader uniforms.
  useEffect(() => {
    uniformsRef.current.uCharacterDepth.value = characterDepth;
    uniformsRef.current.uDebug.value = debugOcclusion ? 1 : 0;
    renderRef.current?.();
  }, [characterDepth, debugOcclusion]);

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
        AR Preview（Demo：固定機位、深度遮擋）
      </div>
      {isLoading && <div className="viewer-overlay">Loading AR preview...</div>}
      {error && <div className="viewer-error">{error}</div>}
      <div ref={containerRef} className="three-canvas" aria-label="AR preview of the generated 3D asset" />
    </div>
  );
}

// No continuous rAF loop: this is a static shot, so render() only runs after
// each async load, on resize, and when a placement/depth prop changes.

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
