import type {
  EditorBlock,
  EditorDocument,
  EditorDocumentKey,
  NodeCollections,
  RoutineAsset,
  WorkspaceState
} from "../types";
import { makeId, nowIso } from "../utils/ids";

const routineKeys: EditorDocumentKey[] = [
  "routine_sunday",
  "routine_monday",
  "routine_tuesday",
  "routine_wednesday",
  "routine_thursday",
  "routine_friday",
  "routine_saturday"
];

const routineLabels = [
  "Sunday (U)",
  "Monday (M)",
  "Tuesday (T)",
  "Wednesday (W)",
  "Thursday (R)",
  "Friday (F)",
  "Saturday (S)"
];

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
    websites: {},
    actions: {}
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
    timetable: makeDocument(userId, "timetable", [section("Timetable"), empty()]),
    tags: makeDocument(userId, "tags", [section("Tags"), empty()]),
    profile: makeDocument(userId, "profile", [
      section("Locations"),
      empty(),
      section("Identities"),
      empty(),
      section("Assets"),
      empty()
    ]),
    routine_sunday: makeDocument(userId, "routine_sunday", [section(routineLabels[0]), empty()]),
    routine_monday: makeDocument(userId, "routine_monday", [section(routineLabels[1]), empty()]),
    routine_tuesday: makeDocument(userId, "routine_tuesday", [section(routineLabels[2]), empty()]),
    routine_wednesday: makeDocument(userId, "routine_wednesday", [
      section(routineLabels[3]),
      empty()
    ]),
    routine_thursday: makeDocument(userId, "routine_thursday", [
      section(routineLabels[4]),
      empty()
    ]),
    routine_friday: makeDocument(userId, "routine_friday", [section(routineLabels[5]), empty()]),
    routine_saturday: makeDocument(userId, "routine_saturday", [
      section(routineLabels[6]),
      empty()
    ])
  };

  const routineAsset: RoutineAsset = {
    id: makeId("routine"),
    userId,
    timetableIds: [null, null, null, null, null, null, null],
    createdAt: now,
    updatedAt: now
  };

  return {
    schemaVersion: 1,
    userId,
    documents,
    nodes: emptyNodeCollections(),
    routineAsset,
    createdAt: now,
    updatedAt: now
  };
}

export function getRoutineDocumentKeys(): EditorDocumentKey[] {
  return routineKeys;
}

export function getRoutineLabels(): string[] {
  return routineLabels;
}
