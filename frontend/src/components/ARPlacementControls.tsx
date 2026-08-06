/*
 * Pure display component for ARPreview's placement controls.
 *
 * Holds no state of its own — every value is a prop and every change goes
 * straight back out through the matching onChange callback. The caller
 * (ARStudioPage, DevARPreviewPage) owns the actual state and decides where
 * in its own layout this renders. Unlike the old calibration panel, this is
 * meant to sit in normal document flow (a .panel column, a section below
 * the preview, whatever fits) — never absolutely positioned on top of the
 * photo/canvas.
 */

type ARPlacementControlsProps = {
  positionX: number;
  onPositionXChange: (value: number) => void;
  positionY: number;
  onPositionYChange: (value: number) => void;
  size: number;
  onSizeChange: (value: number) => void;
  rotationDeg: number;
  onRotationDegChange: (value: number) => void;
  characterDepth: number;
  onCharacterDepthChange: (value: number) => void;
  debugOcclusion: boolean;
  onDebugOcclusionChange: (value: boolean) => void;
};

export function ARPlacementControls({
  positionX,
  onPositionXChange,
  positionY,
  onPositionYChange,
  size,
  onSizeChange,
  rotationDeg,
  onRotationDegChange,
  characterDepth,
  onCharacterDepthChange,
  debugOcclusion,
  onDebugOcclusionChange,
}: ARPlacementControlsProps) {
  return (
    <div className="ar-placement-controls">
      <SliderRow
        label="位置 X"
        value={positionX}
        min={-3}
        max={3}
        step={0.02}
        onChange={onPositionXChange}
      />
      <SliderRow
        label="位置 Y"
        value={positionY}
        min={-2}
        max={2}
        step={0.02}
        onChange={onPositionYChange}
      />
      <SliderRow label="大小" value={size} min={0.4} max={3.5} step={0.02} onChange={onSizeChange} />
      <SliderRow
        label="旋轉"
        value={rotationDeg}
        min={0}
        max={360}
        step={1}
        decimals={0}
        suffix="°"
        onChange={onRotationDegChange}
      />
      <SliderRow
        label="深度"
        value={characterDepth}
        min={0}
        max={1}
        step={0.005}
        onChange={onCharacterDepthChange}
        hint="數值越大＝離鏡頭越近（越容易擋在前景物體前面）"
      />
      <label className="ar-placement-controls-toggle">
        <input
          type="checkbox"
          checked={debugOcclusion}
          onChange={(event) => onDebugOcclusionChange(event.target.checked)}
        />
        標示被遮擋的區域
      </label>
    </div>
  );
}

type SliderRowProps = {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (value: number) => void;
  decimals?: number;
  suffix?: string;
  hint?: string;
};

function SliderRow({ label, value, min, max, step, onChange, decimals = 2, suffix = '', hint }: SliderRowProps) {
  return (
    <div className="ar-placement-controls-row">
      <span className="ar-placement-controls-label">{label}</span>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        aria-label={label}
        onChange={(event) => onChange(Number(event.target.value))}
      />
      <span className="hint ar-placement-controls-value">
        {value.toFixed(decimals)}
        {suffix}
      </span>
      {hint && <span className="hint ar-placement-controls-hint">{hint}</span>}
    </div>
  );
}
