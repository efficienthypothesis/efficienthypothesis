export type ArchiveLevel = 0 | 1 | 2;

export type NodeType =
  | "task"
  | "subscription"
  | "website"
  | "action"
  | "tag"
  | "location"
  | "identity"
  | "asset";

export type EditorDocumentKey =
  | "tasks"
  | "websites_subscriptions"
  | "timetable"
  | "tags"
  | "profile"
  | "routine_sunday"
  | "routine_monday"
  | "routine_tuesday"
  | "routine_wednesday"
  | "routine_thursday"
  | "routine_friday"
  | "routine_saturday";

export type EditorDocument = {
  id: string;
  userId: string;
  key: EditorDocumentKey;
  version: number;
  blocks: EditorBlock[];
  createdAt: string;
  updatedAt: string;
};

export type SectionBlock = {
  type: "section";
  id: string;
  label: string;
  frozen: true;
};

export type EmptyLineBlock = {
  type: "empty";
  id: string;
};

export type FreeTextBlock = {
  type: "free_text";
  id: string;
  text: string;
};

export type DraftItemBlock = {
  type: "draft_item";
  id: string;
  raw: string;
  inferredNodeType: NodeType;
  parseState: "open" | "invalid";
  error?: string;
  editingNodeId?: string;
  editingNodeType?: NodeType;
};

export type SavedNodeBlock = {
  type: "saved_node";
  id: string;
  nodeType: NodeType;
  nodeId: string;
  collapsedNote?: boolean;
};

export type EditorBlock =
  | SectionBlock
  | EmptyLineBlock
  | FreeTextBlock
  | DraftItemBlock
  | SavedNodeBlock;

export type BaseNode = {
  id: string;
  userId: string;
  name: string;
  archive: ArchiveLevel;
  createdAt: string;
  updatedAt: string;
  deletedAt?: string | null;
  rawMacro?: string;
};

export type TagNode = BaseNode & {
  note: string | null;
  color: string;
  normalizedName: string;
};

export type LocationNode = BaseNode & {
  address: string | null;
};

export type IdentityNode = BaseNode & {
  referenceWebsiteId: string | null;
  referenceAssetId: string | null;
  unresolvedReference: string | null;
  tagId: string | null;
};

export type AssetNode = BaseNode & {
  referenceLocationId: string | null;
  unresolvedReference: string | null;
  tagId: string | null;
};

export type RoutineAsset = {
  id: string;
  userId: string;
  timetableIds: [
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null,
    string | null
  ];
  createdAt: string;
  updatedAt: string;
};

export type DailyTimetableState = {
  activeLocalDate: string | null;
  activeRoutineDocumentKey: EditorDocumentKey | null;
  activeTimetableDocumentId: string | null;
  updatedAt: string;
};

export type TaskNode = BaseNode & {
  note: string | null;
  datetimeUtc: string | null;
  datetimeRaw?: string | null;
  datetimeHasTime?: boolean;
  tagId: string | null;
};

export type SubscriptionRate = {
  amount: number;
  currency: string;
  intervalCount: number;
  intervalUnit: "days" | "weeks" | "months" | "years";
};

export type SubscriptionNode = BaseNode & {
  note: string | null;
  rate: SubscriptionRate | null;
  tagId: string | null;
};

export type WebsiteNode = BaseNode & {
  note: string | null;
  identityIds: string[];
  unresolvedIdentities: string[];
  tagId: string | null;
};

export type ActionNode = BaseNode & {
  note: string | null;
  timeLocal: string | null;
  tagId: string | null;
};

export type NodeCollections = {
  tags: Record<string, TagNode>;
  locations: Record<string, LocationNode>;
  identities: Record<string, IdentityNode>;
  assets: Record<string, AssetNode>;
  tasks: Record<string, TaskNode>;
  subscriptions: Record<string, SubscriptionNode>;
  websites: Record<string, WebsiteNode>;
  actions: Record<string, ActionNode>;
};

export type AnyNode =
  | TagNode
  | LocationNode
  | IdentityNode
  | AssetNode
  | TaskNode
  | SubscriptionNode
  | WebsiteNode
  | ActionNode;

export type WorkspaceState = {
  schemaVersion: 1;
  userId: string;
  documents: Record<EditorDocumentKey, EditorDocument>;
  nodes: NodeCollections;
  routineAsset: RoutineAsset;
  dailyTimetable?: DailyTimetableState;
  createdAt: string;
  updatedAt: string;
};

export type EHUser = {
  id: string;
  email: string;
  name?: string;
  picture?: string;
};

export type BootstrapPayload = {
  user: EHUser;
  initialPage?: string;
};
