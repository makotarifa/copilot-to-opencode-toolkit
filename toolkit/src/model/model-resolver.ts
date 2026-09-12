import { MODEL_MAP_FILE } from "../constants";
import { ModelCatalog } from "./model-catalog";
import { lookupModelMap, MapSourceLookup, ModelMap, ModelMapEntry } from "./model-map";

export enum ModelResolutionStatus {
  Resolved = "resolved",
  Unmapped = "unmapped",
  Stale = "stale",
  NotSet = "not-set",
}

export enum ModelResolutionSource {
  Map = "map",
  Direct = "direct",
  Interactive = "interactive",
}

export interface ModelPrompt {
  chooseModel(original: string, candidates: readonly string[]): Promise<string | undefined>;
  confirmPersist(copilotModel: string, opencodeModelId: string): Promise<boolean>;
}

export interface ModelMapping {
  readonly original: string;
  readonly dest: string;
  readonly mapSource: string;
}

export interface ModelResolutionResult {
  readonly originalValue: string | string[] | undefined;
  readonly originalMembers: readonly string[];
  readonly resolved?: string;
  readonly status: ModelResolutionStatus;
  readonly source?: ModelResolutionSource;
  readonly mappedFrom?: ModelMapping;
  readonly remainingMembers: readonly string[];
  readonly warnings: readonly string[];
  readonly persist?: ModelMapEntry;
}

export interface ModelResolutionOptions {
  readonly map: ModelMap;
  readonly catalog: ModelCatalog;
  readonly interactive?: ModelPrompt;
  readonly mapSource?: MapSourceLookup;
}

export interface ModelResolverPort {
  resolveValue(value: string | string[] | undefined): Promise<ModelResolutionResult>;
}

interface MemberResolution {
  readonly resolved?: string;
  readonly source?: ModelResolutionSource;
  readonly status: ModelResolutionStatus;
  readonly staleId?: string;
  readonly persist?: ModelMapEntry;
  readonly mappedFrom?: ModelMapping;
}

interface MemberAttempt {
  readonly index: number;
  readonly resolution: MemberResolution;
}

function toMembers(value: string | string[] | undefined): string[] {
  if (typeof value === "string") {
    return value.trim().length > 0 ? [value] : [];
  }
  if (Array.isArray(value)) {
    return value.map((entry) => entry.trim()).filter((entry) => entry.length > 0);
  }
  return [];
}

async function offerPersistence(
  member: string,
  chosen: string,
  options: ModelResolutionOptions,
): Promise<ModelMapEntry | undefined> {
  if (options.interactive === undefined) {
    return undefined;
  }
  const shouldPersist = await options.interactive.confirmPersist(member, chosen);
  return shouldPersist ? { copilotModel: member, opencodeModelId: chosen } : undefined;
}

async function resolveViaPrompt(
  member: string,
  options: ModelResolutionOptions,
  staleId?: string,
): Promise<MemberResolution | undefined> {
  if (options.interactive === undefined) {
    return undefined;
  }
  const chosen = await options.interactive.chooseModel(member, options.catalog.all());
  if (chosen === undefined || !options.catalog.has(chosen)) {
    return undefined;
  }
  const persist = await offerPersistence(member, chosen, options);
  return { resolved: chosen, source: ModelResolutionSource.Interactive, status: ModelResolutionStatus.Resolved, staleId, persist };
}

function resolveDeterministic(member: string, options: ModelResolutionOptions): MemberResolution | undefined {
  const mapped = lookupModelMap(options.map, member);
  if (mapped !== undefined && options.catalog.has(mapped)) {
    return {
      resolved: mapped,
      source: ModelResolutionSource.Map,
      status: ModelResolutionStatus.Resolved,
      mappedFrom: {
        original: member,
        dest: mapped,
        mapSource: options.mapSource?.(member) ?? MODEL_MAP_FILE,
      },
    };
  }
  if (options.catalog.has(member)) {
    return { resolved: member, source: ModelResolutionSource.Direct, status: ModelResolutionStatus.Resolved };
  }
  return undefined;
}

async function resolveMember(
  member: string,
  options: ModelResolutionOptions,
): Promise<MemberResolution> {
  const deterministic = resolveDeterministic(member, options);
  if (deterministic !== undefined) {
    return deterministic;
  }
  const mapped = lookupModelMap(options.map, member);
  const staleId = mapped !== undefined ? mapped : undefined;
  const prompted = await resolveViaPrompt(member, options, staleId);
  if (prompted !== undefined) {
    return prompted;
  }
  return staleId !== undefined
    ? { status: ModelResolutionStatus.Stale, staleId }
    : { status: ModelResolutionStatus.Unmapped };
}

async function resolveFirstMappable(
  members: readonly string[],
  options: ModelResolutionOptions,
): Promise<MemberAttempt> {
  for (let index = 0; index < members.length; index += 1) {
    const resolution = resolveDeterministic(members[index] ?? "", options);
    if (resolution !== undefined) {
      return { index, resolution };
    }
  }
  const resolution = await resolveMember(members[0] ?? "", options);
  return { index: 0, resolution };
}

function buildWarnings(
  members: readonly string[],
  attempted: string,
  member: MemberResolution,
  options: ModelResolutionOptions,
): string[] {
  const warnings: string[] = [];
  if (members.length > 1) {
    warnings.push(
      `MODEL_FALLBACK: ordered fallback list [${members.join(", ")}] collapsed to the first mappable member; the original array is preserved in the OpenCode notes.`,
    );
  }
  if (member.status === ModelResolutionStatus.Stale) {
    const mapSource = options.mapSource?.(attempted) ?? MODEL_MAP_FILE;
    warnings.push(
      `STALE_MODEL_ID: ${mapSource} maps \`${attempted}\` to \`${member.staleId ?? ""}\`, which is absent from the catalog snapshot.`,
    );
  }
  if (member.status === ModelResolutionStatus.Unmapped) {
    warnings.push(
      `UNMAPPED_MODEL: \`${attempted}\` could not be resolved against model-map.json or the catalog snapshot.`,
    );
  }
  return warnings;
}

export async function resolveModelValue(
  value: string | string[] | undefined,
  options: ModelResolutionOptions,
): Promise<ModelResolutionResult> {
  const members = toMembers(value);
  if (members.length === 0) {
    return {
      originalValue: value,
      originalMembers: members,
      status: ModelResolutionStatus.NotSet,
      remainingMembers: [],
      warnings: [],
    };
  }

  const attempt = await resolveFirstMappable(members, options);
  const isResolved = attempt.resolution.status === ModelResolutionStatus.Resolved;
  const remainingMembers = isResolved
    ? members.filter((_member, index) => index !== attempt.index)
    : [];

  return {
    originalValue: value,
    originalMembers: members,
    resolved: attempt.resolution.resolved,
    status: attempt.resolution.status,
    source: attempt.resolution.source,
    mappedFrom: attempt.resolution.mappedFrom,
    remainingMembers,
    warnings: buildWarnings(members, members[attempt.index] ?? "", attempt.resolution, options),
    persist: attempt.resolution.persist,
  };
}

export function createModelResolver(options: ModelResolutionOptions): ModelResolverPort {
  return {
    resolveValue: (value) => resolveModelValue(value, options),
  };
}
