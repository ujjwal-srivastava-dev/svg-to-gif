import type { SvgMetadata } from './types.ts';

export const resolutionPresets = [
  { id: '480', label: '480 px · quick export', width: 480, height: 480 },
  { id: '480p', label: '480p · SD', width: 854, height: 480 },
  { id: '720p', label: '720p · HD', width: 1280, height: 720 },
  { id: '1080p', label: '1080p · Full HD', width: 1920, height: 1080 },
  { id: '1440p', label: '1440p · QHD', width: 2560, height: 1440 },
  { id: '2160p', label: '2160p · 4K', width: 3840, height: 2160 },
];

export function presetDimensions(id: string, meta: SvgMetadata, aspect: boolean) {
  if (id === 'original')
    return { width: Math.round(meta.width), height: Math.round(meta.height) };

  const preset = resolutionPresets.find((preset) => preset.id === id);
  if (!preset) return undefined;
  const scale = Math.min(preset.width / meta.width, preset.height / meta.height);

  return aspect
    ? {
        width: Math.max(16, Math.round(meta.width * scale)),
        height: Math.max(16, Math.round(meta.height * scale)),
      }
    : { width: preset.width, height: preset.height };
}
