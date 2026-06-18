import type {
  ActionNode,
  AnyNode,
  AssetNode,
  BaseNode,
  IdentityNode,
  LocationNode,
  NodeType,
  SubscriptionNode,
  SubscriptionRate,
  TagNode,
  TaskNode,
  WebsiteNode,
  WorkspaceState
} from "../types";
import type { ParsedMacro } from "../utils/macroParser";
import { escapeMacroText, normalizeTagName } from "../utils/macroParser";
import { parseLocalDateTimeToUtc } from "../utils/date";
import { makeId, nowIso } from "../utils/ids";

const DEFAULT_TAG_COLOR = "#D1D5DB";

export function getNodeByType(
  state: WorkspaceState,
  nodeType: NodeType,
  nodeId: string
): AnyNode | null {
  const collection = getCollection(state, nodeType);
  return (collection as Record<string, AnyNode>)[nodeId] || null;
}

export function createOrUpdateNodeFromMacro(
  state: WorkspaceState,
  parsed: ParsedMacro,
  existingNodeId?: string
): { state: WorkspaceState; nodeId: string } {
  const now = nowIso();
  let next = { ...state, nodes: { ...state.nodes }, updatedAt: now };
  const nodeId = existingNodeId || makeId(parsed.nodeType);
  const existing = existingNodeId ? getNodeByType(state, parsed.nodeType, existingNodeId) : null;
  const base = makeBaseNode(next.userId, nodeId, parsed.name, now, existing || undefined, parsed.raw);
  const tagResult = parsed.tagName ? ensureTag(next, parsed.tagName, now) : null;
  const tagId = tagResult?.tagId || null;
  next = tagResult?.state || next;

  if (parsed.nodeType === "task") {
    const node: TaskNode = {
      ...base,
      note: parsed.note,
      datetimeUtc: parseLocalDateTimeToUtc(parsed.primary),
      tagId
    };
    next.nodes = { ...next.nodes, tasks: { ...next.nodes.tasks, [nodeId]: node } };
  } else if (parsed.nodeType === "subscription") {
    const node: SubscriptionNode = {
      ...base,
      note: parsed.note,
      rate: parseSubscriptionRate(parsed.primary),
      tagId
    };
    next.nodes = {
      ...next.nodes,
      subscriptions: { ...next.nodes.subscriptions, [nodeId]: node }
    };
  } else if (parsed.nodeType === "website") {
    const node: WebsiteNode = {
      ...base,
      note: parsed.note,
      identityIds: resolveIdentityIds(next, parsed.listValues),
      unresolvedIdentities: unresolvedIdentityNames(next, parsed.listValues),
      tagId
    };
    next.nodes = { ...next.nodes, websites: { ...next.nodes.websites, [nodeId]: node } };
  } else if (parsed.nodeType === "action") {
    const node: ActionNode = {
      ...base,
      note: parsed.note,
      timeLocal: parsed.primary,
      tagId
    };
    next.nodes = { ...next.nodes, actions: { ...next.nodes.actions, [nodeId]: node } };
  } else if (parsed.nodeType === "tag") {
    const normalizedName = normalizeTagName(parsed.name);
    const existingTag = findTagByNormalizedName(next, normalizedName);
    const resolvedId = existingTag?.id || nodeId;
    const node: TagNode = {
      ...makeBaseNode(next.userId, resolvedId, parsed.name, now, existingTag || undefined, parsed.raw),
      note: parsed.note,
      color: normalizeColor(parsed.primary) || DEFAULT_TAG_COLOR,
      normalizedName
    };
    next.nodes = { ...next.nodes, tags: { ...next.nodes.tags, [resolvedId]: node } };
    return { state: next, nodeId: resolvedId };
  } else if (parsed.nodeType === "location") {
    const node: LocationNode = {
      ...base,
      address: parsed.primary
    };
    next.nodes = { ...next.nodes, locations: { ...next.nodes.locations, [nodeId]: node } };
  } else if (parsed.nodeType === "identity") {
    const node: IdentityNode = {
      ...base,
      referenceWebsiteId: resolveWebsiteId(next, parsed.primary),
      referenceAssetId: resolveAssetId(next, parsed.primary),
      unresolvedReference: resolveWebsiteId(next, parsed.primary) || resolveAssetId(next, parsed.primary)
        ? null
        : parsed.primary,
      tagId
    };
    next.nodes = { ...next.nodes, identities: { ...next.nodes.identities, [nodeId]: node } };
  } else if (parsed.nodeType === "asset") {
    const node: AssetNode = {
      ...base,
      referenceLocationId: resolveLocationId(next, parsed.primary),
      unresolvedReference: resolveLocationId(next, parsed.primary) ? null : parsed.primary,
      tagId
    };
    next.nodes = { ...next.nodes, assets: { ...next.nodes.assets, [nodeId]: node } };
  }

  return { state: next, nodeId };
}

export function archiveNode(state: WorkspaceState, nodeType: NodeType, nodeId: string): WorkspaceState {
  const node = getNodeByType(state, nodeType, nodeId);
  if (!node) return state;
  const now = nowIso();
  const nextArchive = node.archive < 2 ? ((node.archive + 1) as 1 | 2) : node.archive;
  const updated = {
    ...node,
    archive: nextArchive,
    deletedAt: node.archive >= 2 ? now : node.deletedAt || null,
    updatedAt: now
  };
  return setNode(state, nodeType, updated);
}

export function restoreNode(state: WorkspaceState, nodeType: NodeType, nodeId: string): WorkspaceState {
  const node = getNodeByType(state, nodeType, nodeId);
  if (!node) return state;
  return setNode(state, nodeType, {
    ...node,
    archive: 0,
    deletedAt: null,
    updatedAt: nowIso()
  });
}

export function nodeToMacro(state: WorkspaceState, nodeType: NodeType, nodeId: string): string {
  const node = getNodeByType(state, nodeType, nodeId);
  if (!node) return "<>";
  if (node.rawMacro) return node.rawMacro;
  const note = "note" in node && node.note ? `\n${escapeMacroText(node.note)}` : "";
  const tag = "tagId" in node && node.tagId ? getTagName(state, node.tagId) : "";

  if (nodeType === "task") {
    const task = node as TaskNode;
    return `<${escapeMacroText(task.name)}; ${escapeMacroText(task.datetimeUtc || "")}; ${escapeMacroText(tag)}${note}>`;
  }
  if (nodeType === "subscription") {
    const subscription = node as SubscriptionNode;
    return `<${escapeMacroText(subscription.name)}; ${escapeMacroText(formatRate(subscription.rate))}; ${escapeMacroText(tag)}${note}>`;
  }
  if (nodeType === "website") {
    const website = node as WebsiteNode;
    const identities = [
      ...website.identityIds.map((id) => state.nodes.identities[id]?.name || id),
      ...website.unresolvedIdentities
    ].join(", ");
    return `<${escapeMacroText(website.name)}; ${escapeMacroText(identities)}; ${escapeMacroText(tag)}${note}>`;
  }
  if (nodeType === "action") {
    const action = node as ActionNode;
    return `<${escapeMacroText(action.name)}; ${escapeMacroText(action.timeLocal || "")}; ${escapeMacroText(tag)}${note}>`;
  }
  if (nodeType === "tag") {
    const tagNode = node as TagNode;
    return `<${escapeMacroText(tagNode.name)}; ${escapeMacroText(tagNode.color)}${note}>`;
  }
  if (nodeType === "location") {
    const location = node as LocationNode;
    return `<${escapeMacroText(location.name)}; ${escapeMacroText(location.address || "")}>`;
  }
  if (nodeType === "identity") {
    const identity = node as IdentityNode;
    const reference =
      identity.referenceWebsiteId
        ? state.nodes.websites[identity.referenceWebsiteId]?.name
        : identity.referenceAssetId
          ? state.nodes.assets[identity.referenceAssetId]?.name
          : identity.unresolvedReference || "";
    return `<${escapeMacroText(identity.name)}; ${escapeMacroText(reference || "")}; ${escapeMacroText(tag)}>`;
  }
  const asset = node as AssetNode;
  const reference = asset.referenceLocationId
    ? state.nodes.locations[asset.referenceLocationId]?.name
    : asset.unresolvedReference || "";
  return `<${escapeMacroText(asset.name)}; ${escapeMacroText(reference)}; ${escapeMacroText(tag)}>`;
}

export function getTagName(state: WorkspaceState, tagId: string | null): string {
  return tagId ? state.nodes.tags[tagId]?.name || "" : "";
}

export function getTagColor(state: WorkspaceState, tagId: string | null): string | null {
  return tagId ? state.nodes.tags[tagId]?.color || null : null;
}

function makeBaseNode(
  userId: string,
  id: string,
  name: string,
  now: string,
  existing?: Partial<BaseNode>,
  rawMacro?: string
): BaseNode {
  return {
    id,
    userId,
    name,
    archive: existing?.archive ?? 0,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    deletedAt: existing?.deletedAt || null,
    rawMacro
  };
}

function ensureTag(
  state: WorkspaceState,
  tagName: string,
  now: string
): { state: WorkspaceState; tagId: string } {
  const normalizedName = normalizeTagName(tagName);
  const existing = findTagByNormalizedName(state, normalizedName);
  if (existing) return { state, tagId: existing.id };
  const id = makeId("tag");
  const tag: TagNode = {
    id,
    userId: state.userId,
    name: tagName.trim(),
    note: null,
    color: DEFAULT_TAG_COLOR,
    normalizedName,
    archive: 0,
    createdAt: now,
    updatedAt: now,
    deletedAt: null
  };
  return {
    state: { ...state, nodes: { ...state.nodes, tags: { ...state.nodes.tags, [id]: tag } } },
    tagId: id
  };
}

function findTagByNormalizedName(state: WorkspaceState, normalizedName: string): TagNode | null {
  return (
    Object.values(state.nodes.tags).find((tag) => tag.normalizedName === normalizedName) || null
  );
}

function normalizeColor(raw: string | null): string | null {
  if (!raw) return null;
  const value = raw.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(value)) return value.toUpperCase();
  return null;
}

function parseSubscriptionRate(raw: string | null): SubscriptionRate | null {
  if (!raw) return null;
  const value = raw.trim();
  const match = value.match(/^\$?(\d+(?:\.\d+)?)\s*(?:\/|per\s+)?(\d+)?\s*(day|week|month|year)s?$/i);
  if (!match) return null;
  const unit = `${match[3].toLowerCase()}s` as SubscriptionRate["intervalUnit"];
  return {
    amount: Number(match[1]),
    currency: "USD",
    intervalCount: match[2] ? Number(match[2]) : 1,
    intervalUnit: unit
  };
}

function formatRate(rate: SubscriptionRate | null): string {
  if (!rate) return "";
  return `${rate.currency} ${rate.amount}/${rate.intervalCount > 1 ? rate.intervalCount : ""}${rate.intervalUnit}`;
}

function getCollection(state: WorkspaceState, nodeType: NodeType): Record<string, AnyNode> {
  if (nodeType === "task") return state.nodes.tasks;
  if (nodeType === "subscription") return state.nodes.subscriptions;
  if (nodeType === "website") return state.nodes.websites;
  if (nodeType === "action") return state.nodes.actions;
  if (nodeType === "tag") return state.nodes.tags;
  if (nodeType === "location") return state.nodes.locations;
  if (nodeType === "identity") return state.nodes.identities;
  return state.nodes.assets;
}

function setNode(state: WorkspaceState, nodeType: NodeType, node: AnyNode): WorkspaceState {
  const now = nowIso();
  if (nodeType === "task") {
    return {
      ...state,
      updatedAt: now,
      nodes: { ...state.nodes, tasks: { ...state.nodes.tasks, [node.id]: node as TaskNode } }
    };
  }
  if (nodeType === "subscription") {
    return {
      ...state,
      updatedAt: now,
      nodes: {
        ...state.nodes,
        subscriptions: { ...state.nodes.subscriptions, [node.id]: node as SubscriptionNode }
      }
    };
  }
  if (nodeType === "website") {
    return {
      ...state,
      updatedAt: now,
      nodes: { ...state.nodes, websites: { ...state.nodes.websites, [node.id]: node as WebsiteNode } }
    };
  }
  if (nodeType === "action") {
    return {
      ...state,
      updatedAt: now,
      nodes: { ...state.nodes, actions: { ...state.nodes.actions, [node.id]: node as ActionNode } }
    };
  }
  if (nodeType === "tag") {
    return {
      ...state,
      updatedAt: now,
      nodes: { ...state.nodes, tags: { ...state.nodes.tags, [node.id]: node as TagNode } }
    };
  }
  if (nodeType === "location") {
    return {
      ...state,
      updatedAt: now,
      nodes: {
        ...state.nodes,
        locations: { ...state.nodes.locations, [node.id]: node as LocationNode }
      }
    };
  }
  if (nodeType === "identity") {
    return {
      ...state,
      updatedAt: now,
      nodes: {
        ...state.nodes,
        identities: { ...state.nodes.identities, [node.id]: node as IdentityNode }
      }
    };
  }
  return {
    ...state,
    updatedAt: now,
    nodes: { ...state.nodes, assets: { ...state.nodes.assets, [node.id]: node as AssetNode } }
  };
}

function resolveIdentityIds(state: WorkspaceState, names: string[]): string[] {
  return names
    .map((name) =>
      Object.values(state.nodes.identities).find(
        (identity) => identity.name.trim().toLowerCase() === name.trim().toLowerCase()
      )
    )
    .filter((identity): identity is IdentityNode => Boolean(identity))
    .map((identity) => identity.id);
}

function unresolvedIdentityNames(state: WorkspaceState, names: string[]): string[] {
  const resolved = new Set(resolveIdentityIds(state, names));
  return names.filter((name) => {
    const identity = Object.values(state.nodes.identities).find(
      (candidate) => candidate.name.trim().toLowerCase() === name.trim().toLowerCase()
    );
    return !identity || !resolved.has(identity.id);
  });
}

function resolveWebsiteId(state: WorkspaceState, name: string | null): string | null {
  if (!name) return null;
  return (
    Object.values(state.nodes.websites).find(
      (website) => website.name.trim().toLowerCase() === name.trim().toLowerCase()
    )?.id || null
  );
}

function resolveAssetId(state: WorkspaceState, name: string | null): string | null {
  if (!name) return null;
  return (
    Object.values(state.nodes.assets).find(
      (asset) => asset.name.trim().toLowerCase() === name.trim().toLowerCase()
    )?.id || null
  );
}

function resolveLocationId(state: WorkspaceState, name: string | null): string | null {
  if (!name) return null;
  return (
    Object.values(state.nodes.locations).find(
      (location) => location.name.trim().toLowerCase() === name.trim().toLowerCase()
    )?.id || null
  );
}
