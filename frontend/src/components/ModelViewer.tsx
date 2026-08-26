import { useEffect, useRef, useState } from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
// Registers the <model-viewer> custom element used by the "View in AR" panel below.
import '@google/model-viewer';
import { ApiClientError, calibrateAsset, resolveApiUrl } from '../api/client';
import type { LibraryAsset } from '../types/api';

/*
 * Multi-directional lighting and inspection modes are adapted from
 * ComfyUI Frontend's Load3D viewer (GPL-3.0), modified on 2026-07-31
 * for this React-based 3D asset viewer.
 */

type ModelViewerProps = {
  src?: string;
  /**
   * Endpoint that serves this model's USDZ for iOS AR Quick Look, e.g.
   * `GET /api/3d/jobs/{job_id}/usdz` or
   * `GET /api/multiview/jobs/{job_id}/models/{kind}/usdz`. The backend
   * converts + caches on first hit (see blender_client.py), so this is
   * safe to fetch on every "在 AR 中檢視" click. Optional — without it,
   * iOS AR Quick Look stays unavailable and only Android Scene Viewer
   * (which only needs `src`) works.
   */
  usdzUrl?: string;
  /**
   * The *raw* library asset's id — used to call the calibrate/STL
   * endpoints regardless of whether `src` above currently points at the
   * raw GLB or an already-calibrated one. Calibration status is fetched
   * by the caller (see useAssetCalibration), not by this component —
   * ModelViewer stays purely props-driven.
   */
  assetId?: string;
  /** Whether `src` is currently showing a calibrated (real-world-scale) GLB. */
  isCalibrated?: boolean;
  /** Called after a successful calibrate call, so the caller can refresh
   * its own calibration state and hand back a new `src`/`isCalibrated`. */
  onCalibrated?: (calibrated: LibraryAsset) => void;
};

const CALIBRATION_PRESETS = [
  { label: '小', cm: 5 },
  { label: '中', cm: 15 },
  { label: '大', cm: 30 },
];

function getErrorMessage(error: unknown): string {
  if (error instanceof DOMException && error.name === 'AbortError') {
    return '';
  }
  if (error instanceof ApiClientError || error instanceof Error) {
    return error.message;
  }
  return '校正失敗，請稍後再試。';
}

// model-viewer's element type isn't exported in a way our JSX declaration
// can reuse directly; this is just enough to call the one imperative method
// we need.
type ModelViewerElement = HTMLElement & { activateAR: () => Promise<void> };

function isIOSDevice(): boolean {
  if (typeof navigator === 'undefined') {
    return false;
  }
  const isClassicIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
  // iPadOS 13+ reports as "MacIntel" in the UA; touch support is the tell.
  const isModernIPad = navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1;
  return isClassicIOS || isModernIPad;
}

type MaterialMode = 'original' | 'clay' | 'normal' | 'wireframe';

type ModelStats = {
  meshes: number;
  vertices: number;
  triangles: number;
};

type ViewerRuntime = {
  axesHelper: THREE.AxesHelper;
  controls: OrbitControls;
  gridHelper: THREE.GridHelper;
  model: THREE.Object3D | null;
  originalMaterials: Map<THREE.Mesh, THREE.Material | THREE.Material[]>;
  replacementMaterials: Set<THREE.Material>;
  resetView: (() => void) | null;
};

const EMPTY_STATS: ModelStats = {
  meshes: 0,
  vertices: 0,
  triangles: 0,
};

export function ModelViewer({ src, usdzUrl, assetId, isCalibrated, onCalibrated }: ModelViewerProps) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const runtimeRef = useRef<ViewerRuntime | null>(null);
  const materialModeRef = useRef<MaterialMode>('original');
  const arModelViewerRef = useRef<HTMLElement | null>(null);
  const [isLoading, setIsLoading] = useState(Boolean(src));
  const [error, setError] = useState<string | null>(null);
  const [materialMode, setMaterialMode] = useState<MaterialMode>('original');
  const [showGrid, setShowGrid] = useState(true);
  const [autoRotate, setAutoRotate] = useState(false);
  const [stats, setStats] = useState<ModelStats>(EMPTY_STATS);
  // Level 1 real-AR panel (native <model-viewer> AR, separate from the
  // shader-based AR Preview on kila606/ar-preview-demo). Off by default so
  // the extra <model-viewer> element only mounts when actually requested.
  const [arOpen, setArOpen] = useState(false);
  // Real-world-size calibration (Phase 6): replaces the old manual arScale
  // fudge-factor input entirely — see the calibration panel below, which is
  // shown as soon as a GLB is loaded, independent of arOpen.
  const [targetCm, setTargetCm] = useState(CALIBRATION_PRESETS[1].cm);
  const [isSaving, setIsSaving] = useState(false);
  const [calibrationError, setCalibrationError] = useState<string | null>(null);
  // iOS Quick Look needs a USDZ, which the backend only converts on demand
  // (see `usdzUrl` above). `resolvedIosSrc` is set once that fetch
  // succeeds, so re-clicking within the same session skips straight to
  // activateAR() instead of hitting the endpoint again.
  const [resolvedIosSrc, setResolvedIosSrc] = useState<string | null>(null);
  const [iosUsdzState, setIosUsdzState] = useState<'idle' | 'loading' | 'error'>('idle');
  const [iosUsdzErrorMessage, setIosUsdzErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    materialModeRef.current = materialMode;
    const runtime = runtimeRef.current;
    if (runtime?.model) {
      applyMaterialMode(runtime.model, materialMode, runtime);
    }
  }, [materialMode]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime) {
      runtime.gridHelper.visible = showGrid;
      runtime.axesHelper.visible = showGrid;
    }
  }, [showGrid]);

  useEffect(() => {
    const runtime = runtimeRef.current;
    if (runtime) {
      runtime.controls.autoRotate = autoRotate;
    }
  }, [autoRotate]);

  useEffect(() => {
    const container = containerRef.current;
    if (!src || !container) {
      setIsLoading(Boolean(src));
      setError(null);
      setStats(EMPTY_STATS);
      return;
    }
    const mount = container;

    let frameId = 0;
    let disposed = false;
    setIsLoading(true);
    setError(null);
    setStats(EMPTY_STATS);

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x282828);

    const camera = new THREE.PerspectiveCamera(45, 1, 0.01, 1000);
    camera.position.set(2.5, 1.8, 2.5);

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    renderer.shadowMap.enabled = false;
    mount.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.autoRotate = autoRotate;
    controls.autoRotateSpeed = 1.2;

    addInspectionLights(scene);

    const gridHelper = new THREE.GridHelper(20, 20, 0x888888, 0x444444);
    gridHelper.visible = showGrid;
    scene.add(gridHelper);

    const axesHelper = new THREE.AxesHelper(1);
    axesHelper.visible = showGrid;
    scene.add(axesHelper);

    const runtime: ViewerRuntime = {
      axesHelper,
      controls,
      gridHelper,
      model: null,
      originalMaterials: new Map(),
      replacementMaterials: new Set(),
      resetView: null,
    };
    runtimeRef.current = runtime;

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
        runtime.model = model;
        rememberOriginalMaterials(model, runtime.originalMaterials);
        scene.add(model);
        runtime.resetView = frameModel(model, camera, controls, gridHelper, axesHelper);
        setStats(getModelStats(model));
        applyMaterialMode(model, materialModeRef.current, runtime);
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
      disposeReplacementMaterials(runtime);
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh) {
          object.geometry.dispose();
          const originalMaterial = runtime.originalMaterials.get(object);
          if (originalMaterial) {
            disposeMaterial(originalMaterial);
          }
        }
      });
      runtime.originalMaterials.clear();
      gridHelper.geometry.dispose();
      disposeMaterial(gridHelper.material);
      axesHelper.geometry.dispose();
      disposeMaterial(axesHelper.material);
      renderer.dispose();
      renderer.domElement.remove();
      if (runtimeRef.current === runtime) {
        runtimeRef.current = null;
      }
    };
  }, [src]);

  async function handleSaveCalibration() {
    if (!assetId || !Number.isFinite(targetCm) || targetCm <= 0) {
      return;
    }
    setIsSaving(true);
    setCalibrationError(null);
    try {
      const calibrated = await calibrateAsset(assetId, targetCm);
      onCalibrated?.(calibrated);
    } catch (err) {
      setCalibrationError(getErrorMessage(err));
    } finally {
      setIsSaving(false);
    }
  }

  async function handleArButtonClick() {
    const modelViewer = arModelViewerRef.current as ModelViewerElement | null;
    if (!modelViewer) {
      return;
    }

    // Android Scene Viewer only needs `src`, already set on the element —
    // launch immediately, no conversion involved.
    if (!isIOSDevice() || resolvedIosSrc) {
      modelViewer.activateAR().catch(() => {});
      return;
    }

    if (!usdzUrl) {
      setIosUsdzState('error');
      setIosUsdzErrorMessage('此模型尚未支援 iOS AR（缺少 USDZ 轉檔來源）。');
      return;
    }

    setIosUsdzState('loading');
    setIosUsdzErrorMessage(null);
    try {
      const response = await fetch(usdzUrl);
      if (!response.ok) {
        let message = `USDZ 轉檔失敗（HTTP ${response.status}）。`;
        try {
          const body = await response.json();
          if (body?.error?.message) {
            message = body.error.message as string;
          }
        } catch {
          // Response body wasn't JSON; keep the generic message above.
        }
        throw new Error(message);
      }
      // Set the attribute directly first -- React re-render is async, but
      // activateAR() below needs ios-src on the element right now.
      modelViewer.setAttribute('ios-src', usdzUrl);
      setResolvedIosSrc(usdzUrl);
      setIosUsdzState('idle');
      await modelViewer.activateAR();
    } catch (err) {
      setIosUsdzState('error');
      setIosUsdzErrorMessage(err instanceof Error ? err.message : 'USDZ 轉檔失敗，請稍後再試。');
    }
  }

  if (!src) {
    return (
      <div className="viewer-placeholder">
        尚未取得 GLB 模型。完成 3D Job 後會在這裡顯示預覽。
      </div>
    );
  }

  return (
    <div className="viewer-root">
      <div className="viewer-shell">
        <div className="viewer-toolbar" aria-label="3D model inspection controls">
          <label>
            顯示模式
            <select
              value={materialMode}
              onChange={(event) => setMaterialMode(event.target.value as MaterialMode)}
            >
              <option value="original">Original</option>
              <option value="clay">Clay</option>
              <option value="normal">Normal</option>
              <option value="wireframe">Wireframe</option>
            </select>
          </label>
          <button type="button" onClick={() => setShowGrid((current) => !current)}>
            {showGrid ? '隱藏格線' : '顯示格線'}
          </button>
          <button type="button" onClick={() => setAutoRotate((current) => !current)}>
            {autoRotate ? '停止旋轉' : '自動旋轉'}
          </button>
          <button type="button" onClick={() => runtimeRef.current?.resetView?.()}>
            重設視角
          </button>
        </div>
        <div className="viewer-stats" aria-live="polite">
          Meshes {stats.meshes.toLocaleString()} · Vertices {stats.vertices.toLocaleString()} ·
          Triangles {stats.triangles.toLocaleString()}
        </div>
        {isLoading && <div className="viewer-overlay">Loading model...</div>}
        {error && <div className="viewer-error">{error}</div>}
        <div ref={containerRef} className="three-canvas" aria-label="Generated 3D asset preview" />
      </div>
      {assetId && (
        <div className="viewer-calibration-panel" aria-label="Real-world size calibration">
          <span className="badge" data-kind={isCalibrated ? 'succeeded' : 'unknown'}>
            {isCalibrated ? '已校正' : '尚未校正'}
          </span>
          <div className="calibration-presets" role="group" aria-label="Calibration presets">
            {CALIBRATION_PRESETS.map((preset) => (
              <button
                key={preset.label}
                type="button"
                data-selected={targetCm === preset.cm}
                onClick={() => setTargetCm(preset.cm)}
              >
                {preset.label}（{preset.cm}cm）
              </button>
            ))}
          </div>
          <label className="calibration-custom-input">
            自訂最長邊（公分）
            <input
              type="number"
              step="0.1"
              min="0.1"
              value={targetCm}
              onChange={(event) => {
                const next = Number(event.target.value);
                setTargetCm(Number.isFinite(next) ? next : CALIBRATION_PRESETS[1].cm);
              }}
            />
          </label>
          <button type="button" disabled={isSaving} onClick={() => void handleSaveCalibration()}>
            {isSaving ? '校正中...' : '儲存並校正'}
          </button>
          {calibrationError && <p className="hint error">{calibrationError}</p>}
          {isCalibrated && (
            <a
              className="download-link"
              href={resolveApiUrl(`/api/library/assets/${assetId}/stl`)}
              download
            >
              下載 STL
            </a>
          )}
        </div>
      )}
      <div className="viewer-ar-panel" aria-label="Real-device AR preview (native model-viewer)">
        <button type="button" onClick={() => setArOpen((current) => !current)}>
          {arOpen ? '關閉 AR 檢視' : '在 AR 中檢視'}
        </button>
        {arOpen && (
          <>
            <model-viewer
              ref={arModelViewerRef}
              className="viewer-ar-frame"
              src={src}
              ios-src={resolvedIosSrc ?? undefined}
              ar
              ar-modes="scene-viewer quick-look"
              camera-controls
              scale="1 1 1"
              ar-scale={isCalibrated ? 'fixed' : undefined}
              alt="Generated 3D asset in AR"
            />
            <button
              type="button"
              className="viewer-ar-button"
              disabled={iosUsdzState === 'loading'}
              onClick={handleArButtonClick}
            >
              {iosUsdzState === 'loading' ? 'USDZ 轉檔中...' : '在 AR 中檢視'}
            </button>
            {iosUsdzState === 'error' && iosUsdzErrorMessage && (
              <p className="hint error">{iosUsdzErrorMessage}</p>
            )}
          </>
        )}
      </div>
    </div>
  );
}

function addInspectionLights(scene: THREE.Scene) {
  scene.add(new THREE.AmbientLight(0xffffff, 1.2));

  const lights: Array<[number, number, number, number]> = [
    [0, 10, 10, 1.5],
    [0, 10, -10, 1.1],
    [-10, 0, 0, 0.8],
    [10, 0, 0, 0.8],
    [0, -10, 0, 0.45],
  ];

  lights.forEach(([x, y, z, intensity]) => {
    const light = new THREE.DirectionalLight(0xffffff, intensity);
    light.position.set(x, y, z);
    light.castShadow = false;
    scene.add(light);
  });
}

function rememberOriginalMaterials(
  model: THREE.Object3D,
  originals: Map<THREE.Mesh, THREE.Material | THREE.Material[]>,
) {
  model.traverse((object) => {
    if (object instanceof THREE.Mesh) {
      object.castShadow = false;
      object.receiveShadow = false;
      originals.set(object, object.material);
    }
  });
}

function applyMaterialMode(
  model: THREE.Object3D,
  mode: MaterialMode,
  runtime: ViewerRuntime,
) {
  disposeReplacementMaterials(runtime);

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    if (mode === 'original') {
      const original = runtime.originalMaterials.get(object);
      if (original) {
        object.material = original;
      }
      return;
    }

    let material: THREE.Material;
    if (mode === 'normal') {
      material = new THREE.MeshNormalMaterial({ side: THREE.DoubleSide });
    } else {
      material = new THREE.MeshStandardMaterial({
        color: mode === 'wireframe' ? 0xaab4bd : 0xd8d8d8,
        metalness: 0,
        roughness: 0.78,
        side: THREE.DoubleSide,
        wireframe: mode === 'wireframe',
      });
    }

    runtime.replacementMaterials.add(material);
    object.material = material;
  });
}

function disposeReplacementMaterials(runtime: ViewerRuntime) {
  runtime.replacementMaterials.forEach((material) => material.dispose());
  runtime.replacementMaterials.clear();
}

function getModelStats(model: THREE.Object3D): ModelStats {
  const stats = { ...EMPTY_STATS };

  model.traverse((object) => {
    if (!(object instanceof THREE.Mesh)) {
      return;
    }

    stats.meshes += 1;
    const position = object.geometry.getAttribute('position');
    stats.vertices += position?.count ?? 0;
    stats.triangles += object.geometry.index
      ? object.geometry.index.count / 3
      : (position?.count ?? 0) / 3;
  });

  stats.triangles = Math.round(stats.triangles);
  return stats;
}

function frameModel(
  model: THREE.Object3D,
  camera: THREE.PerspectiveCamera,
  controls: OrbitControls,
  gridHelper: THREE.GridHelper,
  axesHelper: THREE.AxesHelper,
) {
  const initialBox = new THREE.Box3().setFromObject(model);
  const initialCenter = initialBox.getCenter(new THREE.Vector3());
  model.position.x -= initialCenter.x;
  model.position.y -= initialBox.min.y;
  model.position.z -= initialCenter.z;

  const box = new THREE.Box3().setFromObject(model);
  const size = box.getSize(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z) || 1;
  const target = new THREE.Vector3(0, size.y / 2, 0);
  const distance = maxSize / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2));
  const cameraPosition = new THREE.Vector3(
    distance * 0.9,
    target.y + distance * 0.65,
    distance * 1.35,
  );

  const helperScale = Math.max(maxSize / 10, 0.1);
  gridHelper.scale.setScalar(helperScale);
  axesHelper.scale.setScalar(Math.max(maxSize * 0.25, 0.1));

  camera.position.copy(cameraPosition);
  camera.near = Math.max(distance / 100, 0.01);
  camera.far = distance * 100;
  camera.updateProjectionMatrix();

  controls.target.copy(target);
  controls.minDistance = distance * 0.25;
  controls.maxDistance = distance * 5;
  controls.update();

  return () => {
    camera.position.copy(cameraPosition);
    controls.target.copy(target);
    controls.update();
  };
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
