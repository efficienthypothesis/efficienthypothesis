import type {
  ActionNode,
  DailyTimetableState,
  EditorBlock,
  EditorDocument,
  EditorDocumentKey,
  WorkspaceState
} from "../types";
import { getRoutineDocumentKeys } from "./defaultWorkspace";
import { makeId, nowIso } from "../utils/ids";
import { ensureTrailingEmptyLine } from "../utils/model";

type RolloverResult = {
  state: WorkspaceState;
  changed: boolean;
  activeLocalDate: string;
};

const timetableSectionLabel = "Timetable";

export function applyRoutineRollover(state: WorkspaceState, date = new Date()): RolloverResult {
  const activeLocalDate = formatLocalDateKey(date);
  const routineDocumentKey = getRoutineDocumentKeys()[date.getDay()];
  const dailyTimetable = normalizeDailyTimetable(state);

  if (
    dailyTimetable.activeLocalDate === activeLocalDate &&
    dailyTimetable.activeRoutineDocumentKey === routineDocumentKey
  ) {
    return {
      state: state.dailyTimetable ? state : { ...state, dailyTimetable },
      changed: false,
      activeLocalDate
    };
  }

  const now = nowIso();
  const archivedActions = archiveCurrentTimetableActions(state, now);
  const materialized = materializeRoutineDocument(
    {
      ...state,
      nodes: {
        ...state.nodes,
        actions: archivedActions
      }
    },
    routineDocumentKey,
    now
  );

  const nextDailyTimetable: DailyTimetableState = {
    activeLocalDate,
    activeRoutineDocumentKey: routineDocumentKey,
    activeTimetableDocumentId: materialized.document.id,
    updatedAt: now
  };

  return {
    state: {
      ...state,
      documents: {
        ...state.documents,
        timetable: materialized.document
      },
      nodes: {
        ...state.nodes,
        actions: materialized.actions
      },
      dailyTimetable: nextDailyTimetable,
      updatedAt: now
    },
    changed: true,
    activeLocalDate
  };
}

export function formatLocalDateKey(date = new Date()): string {
  const year = date.getFullYear();
  const month = `${date.getMonth() + 1}`.padStart(2, "0");
  const day = `${date.getDate()}`.padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function normalizeDailyTimetable(state: WorkspaceState): DailyTimetableState {
  return (
    state.dailyTimetable || {
      activeLocalDate: null,
      activeRoutineDocumentKey: null,
      activeTimetableDocumentId: null,
      updatedAt: state.updatedAt
    }
  );
}

function archiveCurrentTimetableActions(
  state: WorkspaceState,
  now: string
): Record<string, ActionNode> {
  const actions = { ...state.nodes.actions };
  for (const block of state.documents.timetable.blocks) {
    if (block.type !== "saved_node" || block.nodeType !== "action") continue;
    const action = actions[block.nodeId];
    if (!action || action.archive !== 0 || action.deletedAt) continue;
    actions[action.id] = {
      ...action,
      archive: 1,
      deletedAt: null,
      updatedAt: now
    };
  }
  return actions;
}

function materializeRoutineDocument(
  state: WorkspaceState,
  routineDocumentKey: EditorDocumentKey,
  now: string
): { document: EditorDocument; actions: Record<string, ActionNode> } {
  const routineDocument = state.documents[routineDocumentKey];
  const actions = { ...state.nodes.actions };
  const blocks: EditorBlock[] = [
    { type: "section", id: makeId("sec"), label: timetableSectionLabel, frozen: true }
  ];

  for (const block of routineDocument.blocks) {
    if (block.type === "section") continue;
    if (block.type === "saved_node") {
      if (block.nodeType !== "action") continue;
      const templateAction = state.nodes.actions[block.nodeId];
      if (!templateAction || templateAction.archive !== 0 || templateAction.deletedAt) continue;
      const actionId = makeId("action");
      actions[actionId] = {
        ...templateAction,
        id: actionId,
        userId: state.userId,
        archive: 0,
        deletedAt: null,
        createdAt: now,
        updatedAt: now
      };
      blocks.push({
        type: "saved_node",
        id: makeId("blk"),
        nodeType: "action",
        nodeId: actionId,
        collapsedNote: block.collapsedNote ?? true
      });
      continue;
    }
    if (block.type === "free_text") {
      blocks.push({ type: "free_text", id: makeId("blk"), text: block.text });
      continue;
    }
    if (block.type === "draft_item") {
      blocks.push({
        type: "draft_item",
        id: makeId("blk"),
        raw: block.raw,
        inferredNodeType: "action",
        parseState: block.parseState,
        error: block.error
      });
      continue;
    }
    blocks.push({ type: "empty", id: makeId("blk") });
  }

  return {
    actions,
    document: {
      id: makeId("doc"),
      userId: state.userId,
      key: "timetable",
      version: 1,
      blocks: ensureTrailingEmptyLine(blocks),
      createdAt: now,
      updatedAt: now
    }
  };
}
