import { useEffect, useState } from 'react';

const SPINNER_FRAMES = ['⠋', '⠙', '⠹', '⠸', '⠼', '⠴', '⠦', '⠧', '⠇', '⠏'];

export function useSpinner(isActive: boolean): string {
  const [frame, setFrame] = useState(0);

  useEffect(() => {
    if (!isActive) { setFrame(0); return; }
    const t = setInterval(() => setFrame(f => (f + 1) % SPINNER_FRAMES.length), 80);
    return () => clearInterval(t);
  }, [isActive]);

  return SPINNER_FRAMES[frame];
}
