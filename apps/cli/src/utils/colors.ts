export const PALETTE = {
  // Text hierarchy
  userText:    '#E8E8E8',
  aiText:      '#D4D4D4',
  muted:       '#6A6A6A',
  faint:       '#3A3A3A',

  // Semantic states
  teal:        '#4EC9B0',   // active / running
  sage:        '#4A9B4A',   // success / done
  amber:       '#CE9178',   // warning / approval
  rust:        '#F44747',   // error
  slate:       '#569CD6',   // info / system notices
  path:        '#9CDCFE',   // file paths

  // Diff-specific
  diffAdd:     '#4A7A4A',
  diffDel:     '#7A3A3A',
  diffHunk:    '#569CD6',
  diffContext: '#505050',
  diffFaint:   '#3A3A3A',

  // Status bar
  statusBar:   '#4A4A4A',

  // Context bar fill (for StatusBar progress)
  ctxNormal:   '#4EC9B0',   // <75% context used
  ctxWarn:     '#CE9178',   // 75–90%
  ctxCrit:     '#F44747',   // >90%
} as const;
