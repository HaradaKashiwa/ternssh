import { useCallback, useEffect, useMemo, useState, type DragEvent, type MouseEvent } from "react";
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderOpen,
  GripVertical,
  Search,
  Server,
  X,
} from "lucide-react";
import { ContextMenu, type ContextMenuItem } from "@/components/ContextMenu";
import { Input } from "@/components/ui/input";
import { useT } from "@/i18n";
import { cn } from "@/lib/utils";
import type { TreeNode } from "@/lib/api";
import { isSessionAlive, type SessionStatus } from "@/lib/sessions";
import {
  collectAllGroupIds,
  collectAncestorGroupIds,
  countGroupChildren,
  countTreeNodes,
  DRAG_MIME,
  filterTreeBySearch,
  flattenTree,
  isGroupDescendant,
  readDragItem,
  writeDragItem,
  type DragItem,
  type DropIntent,
} from "@/lib/server-tree";
import type { ServerListWidgetProps } from "./types";

interface MenuState {
  x: number;
  y: number;
  target:
    | { kind: "root" }
    | { kind: "group"; id: string; name: string; expanded: boolean }
    | { kind: "server"; id: string; name: string };
}

function dropIntentKey(intent: DropIntent | null): string {
  if (!intent) return "";
  if (intent.kind === "into") return `into:${intent.groupId}`;
  return `before:${intent.parentId ?? "root"}:${intent.index}`;
}

export function ServerListWidget({
  tree,
  loading,
  moving,
  context,
  onDeleteServer,
  onDeleteGroup,
  onMoveItem,
  onAddServer,
  onAddGroup,
  onRenameGroup,
  expanded,
  onExpandedChange,
}: ServerListWidgetProps) {
  const t = useT();
  const [searchQuery, setSearchQuery] = useState("");
  const [dragItem, setDragItem] = useState<DragItem | null>(null);
  const [dropIntent, setDropIntent] = useState<DropIntent | null>(null);
  const [menu, setMenu] = useState<MenuState | null>(null);

  const setExpanded = onExpandedChange;

  useEffect(() => {
    if (!context.activeServerId) return;
    const ancestors = collectAncestorGroupIds(
      tree,
      context.activeServerId,
      "server",
    );
    if (ancestors.length === 0) return;
    setExpanded((current) => {
      const next = new Set(current);
      for (const id of ancestors) next.add(id);
      return next;
    });
  }, [context.activeServerId, tree]);

  const trimmedSearch = searchQuery.trim();
  const isSearching = trimmedSearch.length > 0;

  const displayTree = useMemo(
    () => (isSearching ? filterTreeBySearch(tree, trimmedSearch) : tree),
    [isSearching, tree, trimmedSearch],
  );

  const displayExpanded = useMemo(() => {
    if (!isSearching) return expanded;
    return new Set(collectAllGroupIds(displayTree));
  }, [displayTree, expanded, isSearching]);

  const rows = useMemo(
    () => flattenTree(displayTree, displayExpanded),
    [displayTree, displayExpanded],
  );
  const counts = useMemo(() => countTreeNodes(tree), [tree]);

  const expandAll = useCallback(() => {
    setExpanded(new Set(collectAllGroupIds(tree)));
  }, [setExpanded, tree]);

  const collapseAll = useCallback(() => {
    setExpanded(new Set());
  }, [setExpanded]);

  const toggleExpanded = (groupId: string) => {
    setExpanded((current) => {
      const next = new Set(current);
      if (next.has(groupId)) next.delete(groupId);
      else next.add(groupId);
      return next;
    });
  };

  const openContextMenu = (
    event: MouseEvent,
    target: MenuState["target"],
  ) => {
    event.preventDefault();
    event.stopPropagation();
    setMenu({ x: event.clientX, y: event.clientY, target });
  };

  const menuItems = useMemo((): ContextMenuItem[] => {
    if (!menu) return [];

    if (menu.target.kind === "root") {
      return [
        {
          id: "add-server",
          label: t("serverList.addServer"),
          onSelect: () => onAddServer(null),
        },
        {
          id: "add-group",
          label: t("serverList.addGroup"),
          onSelect: () => onAddGroup(null),
        },
        { id: "expand-all", label: t("serverList.expandAll"), onSelect: expandAll },
        { id: "collapse-all", label: t("serverList.collapseAll"), onSelect: collapseAll },
      ];
    }

    if (menu.target.kind === "group") {
      const { id, name, expanded: isOpen } = menu.target;
      return [
        {
          id: "toggle",
          label: isOpen ? t("serverList.collapse") : t("serverList.expand"),
          onSelect: () => toggleExpanded(id),
        },
        {
          id: "add-server",
          label: t("serverList.addServer"),
          onSelect: () => {
            setExpanded((current) => new Set(current).add(id));
            onAddServer(id);
          },
        },
        {
          id: "add-subgroup",
          label: t("serverList.addSubGroup"),
          onSelect: () => {
            setExpanded((current) => new Set(current).add(id));
            onAddGroup(id);
          },
        },
        {
          id: "rename",
          label: t("serverList.rename"),
          onSelect: () => onRenameGroup(id, name),
        },
        {
          id: "delete",
          label: t("serverList.deleteGroup"),
          danger: true,
          onSelect: () => onDeleteGroup(id),
        },
      ];
    }

    const { id } = menu.target;
    const session = context.sessions[id];
    const isActive = context.activeServerId === id;
    const alive = isSessionAlive(session?.status);
    const items: ContextMenuItem[] = [];

    if (alive && !isActive) {
      items.push({
        id: "switch",
        label: t("serverList.switch"),
        onSelect: () => context.onSelectServer(id),
      });
    }
    if (alive) {
      items.push({
        id: "disconnect",
        label: t("serverList.disconnect"),
        onSelect: () => context.onDisconnectServer(id),
      });
    } else {
      items.push({
        id: "connect",
        label: t("serverList.connect"),
        onSelect: () => void context.onConnectServer(id),
      });
    }
    items.push({
      id: "select",
      label: t("serverList.select"),
      onSelect: () => context.onSelectServer(id),
    });
    items.push({
      id: "delete",
      label: t("serverList.delete"),
      danger: true,
      onSelect: () => onDeleteServer(id),
    });
    return items;
  }, [menu, context, collapseAll, expandAll, onAddGroup, onAddServer, onDeleteGroup, onDeleteServer, onRenameGroup, t]);

  const canDrop = (item: DragItem, intent: DropIntent): boolean => {
    if (item.type === "group" && intent.kind === "into" && item.id === intent.groupId) {
      return false;
    }
    if (
      item.type === "group" &&
      intent.kind === "into" &&
      isGroupDescendant(tree, intent.groupId, item.id)
    ) {
      return false;
    }
    if (
      item.type === "group" &&
      intent.kind === "before" &&
      intent.parentId &&
      isGroupDescendant(tree, intent.parentId, item.id)
    ) {
      return false;
    }
    return true;
  };

  const handleDragStart = (
    event: DragEvent<HTMLButtonElement>,
    item: DragItem,
  ) => {
    writeDragItem(event.dataTransfer, item);
    setDragItem(item);
  };

  const handleDragEnd = () => {
    setDragItem(null);
    setDropIntent(null);
  };

  const handleRootDragOver = (event: DragEvent<HTMLDivElement>) => {
    if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
    event.preventDefault();
    const item = dragItem ?? readDragItem(event.dataTransfer);
    if (!item) return;

    const intent: DropIntent = { kind: "before", parentId: null, index: tree.length };
    if (canDrop(item, intent)) {
      event.dataTransfer.dropEffect = "move";
      setDropIntent(intent);
    }
  };

  const handleDrop = async (event: DragEvent<HTMLElement>, intent: DropIntent) => {
    event.preventDefault();
    event.stopPropagation();

    const item = readDragItem(event.dataTransfer) ?? dragItem;
    setDragItem(null);
    setDropIntent(null);
    if (!item || !canDrop(item, intent)) return;

    if (intent.kind === "into") {
      await onMoveItem({
        type: item.type,
        id: item.id,
        parentId: intent.groupId,
        index: countGroupChildren(tree, intent.groupId),
      });
      setExpanded((current) => new Set(current).add(intent.groupId));
      return;
    }

    await onMoveItem({
      type: item.type,
      id: item.id,
      parentId: intent.parentId,
      index: intent.index,
    });
  };

  const sessionStatusClass = (status: SessionStatus | undefined) => {
    if (status === "open") return "bg-[var(--color-primary)]";
    if (status === "connecting") return "bg-[var(--color-warning)]";
    if (status === "error") return "bg-[var(--color-destructive)]";
    if (status === "closed") return "bg-[var(--color-muted-foreground)]";
    return "bg-transparent";
  };

  const renderNodeLabel = (node: TreeNode, isOpen: boolean) => {
    if (node.type === "group") {
      const Icon = isOpen ? FolderOpen : Folder;
      return (
        <>
          <Icon className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
          <span className="truncate font-medium">{node.name}</span>
          <span className="ml-auto shrink-0 text-xs text-[var(--color-muted-foreground)]">
            {node.children.length}
          </span>
        </>
      );
    }

    const session = context.sessions[node.id];
    const status = session?.status;

    return (
      <>
        <Server className="h-3.5 w-3.5 shrink-0 text-[var(--color-muted-foreground)]" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 truncate">
            <span className="truncate">{node.name}</span>
            {status && (
              <span className="shrink-0 text-[10px] text-[var(--color-muted-foreground)]">
                {t(`session.${status}`)}
              </span>
            )}
          </div>
          <div className="truncate text-xs text-[var(--color-muted-foreground)]">
            {node.username}@{node.host}:{node.port}
          </div>
        </div>
        <span
          className={cn(
            "ml-auto h-2 w-2 shrink-0 rounded-full",
            sessionStatusClass(status),
          )}
          title={status ? t(`session.${status}`) : undefined}
        />
      </>
    );
  };

  return (
    <>
      <div
        className="widget-no-drag flex h-full flex-col overflow-hidden p-2"
        onContextMenu={(event) => openContextMenu(event, { kind: "root" })}
        onDragOver={isSearching ? undefined : handleRootDragOver}
        onDrop={
          isSearching
            ? undefined
            : (event) => {
                if (dropIntent?.kind === "before" && dropIntent.parentId === null) {
                  void handleDrop(event, dropIntent);
                }
              }
        }
      >
        <div className="relative mb-2 shrink-0">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--color-muted-foreground)]" />
          <Input
            className="h-8 pl-8 pr-8 text-xs"
            value={searchQuery}
            placeholder={t("serverList.searchPlaceholder")}
            onChange={(event) => setSearchQuery(event.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="absolute right-1 top-1/2 inline-flex h-6 w-6 -translate-y-1/2 items-center justify-center text-[var(--color-muted-foreground)] hover:text-[var(--color-foreground)]"
              aria-label={t("serverList.clearSearch")}
              onClick={() => setSearchQuery("")}
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>

        <div className="min-h-0 flex-1 overflow-auto">
        {loading && (
          <p className="px-2 py-1 text-sm text-[var(--color-muted-foreground)]">
            {t("serverList.loading")}
          </p>
        )}
        {!loading && counts.servers === 0 && counts.groups === 0 && (
          <p className="px-2 py-1 text-sm text-[var(--color-muted-foreground)]">
            {t("serverList.empty")}
          </p>
        )}
        {!loading && isSearching && rows.length === 0 && counts.servers > 0 && (
          <p className="px-2 py-1 text-sm text-[var(--color-muted-foreground)]">
            {t("serverList.noSearchResults")}
          </p>
        )}
        {moving && !isSearching && (
          <p className="mb-1 px-2 text-xs text-[var(--color-muted-foreground)]">
            {t("serverList.moving")}
          </p>
        )}

        <div className="min-h-0">
          {rows.map((row) => {
            const { node, depth, parentId, index } = row;
            const isGroup = node.type === "group";
            const isOpen = isGroup && displayExpanded.has(node.id);
            const isActive = !isGroup && context.activeServerId === node.id;
            const session = !isGroup ? context.sessions[node.id] : undefined;
            const connected = isSessionAlive(session?.status);
            const beforeIntent: DropIntent = {
              kind: "before",
              parentId,
              index,
            };
            const intoIntent: DropIntent = isGroup
              ? { kind: "into", groupId: node.id }
              : beforeIntent;
            const showBeforeDrop =
              dropIntent &&
              dropIntentKey(dropIntent) === dropIntentKey(beforeIntent);
            const showIntoDrop =
              isGroup &&
              dropIntent &&
              dropIntentKey(dropIntent) === dropIntentKey(intoIntent);

            return (
              <div key={`${node.type}:${node.id}`}>
                <div
                  className={cn(
                    "relative h-0.5 transition-colors",
                    showBeforeDrop && "bg-[var(--color-primary)]",
                  )}
                  onDragOver={
                    isSearching
                      ? undefined
                      : (event) => {
                          if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
                          event.preventDefault();
                          event.stopPropagation();
                          const item = dragItem ?? readDragItem(event.dataTransfer);
                          if (!item || !canDrop(item, beforeIntent)) return;
                          event.dataTransfer.dropEffect = "move";
                          setDropIntent(beforeIntent);
                        }
                  }
                  onDrop={
                    isSearching
                      ? undefined
                      : (event) => void handleDrop(event, beforeIntent)
                  }
                />

                <div
                  className={cn(
                    "group flex items-center gap-1 py-0.5 pr-1 transition-colors hover:bg-[var(--color-secondary)]/50",
                    isActive && "bg-[var(--color-secondary)]",
                    connected && !isActive && "bg-[var(--color-secondary)]/30",
                    showIntoDrop && "bg-[var(--color-secondary)]/70",
                  )}
                  style={{ paddingLeft: depth * 16 + 4 }}
                  onContextMenu={(event) =>
                    openContextMenu(
                      event,
                      isGroup
                        ? {
                            kind: "group",
                            id: node.id,
                            name: node.name,
                            expanded: isOpen,
                          }
                        : { kind: "server", id: node.id, name: node.name },
                    )
                  }
                  onDragOver={
                    isSearching
                      ? undefined
                      : isGroup
                        ? (event) => {
                            if (!event.dataTransfer.types.includes(DRAG_MIME)) return;
                            event.preventDefault();
                            event.stopPropagation();
                            const item =
                              dragItem ?? readDragItem(event.dataTransfer);
                            if (!item || !canDrop(item, intoIntent)) return;
                            event.dataTransfer.dropEffect = "move";
                            setDropIntent(intoIntent);
                          }
                        : undefined
                  }
                  onDrop={
                    isSearching
                      ? undefined
                      : isGroup
                        ? (event) => void handleDrop(event, intoIntent)
                        : undefined
                  }
                >
                  <button
                    type="button"
                    className={cn(
                      "widget-no-drag inline-flex h-6 w-5 shrink-0 items-center justify-center text-[var(--color-muted-foreground)]",
                      isSearching
                        ? "invisible"
                        : "cursor-grab opacity-0 transition-opacity group-hover:opacity-100 active:cursor-grabbing",
                    )}
                    draggable={!isSearching}
                    onDragStart={(event) =>
                      handleDragStart(event, {
                        type: isGroup ? "group" : "server",
                        id: node.id,
                      })
                    }
                    onDragEnd={handleDragEnd}
                    aria-label={t("serverList.dragSort")}
                    aria-hidden={isSearching}
                    tabIndex={isSearching ? -1 : 0}
                  >
                    <GripVertical className="h-3.5 w-3.5" />
                  </button>

                  {isGroup ? (
                    <button
                      type="button"
                      className="widget-no-drag inline-flex h-6 w-5 shrink-0 items-center justify-center text-[var(--color-muted-foreground)]"
                      onClick={() => toggleExpanded(node.id)}
                      aria-label={isOpen ? t("serverList.collapse") : t("serverList.expand")}
                    >
                      {isOpen ? (
                        <ChevronDown className="h-3.5 w-3.5" />
                      ) : (
                        <ChevronRight className="h-3.5 w-3.5" />
                      )}
                    </button>
                  ) : (
                    <span className="inline-block w-5 shrink-0" />
                  )}

                  <button
                    type="button"
                    className="widget-no-drag flex min-w-0 flex-1 items-center gap-2 text-left text-sm"
                    onClick={() => {
                      if (isGroup) {
                        toggleExpanded(node.id);
                        return;
                      }
                      context.onSelectServer(node.id);
                    }}
                    onDoubleClick={() => {
                      if (!isGroup) void context.onConnectServer(node.id);
                    }}
                  >
                    {renderNodeLabel(node, isOpen)}
                  </button>
                </div>
              </div>
            );
          })}

          {dragItem && !isSearching && (
            <div
              className={cn(
                "mt-1 h-7 text-center text-xs leading-7 text-[var(--color-muted-foreground)]",
                dropIntent?.kind === "before" &&
                  dropIntent.parentId === null &&
                  dropIntent.index === tree.length &&
                  "bg-[var(--color-secondary)] text-[var(--color-primary)]",
              )}
              onDragOver={handleRootDragOver}
              onDrop={(event) => {
                const intent: DropIntent = {
                  kind: "before",
                  parentId: null,
                  index: tree.length,
                };
                void handleDrop(event, intent);
              }}
            >
              {t("serverList.dropToRoot")}
            </div>
          )}
        </div>
        </div>
      </div>

      <ContextMenu
        open={menu !== null}
        x={menu?.x ?? 0}
        y={menu?.y ?? 0}
        items={menuItems}
        onClose={() => setMenu(null)}
      />
    </>
  );
}
