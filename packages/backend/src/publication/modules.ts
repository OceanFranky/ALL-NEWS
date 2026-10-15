import { serverModules } from "../modules.ts";

export async function readModulePublication(moduleName: string, resource: string, input: unknown): Promise<unknown> {
  const read = serverModules().find(module => module.name === moduleName)?.publications?.[resource];
  if (!read) throw new Error(`Publication resource not installed: ${moduleName}/${resource}`);
  return read(input);
}
