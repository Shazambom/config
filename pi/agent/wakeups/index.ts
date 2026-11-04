import { Type } from 'typebox';
import { getShellConfig, type ExtensionAPI } from '@earendil-works/pi-coding-agent';
import contract from './contract.json';
import install from './runtime.mjs';
import installShell from './shell.mjs';

export default function (pi: ExtensionAPI) {
  const definitions = contract.tools.map(tool => ({
    ...tool, parameters: Type.Unsafe(tool.parameters), promptGuidelines: [contract.systemInstructions],
  }));
  const lifecycle = install(pi, definitions);
  installShell(pi, definitions.find(tool => tool.name === 'watch_shell'), lifecycle, { getShellConfig });
}
