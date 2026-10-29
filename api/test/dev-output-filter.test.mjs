import { describe, expect, it } from 'vitest';
import { createDevelopmentEnvironment } from '../scripts/dev-environment.mjs';
import { createFilteredOutputWriter, isRoutineWatcherStatusLine } from '../scripts/dev-output-filter.mjs';

function collectFilteredOutput(chunks) {
  const output = [];
  const writer = createFilteredOutputWriter({ write: (chunk) => output.push(chunk) });
  for (const chunk of chunks) writer.write(chunk);
  writer.end();
  return output.join('');
}

describe('development watcher output filter', () => {
  it('recognizes routine watcher chatter without matching application output or status', () => {
    expect(isRoutineWatcherStatusLine("Change detected in 'D:\\drezivo-operator\\api\\src\\shared\\logging\\logger.ts'")).toBe(true);
    expect(isRoutineWatcherStatusLine("Restarting 'src/server.ts'")).toBe(true);
    expect(isRoutineWatcherStatusLine("Completed running 'src/server.ts'.")).toBe(false);
    expect(isRoutineWatcherStatusLine("Failed running 'src/server.ts'. Waiting for file changes before restarting...")).toBe(false);
    expect(isRoutineWatcherStatusLine('{"level":30,"event":"api.server.listening"}')).toBe(false);
  });

  it('filters routine chatter and forwards startup logs, warnings, errors, and watcher status', () => {
    const output = collectFilteredOutput([
      "Change det",
      "ected in 'D:\\drezivo-operator\\api\\src\\shared\\logging\\logger.ts'\r\n",
      "Restarting 'src/server.ts'\n",
      '{"level":30,"event":"api.server.listening","host":"127.0.0.1","port":5080}\n',
      '{"level":40,"msg":"configuration warning"}\n',
      'Error: EADDRINUSE\n',
      "Completed running 'src/server.ts'.\n",
      "Failed running 'src/server.ts'. Waiting for file changes before restarting...\n",
    ]);

    expect(output).toBe(
      '{"level":30,"event":"api.server.listening","host":"127.0.0.1","port":5080}\n' +
        '{"level":40,"msg":"configuration warning"}\n' +
        'Error: EADDRINUSE\n' +
        "Completed running 'src/server.ts'.\n" +
        'Failed running \'src/server.ts\'. Waiting for file changes before restarting...\n',
    );
  });

  it('flushes an unterminated application line at stream end', () => {
    expect(collectFilteredOutput(['startup failed'])).toBe('startup failed');
  });
});

describe('development child environment', () => {
  it('forces development mode when the shell inherited test mode', () => {
    expect(createDevelopmentEnvironment({ NODE_ENV: 'test', PORT: '5080' })).toEqual({
      NODE_ENV: 'development',
      PORT: '5080',
    });
  });
});
