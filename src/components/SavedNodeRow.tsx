import type { AnyNode, AssetNode, IdentityNode, NodeType, WorkspaceState } from "../types";
import { formatDateTimeLocal, formatTimeLocal } from "../utils/date";
import { getNodeByType, getTagColor, getTagName } from "../services/nodeService";

type SavedNodeRowProps = {
  state: WorkspaceState;
  nodeType: NodeType;
  nodeId: string;
  collapsedNote?: boolean;
  onEdit: () => void;
};

export function SavedNodeRow({
  state,
  nodeType,
  nodeId,
  collapsedNote = true,
  onEdit
}: SavedNodeRowProps) {
  const node = getNodeByType(state, nodeType, nodeId);
  if (!node) {
    return <div className="saved-row missing">Missing node: {nodeId}</div>;
  }

  const fields = getFields(state, nodeType, node);
  const tagColor = "tagId" in node ? getTagColor(state, node.tagId) : null;
  const note = "note" in node ? node.note : null;

  return (
    <button
      type="button"
      className="saved-row"
      style={tagColor ? { ["--tag-color" as string]: tagColor } : undefined}
      onDoubleClick={onEdit}
      onClick={(event) => {
        if (event.detail === 1) return;
        onEdit();
      }}
    >
      <div className="saved-fields">
        <div className="saved-field saved-field-name">
          <span className="field-label">A:</span> {fields[0]}
        </div>
        <div className="saved-field">
          <span className="field-label">B:</span> {fields[1]}
        </div>
        <div className="saved-field">
          <span className="field-label">C:</span> {fields[2]}
        </div>
      </div>
      {note ? (
        <div className="note-preview">
          {collapsedNote ? note.split("\n")[0] : note}
        </div>
      ) : null}
    </button>
  );
}

function getFields(state: WorkspaceState, nodeType: NodeType, node: AnyNode): [string, string, string] {
  if (nodeType === "task" && "datetimeUtc" in node) {
    return [node.name, formatDateTimeLocal(node.datetimeUtc), getTagName(state, node.tagId)];
  }
  if (nodeType === "subscription" && "rate" in node) {
    const rate = node.rate
      ? `${node.rate.currency} ${node.rate.amount}/${node.rate.intervalCount > 1 ? node.rate.intervalCount : ""}${node.rate.intervalUnit}`
      : "";
    return [node.name, rate, getTagName(state, node.tagId)];
  }
  if (nodeType === "website" && "identityIds" in node) {
    const identities = [
      ...node.identityIds.map((id) => state.nodes.identities[id]?.name || id),
      ...node.unresolvedIdentities.map((name) => `${name} ?`)
    ].join(", ");
    return [node.name, identities, getTagName(state, node.tagId)];
  }
  if (nodeType === "action" && "timeLocal" in node) {
    return [node.name, formatTimeLocal(node.timeLocal), getTagName(state, node.tagId)];
  }
  if (nodeType === "tag" && "color" in node) {
    return [node.name, node.color, ""];
  }
  if (nodeType === "location" && "address" in node) {
    return [node.name, node.address || "", ""];
  }
  if (nodeType === "identity") {
    const identity = node as IdentityNode;
    const reference =
      identity.referenceWebsiteId
        ? state.nodes.websites[identity.referenceWebsiteId]?.name
        : identity.referenceAssetId
          ? state.nodes.assets[identity.referenceAssetId]?.name
          : identity.unresolvedReference || "";
    return [identity.name, reference || "", getTagName(state, identity.tagId)];
  }
  if (nodeType === "asset") {
    const asset = node as AssetNode;
    const reference = asset.referenceLocationId
      ? state.nodes.locations[asset.referenceLocationId]?.name
      : asset.unresolvedReference || "";
    return [asset.name, reference || "", getTagName(state, asset.tagId)];
  }
  return [node.name, "", ""];
}
