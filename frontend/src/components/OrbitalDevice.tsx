// Purely decorative central visual for the Home terminal: layered rings,
// tick marks, crosshair and an abstract wireframe core. All CSS-driven,
// pointer-events: none, hidden from assistive tech. Parallax transforms live
// on wrapper layers so spin animations on the rings stay composable.
export function OrbitalDevice() {
  return (
    <div className="orbital" aria-hidden="true">
      <span className="orbital-cross orbital-cross-h par-front" />
      <span className="orbital-cross orbital-cross-v par-front" />

      <div className="orbital-layer par-bg">
        <div className="orbital-ring orbital-ring-outer" />
      </div>
      <div className="orbital-layer par-mid">
        <div className="orbital-ring orbital-ring-ticks" />
        <div className="orbital-ring orbital-ring-mid" />
      </div>
      <div className="orbital-layer par-mid">
        <div className="orbital-ring orbital-ring-inner" />
      </div>

      <div className="orbital-core par-front">
        <div className="orbital-cube" />
      </div>

      <span className="orbital-tag orbital-tag-a par-front">SYS.READY</span>
      <span className="orbital-tag orbital-tag-b par-front">RENDER CORE // HUNYUAN3D</span>
    </div>
  );
}
