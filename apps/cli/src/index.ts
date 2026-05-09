import { APP } from './app';

process.stdin.resume();

await APP.waitUntilExit();
