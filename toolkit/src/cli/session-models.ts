import { join } from "node:path";

import { MODEL_MAP_FILE } from "../constants";
import {
  createMapSourceLookup,
  createModelCatalog,
  createModelResolver,
  loadModelMap,
  loadModelMapOverlay,
  mergeModelMaps,
  ModelResolverPort,
  ModelPrompt,
  persistModelMapEntry,
} from "../model/index";
import { InteractivePrompts } from "./prompts";
import { SessionInput } from "./session-types";

const MODEL_MAP_OVERLAY_LABEL_PREFIX = "--model-map ";

function buildInteractiveModelPrompt(prompts: InteractivePrompts, modelMapPath: string): ModelPrompt {
  return {
    chooseModel: (original, candidates) => prompts.chooseModel(original, candidates),
    confirmPersist: async (copilotModel, opencodeModelId) => {
      const shouldPersist = await prompts.confirmPersist(copilotModel, opencodeModelId);
      if (shouldPersist) {
        await persistModelMapEntry(modelMapPath, { copilotModel, opencodeModelId });
      }
      return shouldPersist;
    },
  };
}

export async function buildModels(input: SessionInput, prompts: InteractivePrompts): Promise<ModelResolverPort> {
  const base = await loadModelMap(input.baseModelMapPath);
  const overlay = await loadModelMapOverlay(input.options.modelMapPath);
  const catalog = await createModelCatalog({ opencodeRoot: join(input.paths.repoRoot, ".opencode") });
  const map = mergeModelMaps(base, overlay);
  const overlayLabel =
    input.options.modelMapPath !== undefined
      ? `${MODEL_MAP_OVERLAY_LABEL_PREFIX}${input.options.modelMapPath}`
      : undefined;
  const mapSource = createMapSourceLookup(base, MODEL_MAP_FILE, overlay, overlayLabel);
  if (input.options.yes) {
    return createModelResolver({ map, catalog, mapSource });
  }
  return createModelResolver({
    map,
    catalog,
    mapSource,
    interactive: buildInteractiveModelPrompt(prompts, input.modelMapPath),
  });
}
