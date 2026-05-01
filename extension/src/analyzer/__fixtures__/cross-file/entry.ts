import { buildMessage } from './messages';
import { Worker } from './worker';

export function start(name: string): string {
  const worker = new Worker();
  return worker.run(buildMessage(name));
}

export const runAll = () => {
  return start('Ada');
};
