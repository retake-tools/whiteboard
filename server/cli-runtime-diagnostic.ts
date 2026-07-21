import { spawnSync } from 'node:child_process';

export function readCliVersion(executablePath: string): string | undefined {
  const result = spawnSync(executablePath, ['--version'], { encoding: 'utf8', timeout: 2_000 });
  return `${result.stdout || ''}\n${result.stderr || ''}`.match(/(\d+\.\d+\.\d+)/)?.[1];
}

export function cliVersionAtLeast(version: string, minimumVersion: string): boolean {
  const current = version.split('.').map(Number);
  const minimum = minimumVersion.split('.').map(Number);
  for (let index = 0; index < Math.max(current.length, minimum.length); index += 1) {
    const difference = (current[index] ?? 0) - (minimum[index] ?? 0);
    if (difference) return difference > 0;
  }
  return true;
}

export function cliUpgradeMessage(input: {
  runtimeName: string;
  version?: string;
  upgradeCommands: string[];
}): string {
  const installed = input.version ? ` Installed version: ${input.version}.` : '';
  const commands = input.upgradeCommands.map((command) => `\`${command}\``).join(' or ');
  return `${input.runtimeName} is too old for this Retake integration.${installed} Upgrade with ${commands}, then test the connection again.`;
}
