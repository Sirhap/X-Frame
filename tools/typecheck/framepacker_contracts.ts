export interface RgbColor {
  r: number;
  g: number;
  b: number;
}

export interface CutoutProcessingOptions {
  backgroundColor: RgbColor;
  backgroundColors: RgbColor[];
  tolerance: number;
  feather: number;
  connected: boolean;
  perceptual: boolean;
  referenceChromaKey?: boolean;
  edgeBoost: number;
  blendStrength: number;
  blendMode: "general" | "blend" | "chroma";
  despillStrength: number;
  despillMode: "general" | "blend" | "chroma";
  edgeDespillRadius: number;
  edgeRecoveryStrength: number;
}

export interface CutoutRepair {
  id: string;
  mode: "brush" | "eraser" | "smart" | "clear" | "restore";
  points?: Array<{ x: number; y: number }>;
  x1?: number;
  y1?: number;
  x2?: number;
  y2?: number;
}

export interface CutoutWorkerRequest {
  id: number;
  sourceBuffer: ArrayBuffer;
  width: number;
  height: number;
  options: CutoutProcessingOptions;
  repairs: CutoutRepair[];
}

export interface CutoutWorkerResult {
  id: number;
  ok: true;
  dataBuffer: ArrayBuffer;
  automaticBuffer: ArrayBuffer;
  removedPixels: number;
  partialPixels: number;
}

export function assertWorkerRequest(value: CutoutWorkerRequest): CutoutWorkerRequest {
  if (!Number.isInteger(value.width) || value.width < 1) {
    throw new RangeError("Worker request width must be a positive integer.");
  }
  if (!Number.isInteger(value.height) || value.height < 1) {
    throw new RangeError("Worker request height must be a positive integer.");
  }
  return value;
}
