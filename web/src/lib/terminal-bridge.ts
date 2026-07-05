type RunCommandFn = (command: string) => boolean;

const runners = new Map<string, RunCommandFn>();

export function registerTerminalRunner(
  serverId: string,
  run: RunCommandFn,
): () => void {
  runners.set(serverId, run);
  return () => {
    if (runners.get(serverId) === run) {
      runners.delete(serverId);
    }
  };
}

export function runTerminalCommand(
  serverId: string,
  command: string,
): boolean {
  return runners.get(serverId)?.(command) ?? false;
}
