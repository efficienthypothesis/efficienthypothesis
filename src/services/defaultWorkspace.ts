import type {
  EditorBlock,
  EditorDocument,
  EditorDocumentKey,
  NodeCollections,
  WorkspaceState
} from "../types";
import { makeId, nowIso } from "../utils/ids";

function section(label: string): EditorBlock {
  return { type: "section", id: makeId("sec"), label, frozen: true };
}

function empty(): EditorBlock {
  return { type: "empty", id: makeId("blk") };
}

function makeDocument(userId: string, key: EditorDocumentKey, blocks: EditorBlock[]): EditorDocument {
  const now = nowIso();
  return {
    id: makeId("doc"),
    userId,
    key,
    version: 1,
    blocks,
    createdAt: now,
    updatedAt: now
  };
}

export function emptyNodeCollections(): NodeCollections {
  return {
    tags: {},
    locations: {},
    identities: {},
    assets: {},
    tasks: {},
    subscriptions: {},
    websites: {}
  };
}

export function createDefaultWorkspace(userId: string): WorkspaceState {
  const now = nowIso();
  const documents = {
    tasks: makeDocument(userId, "tasks", [section("Tasks"), empty()]),
    websites_subscriptions: makeDocument(userId, "websites_subscriptions", [
      section("Websites"),
      empty(),
      section("Subscriptions"),
      empty()
    ]),
    tags: makeDocument(userId, "tags", [section("Tags"), empty()]),
    profile: makeDocument(userId, "profile", [
      section("Locations"),
      empty(),
      section("Identities"),
      empty(),
      section("Assets"),
      empty()
    ])
  };

  return {
    schemaVersion: 1,
    userId,
    documents,
    nodes: emptyNodeCollections(),
    createdAt: now,
    updatedAt: now
  };
}
