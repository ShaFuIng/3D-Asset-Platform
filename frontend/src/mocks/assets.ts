// Generates fake image/model resources fully in memory (canvas, FileReader,
// three.js GLTFExporter). Nothing here ever performs a real network request.
import * as THREE from 'three';
import { GLTFExporter } from 'three/examples/jsm/exporters/GLTFExporter.js';

/** Deterministically maps a string to a hue (0-360) so the same label always gets the same color. */
function hashToHue(label: string): number {
  let hash = 0;
  for (let i = 0; i < label.length; i += 1) {
    hash = (hash * 31 + label.charCodeAt(i)) % 360;
  }
  return hash;
}

function wrapText(ctx: CanvasRenderingContext2D, text: string, x: number, y: number, maxWidth: number, lineHeight: number) {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let currentLine = '';

  for (const word of words) {
    const candidate = currentLine ? `${currentLine} ${word}` : word;
    if (ctx.measureText(candidate).width > maxWidth && currentLine) {
      lines.push(currentLine);
      currentLine = word;
    } else {
      currentLine = candidate;
    }
  }
  if (currentLine) lines.push(currentLine);

  const startY = y - ((lines.length - 1) * lineHeight) / 2;
  lines.forEach((line, index) => ctx.fillText(line, x, startY + index * lineHeight));
}

/** Renders a simple placeholder image (colored tile with a label) as a data URL. */
export function createPlaceholderImageDataUrl(label: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 512;
  canvas.height = 512;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    return '';
  }

  const hue = hashToHue(label || 'mock');
  ctx.fillStyle = `hsl(${hue}, 60%, 45%)`;
  ctx.fillRect(0, 0, canvas.width, canvas.height);

  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.font = '28px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  wrapText(ctx, label || 'Mock Image', canvas.width / 2, canvas.height / 2, canvas.width - 80, 36);

  return canvas.toDataURL('image/png');
}

/** Reads a File as a data URL (used to "upload" a real local file without hitting the network). */
export function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error ?? new Error('Failed to read file.'));
    reader.readAsDataURL(file);
  });
}

let cachedModelUrlPromise: Promise<string> | null = null;

/**
 * Builds a small placeholder GLB (a torus knot) with three.js's own exporter
 * and returns a blob: URL for it. The result is cached for the session so
 * repeated "succeeded" jobs reuse the same generated file.
 *
 * To use a different mock shape, swap the geometry/material below.
 */
export function getMockModelUrl(): Promise<string> {
  if (!cachedModelUrlPromise) {
    const geometry = new THREE.TorusKnotGeometry(0.6, 0.2, 128, 16);
    const material = new THREE.MeshStandardMaterial({
      color: 0x4f9dff,
      metalness: 0.2,
      roughness: 0.4,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.name = 'MockAsset';

    const exporter = new GLTFExporter();
    cachedModelUrlPromise = exporter.parseAsync(mesh, { binary: true }).then((result) => {
      const blob = new Blob([result as ArrayBuffer], { type: 'model/gltf-binary' });
      return URL.createObjectURL(blob);
    });
  }

  return cachedModelUrlPromise;
}
