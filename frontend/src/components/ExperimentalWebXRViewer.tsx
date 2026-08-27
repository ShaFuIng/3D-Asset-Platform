import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';

type ExperimentalWebXRViewerProps = {
  arScale: number;
  onClose: () => void;
  src: string;
};

type XrErrorKind =
  | 'glb-load-failed'
  | 'webxr-unsupported'
  | 'permission-denied'
  | 'hit-test-unavailable'
  | 'session-ended';

type PlacementState = 'loading-model' | 'starting-xr' | 'scanning' | 'ready' | 'placed' | 'error';

type StableSample = {
  normal: THREE.Vector3;
  position: THREE.Vector3;
  time: number;
};

type HitPoseSnapshot = {
  matrix: THREE.Matrix4;
  normal: THREE.Vector3;
  position: THREE.Vector3;
  transform: XRRigidTransform;
};

type StableHitPose = HitPoseSnapshot & {
  sourceResult?: AnchorCapableHitResult;
};

type XrNavigator = Navigator & {
  xr?: {
    isSessionSupported?: (mode: XRSessionMode) => Promise<boolean>;
    requestSession?: (mode: XRSessionMode, options?: XRSessionInit) => Promise<XRSession>;
  };
};

type AnchorCapableHitResult = XRHitTestResult & {
  createAnchor?: (pose: XRRigidTransform) => Promise<XRAnchor>;
};

type AnchorCapableFrame = XRFrame & {
  trackedAnchors?: Set<XRAnchor>;
};

type XrFeatureName = 'hit-test' | 'anchors' | 'dom-overlay' | 'light-estimation';

const REQUIRED_FEATURES: XrFeatureName[] = ['hit-test'];
const OPTIONAL_FEATURES: XrFeatureName[] = ['anchors', 'dom-overlay', 'light-estimation'];
const STABLE_MIN_FRAMES = 12;
const STABLE_MIN_DURATION_MS = 550;
const STABLE_POSITION_JITTER_METERS = 0.025;
const STABLE_NORMAL_DOT_THRESHOLD = Math.cos(THREE.MathUtils.degToRad(10));
const HORIZONTAL_NORMAL_DOT_THRESHOLD = Math.cos(THREE.MathUtils.degToRad(18));
const RETICLE_RADIUS_METERS = 0.09;
const RETICLE_TUBE_METERS = 0.003;
const MODEL_NEAR_CLIP = 0.01;
const MODEL_FAR_CLIP = 30;
const GLB_LOAD_TIMEOUT_MS = 30000;
const MATERIAL_TEXTURE_KEYS = [
  'map',
  'normalMap',
  'roughnessMap',
  'metalnessMap',
  'emissiveMap',
  'aoMap',
  'alphaMap',
  'bumpMap',
  'displacementMap',
  'envMap',
  'lightMap',
  'specularMap',
] as const;
const ERROR_MESSAGES: Record<XrErrorKind, string> = {
  'glb-load-failed': 'GLB 載入失敗或逾時，無法進入實驗 WebXR 放置模式。',
  'webxr-unsupported': '此裝置不支援 WebXR AR。請使用 Android Chrome、ARCore 與 HTTPS。',
  'permission-denied': 'WebXR 權限被拒絕，請確認相機/AR 權限後再試。',
  'hit-test-unavailable': 'WebXR hit-test 不可用，無法穩定偵測放置表面。',
  'session-ended': 'WebXR session 已結束。',
};

export function ExperimentalWebXRViewer({ arScale, onClose, src }: ExperimentalWebXRViewerProps) {
  const overlayRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<ExperimentalRuntime | null>(null);
  const stableHitRef = useRef<StableHitPose | null>(null);
  const stableSamplesRef = useRef<StableSample[]>([]);
  const placedRef = useRef(false);
  const closeRequestedRef = useRef(false);
  const mountedRef = useRef(true);
  const isStableRef = useRef(false);
  const placementStateRef = useRef<PlacementState>('loading-model');
  const placeModelRef = useRef<() => void>(() => {});
  const [placementState, setPlacementState] = useState<PlacementState>('loading-model');
  const [errorKind, setErrorKind] = useState<XrErrorKind | null>(null);
  const [statusMessage, setStatusMessage] = useState('正在載入 GLB...');
  const [isStable, setIsStable] = useState(false);

  useEffect(() => {
    return () => {
      mountedRef.current = false;
    };
  }, []);

  useEffect(() => {
    const overlayElement = overlayRef.current;
    if (!overlayElement) {
      return;
    }
    const overlayRoot = overlayElement;

    let cancelled = false;
    let unmounted = false;

    async function start() {
      if (!window.isSecureContext) {
        showError('webxr-unsupported');
        return;
      }

      const xr = (navigator as XrNavigator).xr;
      if (!xr?.isSessionSupported || !xr.requestSession) {
        showError('webxr-unsupported');
        return;
      }

      let supported = false;
      try {
        supported = await xr.isSessionSupported('immersive-ar');
      } catch {
        if (cancelled || !mountedRef.current) {
          return;
        }
        showError('webxr-unsupported');
        return;
      }

      if (cancelled || !mountedRef.current) {
        return;
      }

      if (!supported) {
        showError('webxr-unsupported');
        return;
      }

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(70, 1, MODEL_NEAR_CLIP, MODEL_FAR_CLIP);
      const renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.xr.enabled = true;
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
      renderer.setSize(window.innerWidth, window.innerHeight, false);
      overlayRoot.appendChild(renderer.domElement);

      const reticle = createReticle();
      scene.add(reticle);
      addLights(scene);

      const placementGroup = new THREE.Group();
      placementGroup.visible = false;
      placementGroup.scale.setScalar(arScale);
      scene.add(placementGroup);

      const runtime: ExperimentalRuntime = {
        anchor: null,
        camera,
        canvas: renderer.domElement,
        hitTestSource: null,
        placementGroup,
        renderer,
        reticle,
        scene,
        session: null,
        disposed: false,
      };
      runtimeRef.current = runtime;

      try {
        const model = await loadAlignedModel(src, GLB_LOAD_TIMEOUT_MS);
        if (cancelled || !mountedRef.current) {
          disposeObject(model);
          cleanupRuntime(runtime);
          return;
        }
        placementGroup.add(model);
      } catch {
        cleanupRuntime(runtime);
        if (cancelled || !mountedRef.current) {
          return;
        }
        showError('glb-load-failed');
        return;
      }

      setPlacementStateSafe('starting-xr');
      setStatusMessageSafe('正在啟動 WebXR...');

      let session: XRSession;
      try {
        session = await xr.requestSession('immersive-ar', {
          requiredFeatures: REQUIRED_FEATURES,
          optionalFeatures: OPTIONAL_FEATURES,
          domOverlay: { root: overlayRoot },
        });
      } catch (error) {
        cleanupRuntime(runtime);
        if (cancelled || !mountedRef.current) {
          return;
        }
        showError(isPermissionError(error) ? 'permission-denied' : 'webxr-unsupported');
        return;
      }

      if (cancelled || !mountedRef.current) {
        await safeEndSession(session);
        cleanupRuntime(runtime);
        return;
      }

      runtime.session = session;
      session.addEventListener('end', handleSessionEnd);
      session.addEventListener('select', handleSelect);
      overlayRoot.addEventListener('beforexrselect', handleBeforeXrSelect);
      window.addEventListener('resize', handleResize);

      try {
        renderer.xr.setReferenceSpaceType('local');
        await renderer.xr.setSession(session);
        if (cancelled || !mountedRef.current) {
          await safeEndSession(session);
          cleanupRuntime(runtime);
          return;
        }
        const viewerSpace = await session.requestReferenceSpace('viewer');
        const localSpace = await session.requestReferenceSpace('local');
        const hitTestSource = await session.requestHitTestSource?.({ space: viewerSpace });
        if (!hitTestSource) {
          throw new Error('hit-test unavailable');
        }
        runtime.hitTestSource = hitTestSource;
        setPlacementStateSafe('scanning');
        setStatusMessageSafe('請對準接近水平的表面，等待 reticle 穩定後再確認放置。');

        renderer.setAnimationLoop((time, frame) => {
          if (!frame) {
            return;
          }
          updateFrame(runtime, frame, localSpace, time);
          renderer.render(scene, camera);
        });
      } catch {
        if (cancelled || !mountedRef.current) {
          return;
        }
        showError('hit-test-unavailable');
        await safeEndSession(session);
      }
    }

    function updateFrame(
      runtime: ExperimentalRuntime,
      frame: XRFrame,
      localSpace: XRReferenceSpace,
      time: number,
    ) {
      const anchorPose = getAnchorPose(runtime.anchor, frame as AnchorCapableFrame, localSpace);
      if (anchorPose && placedRef.current) {
        runtime.placementGroup.matrix.fromArray(anchorPose.transform.matrix);
        runtime.placementGroup.matrix.decompose(
          runtime.placementGroup.position,
          runtime.placementGroup.quaternion,
          runtime.placementGroup.scale,
        );
        runtime.placementGroup.scale.setScalar(arScale);
      }

      if (placedRef.current || !runtime.hitTestSource) {
        runtime.reticle.visible = false;
        return;
      }

      const results = frame.getHitTestResults(runtime.hitTestSource);
      if (results.length === 0) {
        stableHitRef.current = null;
        stableSamplesRef.current = [];
        runtime.reticle.visible = false;
        setStable(false);
        setStatusMessageSafe('尚未偵測到可放置表面。');
        return;
      }

      const pose = results[0].getPose(localSpace);
      if (!pose) {
        stableHitRef.current = null;
        runtime.reticle.visible = false;
        setStable(false);
        return;
      }

      const snapshot = createHitPoseSnapshot(pose);
      const isHorizontal = snapshot.normal.dot(WORLD_UP) >= HORIZONTAL_NORMAL_DOT_THRESHOLD;
      const hitSnapshot: StableHitPose = {
        ...snapshot,
        sourceResult: results[0] as AnchorCapableHitResult,
      };

      runtime.reticle.matrix.copy(snapshot.matrix);
      runtime.reticle.visible = isHorizontal;

      if (!isHorizontal) {
        stableHitRef.current = null;
        stableSamplesRef.current = [];
        setStable(false);
        setPlacementStateSafe('scanning');
        setStatusMessageSafe('目前表面傾斜過大；請對準桌面或地面。');
        return;
      }

      const stable = updateStability(snapshot, time, stableSamplesRef.current);
      stableHitRef.current = stable ? hitSnapshot : null;
      setStable(stable);
      setPlacementStateSafe(stable ? 'ready' : 'scanning');
      setStatusMessageSafe(stable ? 'Surface hit 已穩定，可以確認放置。' : '正在等待 Surface hit 穩定...');
    }

    function handleSelect() {
      placeModelRef.current();
    }

    function handleBeforeXrSelect(event: Event) {
      if (isOverlayControlEvent(event)) {
        event.preventDefault();
      }
    }

    function handleResize() {
      const runtime = runtimeRef.current;
      if (!runtime) {
        return;
      }
      runtime.renderer.setSize(window.innerWidth, window.innerHeight, false);
    }

    function handleSessionEnd() {
      const wasClosing = closeRequestedRef.current || unmounted;
      cleanupRuntime(runtimeRef.current);
      if (!wasClosing) {
        showError('session-ended');
      }
    }

    function showError(kind: XrErrorKind) {
      if (!mountedRef.current) {
        return;
      }
      setErrorKind(kind);
      setPlacementStateSafe('error');
      setStatusMessageSafe(ERROR_MESSAGES[kind]);
    }

    start();

    return () => {
      unmounted = true;
      cancelled = true;
      window.removeEventListener('resize', handleResize);
      overlayRoot.removeEventListener('beforexrselect', handleBeforeXrSelect);
      const runtime = runtimeRef.current;
      if (runtime?.session) {
        runtime.session.removeEventListener('end', handleSessionEnd);
        runtime.session.removeEventListener('select', handleSelect);
        void safeEndSession(runtime.session);
      }
      cleanupRuntime(runtime);
    };
  }, [arScale, src]);

  function setStable(nextStable: boolean) {
    isStableRef.current = nextStable;
    if (mountedRef.current) {
      setIsStable((current) => (current === nextStable ? current : nextStable));
    }
  }

  function setPlacementStateSafe(nextState: PlacementState) {
    placementStateRef.current = nextState;
    if (mountedRef.current) {
      setPlacementState(nextState);
    }
  }

  function setStatusMessageSafe(nextMessage: string) {
    if (mountedRef.current) {
      setStatusMessage(nextMessage);
    }
  }

  async function placeModel() {
    const runtime = runtimeRef.current;
    const hit = stableHitRef.current;
    if (
      !runtime ||
      !hit ||
      placedRef.current ||
      !isStableRef.current ||
      placementStateRef.current !== 'ready'
    ) {
      return;
    }

    placedRef.current = true;
    runtime.placementGroup.matrix.copy(hit.matrix);
    runtime.placementGroup.matrix.decompose(
      runtime.placementGroup.position,
      runtime.placementGroup.quaternion,
      runtime.placementGroup.scale,
    );
    runtime.placementGroup.scale.setScalar(arScale);
    runtime.placementGroup.visible = true;
    runtime.reticle.visible = false;
    stableSamplesRef.current = [];
    stableHitRef.current = null;
    setPlacementStateSafe('placed');
    setStatusMessageSafe('模型已固定；可重新放置或離開實驗模式。');

    if (hit.sourceResult?.createAnchor) {
      try {
        const anchor = await hit.sourceResult.createAnchor(hit.transform);
        if (!mountedRef.current || !placedRef.current) {
          safeDeleteAnchor(anchor);
          return;
        }
        runtime.anchor = anchor;
      } catch {
        runtime.anchor = null;
      }
    }
  }

  function resetPlacement(event?: React.MouseEvent<HTMLButtonElement>) {
    event?.preventDefault();
    event?.stopPropagation();
    const runtime = runtimeRef.current;
    if (runtime?.anchor) {
      safeDeleteAnchor(runtime.anchor);
      runtime.anchor = null;
    }
    if (runtime) {
      runtime.placementGroup.visible = false;
    }
    placedRef.current = false;
    stableHitRef.current = null;
    stableSamplesRef.current = [];
    setStable(false);
    setPlacementStateSafe('scanning');
    setStatusMessageSafe('請重新對準接近水平的表面。');
  }

  function handleClose(event?: React.MouseEvent<HTMLButtonElement>) {
    event?.preventDefault();
    event?.stopPropagation();
    closeRequestedRef.current = true;
    const runtime = runtimeRef.current;
    if (runtime?.session) {
      void safeEndSession(runtime.session).finally(onClose);
      return;
    }
    onClose();
  }

  const canPlace = placementState === 'ready' && isStable;
  placeModelRef.current = placeModel;

  return (
    <div ref={overlayRef} className="experimental-xr-overlay">
      <div className="experimental-xr-status" data-state={placementState}>
        <strong>Experimental WebXR Viewer</strong>
            <span>{statusMessage}</span>
        <small>Android Chrome / ARCore / HTTPS。穩定 Surface Hit + 使用者確認放置，不代表完整平面掃描。</small>
        {errorKind && <small className="experimental-xr-error">{ERROR_MESSAGES[errorKind]}</small>}
      </div>
      <div className="experimental-xr-reticle-label" data-ready={canPlace}>
        {getReticleLabel(placementState, canPlace)}
      </div>
      <div className="experimental-xr-controls" data-xr-overlay-control="true">
        <button type="button" disabled={!canPlace} onClick={placeModel}>
          確認放置
        </button>
        <button type="button" disabled={placementState !== 'placed'} onClick={resetPlacement}>
          重新放置
        </button>
        <button type="button" onClick={handleClose}>
          離開
        </button>
      </div>
    </div>
  );
}

type ExperimentalRuntime = {
  anchor: XRAnchor | null;
  camera: THREE.PerspectiveCamera;
  canvas: HTMLCanvasElement;
  disposed: boolean;
  hitTestSource: XRHitTestSource | null;
  placementGroup: THREE.Group;
  renderer: THREE.WebGLRenderer;
  reticle: THREE.Mesh;
  scene: THREE.Scene;
  session: XRSession | null;
};

const WORLD_UP = new THREE.Vector3(0, 1, 0);

function createReticle() {
  const geometry = new THREE.RingGeometry(
    RETICLE_RADIUS_METERS - RETICLE_TUBE_METERS,
    RETICLE_RADIUS_METERS,
    48,
  );
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshBasicMaterial({
    color: 0x2fd4c4,
    transparent: true,
    opacity: 0.9,
    side: THREE.DoubleSide,
  });
  const reticle = new THREE.Mesh(geometry, material);
  reticle.matrixAutoUpdate = false;
  reticle.visible = false;
  return reticle;
}

function addLights(scene: THREE.Scene) {
  scene.add(new THREE.HemisphereLight(0xffffff, 0x46515b, 1.2));
  const key = new THREE.DirectionalLight(0xffffff, 1.8);
  key.position.set(1, 4, 2);
  scene.add(key);
}

async function loadAlignedModel(src: string, timeoutMs: number) {
  const loader = new GLTFLoader();
  const gltf = await withTimeout(loader.loadAsync(src), timeoutMs);
  const model = gltf.scene;
  const box = new THREE.Box3().setFromObject(model);
  const center = box.getCenter(new THREE.Vector3());
  model.position.x -= center.x;
  model.position.y -= box.min.y;
  model.position.z -= center.z;
  model.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = false;
      object.receiveShadow = false;
    }
  });
  return model;
}

function withTimeout<T>(promise: Promise<T>, timeoutMs: number): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeoutId = window.setTimeout(() => {
      reject(new Error(`Timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    promise
      .then((value) => {
        window.clearTimeout(timeoutId);
        resolve(value);
      })
      .catch((error: unknown) => {
        window.clearTimeout(timeoutId);
        reject(error);
      });
  });
}

function getReticleLabel(placementState: PlacementState, canPlace: boolean) {
  if (placementState === 'loading-model') {
    return 'Loading GLB';
  }
  if (placementState === 'starting-xr') {
    return 'Starting AR';
  }
  if (placementState === 'placed') {
    return 'Placed';
  }
  if (placementState === 'error') {
    return 'Error';
  }
  return canPlace ? 'Ready' : 'Scanning';
}

function createHitPoseSnapshot(pose: XRPose): HitPoseSnapshot {
  const matrix = new THREE.Matrix4().fromArray(pose.transform.matrix);
  const position = new THREE.Vector3();
  const quaternion = new THREE.Quaternion();
  const scale = new THREE.Vector3();
  matrix.decompose(position, quaternion, scale);
  const normal = WORLD_UP.clone().applyQuaternion(quaternion).normalize();
  return {
    matrix,
    normal,
    position,
    transform: pose.transform,
  };
}

function updateStability(snapshot: HitPoseSnapshot, time: number, samples: StableSample[]) {
  samples.push({
    normal: snapshot.normal.clone(),
    position: snapshot.position.clone(),
    time,
  });

  while (samples.length > STABLE_MIN_FRAMES && time - samples[0].time > STABLE_MIN_DURATION_MS) {
    samples.shift();
  }

  if (samples.length < STABLE_MIN_FRAMES) {
    return false;
  }

  const duration = samples[samples.length - 1].time - samples[0].time;
  if (duration < STABLE_MIN_DURATION_MS) {
    return false;
  }

  const referencePosition = samples[0].position;
  const referenceNormal = samples[0].normal;
  return samples.every(
    (sample) =>
      sample.position.distanceTo(referencePosition) <= STABLE_POSITION_JITTER_METERS &&
      sample.normal.dot(referenceNormal) >= STABLE_NORMAL_DOT_THRESHOLD,
  );
}

function getAnchorPose(anchor: XRAnchor | null, frame: AnchorCapableFrame, referenceSpace: XRReferenceSpace) {
  if (!anchor || !frame.trackedAnchors?.has(anchor)) {
    return null;
  }
  return frame.getPose(anchor.anchorSpace, referenceSpace);
}

function isPermissionError(error: unknown) {
  return error instanceof DOMException && (error.name === 'NotAllowedError' || error.name === 'SecurityError');
}

function isOverlayControlEvent(event: Event) {
  const composedPath = event.composedPath();
  return composedPath.some(
    (target) => target instanceof HTMLElement && target.dataset.xrOverlayControl === 'true',
  );
}

function cleanupRuntime(runtime: ExperimentalRuntime | null) {
  if (!runtime || runtime.disposed) {
    return;
  }
  runtime.disposed = true;
  runtime.renderer.setAnimationLoop(null);
  runtime.hitTestSource?.cancel();
  runtime.hitTestSource = null;
  if (runtime.anchor) {
    safeDeleteAnchor(runtime.anchor);
    runtime.anchor = null;
  }
  disposeObject(runtime.scene);
  runtime.renderer.dispose();
  runtime.canvas.remove();
}

async function safeEndSession(session: XRSession) {
  try {
    await session.end();
  } catch {
    // Session may already be ended.
  }
}

function safeDeleteAnchor(anchor: XRAnchor) {
  try {
    anchor.delete();
  } catch {
    // Anchor may already be deleted by the UA.
  }
}

function disposeObject(object: THREE.Object3D) {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      child.geometry.dispose();
      disposeMaterial(child.material);
    }
  });
}

function disposeMaterial(material: THREE.Material | THREE.Material[]) {
  if (Array.isArray(material)) {
    material.forEach((item) => disposeMaterial(item));
    return;
  }
  const materialWithTextures = material as THREE.Material & Partial<Record<(typeof MATERIAL_TEXTURE_KEYS)[number], unknown>>;
  MATERIAL_TEXTURE_KEYS.forEach((key) => {
    const texture = materialWithTextures[key];
    if (texture instanceof THREE.Texture) {
      texture.dispose();
    }
  });
  material.dispose();
}
