import { resolve } from "node:path";

export const DEFAULT_PLUGINS_DIR = resolve(import.meta.dirname, "..", "config");
export const DEFAULT_PLUGIN_SOURCE_ROOT = resolve(import.meta.dirname, "..", "..");
