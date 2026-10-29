const ansiEscapeSequence = /\u001B\[[0-?]*[ -/]*[@-~]/gu;
const routineWatcherStatusLine = /^(?:Change detected in '.+'|Restarting '.+')\.?$/u;

export function isRoutineWatcherStatusLine(line) {
  return routineWatcherStatusLine.test(line.replace(ansiEscapeSequence, '').trim());
}

export function createFilteredOutputWriter(destination) {
  let pending = '';

  return {
    write(chunk) {
      pending += String(chunk);
      const completeLines = pending.split(/(?<=\n)/u);
      pending = completeLines.pop() ?? '';

      for (const line of completeLines) {
        const content = line.replace(/\r?\n$/u, '');
        if (!isRoutineWatcherStatusLine(content)) destination.write(line);
      }
    },
    end() {
      if (pending && !isRoutineWatcherStatusLine(pending)) destination.write(pending);
      pending = '';
    },
  };
}
