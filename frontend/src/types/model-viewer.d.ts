// Minimal JSX typing for the <model-viewer> custom element from
// @google/model-viewer, used by components/ModelViewer.tsx for the
// Level 1 real-AR panel (WebXR size calibration plus iOS Quick Look).
// @google/model-viewer does not ship its own React/JSX types, so this
// declares just the attributes this project actually uses.
//
// Declared under both the global `JSX` namespace and `React.JSX`
// (inside `declare module 'react'`) because newer @types/react
// (18.3+ / 19) moved intrinsic-element augmentation to `React.JSX`;
// declaring both covers either resolution without pinning to a
// specific @types/react minor version.
import type * as React from 'react';

interface ModelViewerJSX
  extends React.DetailedHTMLProps<React.HTMLAttributes<HTMLElement>, HTMLElement> {
  src?: string;
  'ios-src'?: string;
  ar?: boolean;
  'ar-modes'?: string;
  'camera-controls'?: boolean;
  scale?: string;
  'ar-scale'?: 'auto' | 'fixed';
  alt?: string;
}

declare global {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': ModelViewerJSX;
    }
  }
}

declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'model-viewer': ModelViewerJSX;
    }
  }
}

export {};
