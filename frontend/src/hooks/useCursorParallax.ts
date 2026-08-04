import { useEffect, useRef } from 'react';

// Cursor-reactive layered parallax. Writes normalized pointer position into
// CSS custom properties (--par-x / --par-y, each -1..1) on the container via
// rAF with lerp damping, so no React state updates happen per frame.
// The rAF loop only runs while the pointer target is changing: once the
// damped value settles, the loop stops and the next pointermove restarts it.
// Disabled automatically for touch pointers and prefers-reduced-motion;
// layers fall back to their centered defaults.
export function useCursorParallax<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element) {
      return;
    }
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      return;
    }
    if (window.matchMedia('(pointer: coarse)').matches) {
      return;
    }

    // Settle threshold: below this the remaining movement is sub-pixel.
    const EPSILON = 0.001;
    let frameId: number | null = null;
    let targetX = 0;
    let targetY = 0;
    let currentX = 0;
    let currentY = 0;

    function tick() {
      // Damping factor tuned for a ~150ms follow feel.
      currentX += (targetX - currentX) * 0.12;
      currentY += (targetY - currentY) * 0.12;
      if (Math.abs(targetX - currentX) <= EPSILON && Math.abs(targetY - currentY) <= EPSILON) {
        // Settle exactly on the target, write once, then stop the loop.
        currentX = targetX;
        currentY = targetY;
        element!.style.setProperty('--par-x', currentX.toFixed(4));
        element!.style.setProperty('--par-y', currentY.toFixed(4));
        frameId = null;
        return;
      }
      element!.style.setProperty('--par-x', currentX.toFixed(4));
      element!.style.setProperty('--par-y', currentY.toFixed(4));
      frameId = window.requestAnimationFrame(tick);
    }

    // Guarantees a single live rAF at any time.
    function startLoop() {
      if (frameId === null) {
        frameId = window.requestAnimationFrame(tick);
      }
    }

    function handlePointerMove(event: PointerEvent) {
      const rect = element!.getBoundingClientRect();
      targetX = ((event.clientX - rect.left) / rect.width - 0.5) * 2;
      targetY = ((event.clientY - rect.top) / rect.height - 0.5) * 2;
      startLoop();
    }

    function handlePointerLeave() {
      targetX = 0;
      targetY = 0;
      startLoop();
    }

    element.addEventListener('pointermove', handlePointerMove);
    element.addEventListener('pointerleave', handlePointerLeave);

    return () => {
      if (frameId !== null) {
        window.cancelAnimationFrame(frameId);
      }
      element.removeEventListener('pointermove', handlePointerMove);
      element.removeEventListener('pointerleave', handlePointerLeave);
    };
  }, []);

  return ref;
}
