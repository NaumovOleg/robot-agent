import { APP } from './app';
import { render } from 'ink';
import { Checkpointer } from '@robocode-packages/core';

const setRawMode = (enabled: boolean) => {
  if (process.stdin.isTTY && typeof process.stdin.setRawMode === 'function') {
    process.stdin.setRawMode(enabled);
  }
};

const run = async () => {
  setRawMode(true);
  process.stdin.resume();
  process.stdin.setEncoding('utf8');

  try {
    const { waitUntilExit } = render(APP, {
      stdin: process.stdin,
      stdout: process.stdout,
      patchConsole: false,
      exitOnCtrlC: false,
    });

    await waitUntilExit();
  } finally {
    setRawMode(false);
    process.stdin.pause();
  }
};

process.on('exit', () => {
  Checkpointer.close();
});

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run();
