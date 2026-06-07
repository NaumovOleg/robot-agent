import { PALETTE } from './colors';

export const COLORS = {
  gutterSign:     PALETTE.muted,
  hunkHeader:     PALETTE.diffHunk,
  fileHeader:     PALETTE.path,
  dimmed:         PALETTE.muted,
  contextBg:      undefined,
  contextText:    PALETTE.diffContext,
  contextLineNr:  PALETTE.faint,

  // Add lines — dark green bg, bright green text/sign
  addBg:          '#1A2E1A',
  addText:        '#7EC87E',
  addLineNr:      '#4A8A4A',
  addSign:        '#7EC87E',

  // Remove lines — dark red bg, bright red text/sign
  removeBg:       '#2E1A1A',
  removeText:     '#C87E7E',
  removeLineNr:   '#8A4A4A',
  removeSign:     '#C87E7E',

  // Inline highlights — slightly brighter bg for actually changed chars
  inlineAddBg:    '#2D4A2D',
  inlineRemoveBg: '#4A2D2D',
};
