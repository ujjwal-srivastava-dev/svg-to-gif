export interface SvgMetadata {
  width: number;
  height: number;
  duration: number;
  animations: number;
}

export interface ConversionOptions {
  width?: number | string;
  height?: number | string;
  fps?: number | string;
  duration?: number | string;
  start?: number | string;
  colors?: number | string;
  loop?: number | string;
  background?: string;
  dither?: boolean;
}

export interface ConversionSettings {
  width: number;
  height: number;
  fps: number;
  duration: number;
  start: number;
  count: number;
  colors: number;
  loop: number;
  background: string;
  dither: boolean;
}

export interface ConversionResult {
  width: number;
  height: number;
  frames: number;
  duration: number;
  bytes: number;
}

export interface ConversionProgress {
  progress: number;
  message: string;
}

export interface JobSnapshot extends ConversionProgress {
  state: 'working' | 'done' | 'cancelled' | 'error';
  result?: ConversionResult;
}

export interface WorkerInput {
  svg: string;
  output: string;
  workspace: string;
  options: ConversionOptions;
}

export interface WorkerUpdate extends ConversionProgress {
  state?: JobSnapshot['state'];
  result?: ConversionResult;
}

export interface SourceFile {
  svg: string;
  meta: SvgMetadata;
  name: string;
  size: number;
}

export interface ExportSettings {
  width: number | string;
  height: number | string;
  duration: number | string;
  fps: number | string;
  start: number | string;
  colors: number | string;
  loop: number | string;
  dither: boolean;
  background: string;
  customColor: string;
  aspect: boolean;
  autoDuration: boolean;
  preset: string;
}

export interface ExportResult extends ConversionResult {
  url: string;
}

export type ExportEvent =
  | ({ type: 'progress' } & ConversionProgress)
  | { type: 'chunk'; data: string }
  | { type: 'done'; result: ConversionResult }
  | { type: 'error'; message: string };

export interface SessionInfo {
  token: string;
  mode: 'jobs' | 'stream';
  maxRequestBytes: number;
}
