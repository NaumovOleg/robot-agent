import { APP } from './app';
import { render } from 'ink';

process.stdin.setRawMode(true);
process.stdin.resume();
process.stdin.setEncoding('utf8');

process.stdin.resume();

const run = async () => {
  const { waitUntilExit } = render(APP, {
    stdin: process.stdin,
    stdout: process.stdout,
    patchConsole: false,
  });

  await waitUntilExit();
};

// eslint-disable-next-line @typescript-eslint/no-floating-promises
run();
