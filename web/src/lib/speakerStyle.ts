const SPEAKER_COLORS = [
  "#1f8cf9",
  "#1ff968",
  "#c084fc",
  "#fbbf24",
  "#fb7185",
  "#22d3ee",
  "#a3e635",
  "#f97316",
];

export function speakerColor(speaker: number): string {
  return SPEAKER_COLORS[speaker % SPEAKER_COLORS.length];
}

export function speakerLabel(speaker: number): string {
  return `Speaker ${speaker + 1}`;
}

/** `speakerColor` with an alpha channel, for glows and lane fills. */
export function speakerColorAlpha(speaker: number, alpha: number): string {
  const color = speakerColor(speaker);
  const value = Number.parseInt(color.slice(1), 16);
  return `rgba(${(value >> 16) & 255}, ${(value >> 8) & 255}, ${value & 255}, ${alpha})`;
}
