import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderPlus, ChevronsDown, ChevronsUp, Plus, Settings, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, type Dashboard, type MeResponse, type Server, type TreeNode } from "@/lib/api";
import {
  isSessionAlive,
  MAX_SESSION_RECONNECT_ATTEMPTS,
  SESSION_RECONNECT_DELAY_MS,
  type ServerSession,
  type SessionStatus,
} from "@/lib/sessions";
import { WorkspaceHeader } from "@/components/WorkspaceHeader";
import { useI18n } from "@/i18n";
import { usePersonalization } from "@/theme";
import { parseStatusWidgetConfig } from "@/lib/status-widget-config";
import { ServerListWidget } from "@/widgets/ServerListWidget";
import { FileManagerWidget } from "@/widgets/FileManagerWidget";
import { QuickCommandsWidget } from "@/widgets/QuickCommandsWidget";
import { StatusWidget } from "@/widgets/StatusWidget";
import { NetworkStatusWidget } from "@/widgets/NetworkStatusWidget";
import { ProcessStatusWidget } from "@/widgets/ProcessStatusWidget";
import { TerminalWidget } from "@/widgets/TerminalWidget";
import { AddGroupDialog } from "./AddGroupDialog";
import { AddQuickCommandDialog } from "./AddQuickCommandDialog";
import { AddServerDialog } from "./AddServerDialog";
import { CopyServerDialog } from "./CopyServerDialog";
import { EditServerDialog } from "./EditServerDialog";
import { RenameGroupDialog } from "./RenameGroupDialog";
import { StatusSettingsDialog } from "./StatusSettingsDialog";
import { AddWidgetMenu } from "./AddWidgetMenu";
import { GridDashboard } from "./GridDashboard";
import { findWidgetPlacement, layoutsEqual, type GridItem } from "./grid-utils";
import { collectAllGroupIds, findServerInTree } from "@/lib/server-tree";
import {
  parseQuickCommandsConfig,
  serializeQuickCommandsConfig,
  type QuickCommandTargetMode,
} from "@/lib/quick-commands-config";
import { ADDABLE_WIDGETS, widgetTitleKey } from "./widgets";

const DEFAULT_GRID_ITEM = {
  minW: 2,
  minH: 3,
  maxW: 12,
} as const;

function widgetsToLayout(widgets: Dashboard["widgets"]): GridItem[] {
  return widgets.map((widget) => ({
    i: widget.id,
    x: widget.grid_x,
    y: widget.grid_y,
    w: widget.grid_w,
    h: widget.grid_h,
    ...DEFAULT_GRID_ITEM,
  }));
}

function layoutToWidgets(
  dashboard: Dashboard,
  layout: GridItem[],
): Dashboard["widgets"] {
  const byId = new Map(dashboard.widgets.map((widget) => [widget.id, widget]));

  return layout
    .map((item) => {
      const widget = byId.get(item.i);
      if (!widget) return null;
      return {
        ...widget,
        grid_x: item.x,
        grid_y: item.y,
        grid_w: item.w,
        grid_h: item.h,
      };
    })
    .filter((widget): widget is Dashboard["widgets"][number] => widget !== null);
}

export function DashboardView() {
  const { t } = useI18n();
  const { gridMargin } = usePersonalization();
  const [me, setMe] = useState<MeResponse | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [layout, setLayout] = useState<GridItem[]>([]);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [treeMoving, setTreeMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Record<string, ServerSession>>({});
  const [serverListExpanded, setServerListExpanded] = useState<Set<string>>(
    () => new Set(),
  );
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const [addOpen, setAddOpen] = useState(false);
  const [addGroupId, setAddGroupId] = useState<string | null>(null);
  const [copyOpen, setCopyOpen] = useState(false);
  const [copySource, setCopySource] = useState<Server | null>(null);
  const [editOpen, setEditOpen] = useState(false);
  const [editServer, setEditServer] = useState<Server | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupParentId, setGroupParentId] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameGroupId, setRenameGroupId] = useState<string | null>(null);
  const [renameGroupName, setRenameGroupName] = useState("");
  const [quickCommandAddWidgetId, setQuickCommandAddWidgetId] = useState<
    string | null
  >(null);
  const [pollSettingsWidgetId, setPollSettingsWidgetId] = useState<
    string | null
  >(null);
  const dashboardRef = useRef<Dashboard | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const isEditingRef = useRef(false);
  const manualDisconnectRef = useRef(new Set<string>());
  const reconnectAttemptRef = useRef(new Map<string, number>());
  const reconnectTimerRef = useRef(new Map<string, number>());

  const clearReconnectTimer = useCallback((serverId: string) => {
    const timer = reconnectTimerRef.current.get(serverId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      reconnectTimerRef.current.delete(serverId);
    }
  }, []);

  const clearReconnectState = useCallback(
    (serverId: string) => {
      clearReconnectTimer(serverId);
      reconnectAttemptRef.current.delete(serverId);
    },
    [clearReconnectTimer],
  );

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [dashboardResponse, treeResponse] = await Promise.all([
        api.getDashboard(),
        api.getServerTree(),
      ]);
      dashboardRef.current = dashboardResponse;
      setDashboard(dashboardResponse);
      setTree(treeResponse.tree);

      if (!isEditingRef.current) {
        setLayout(widgetsToLayout(dashboardResponse.widgets));
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dashboard.loadFailed"));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void api.getMe().then(setMe).catch(console.error);
  }, []);

  useEffect(() => {
    void load();
  }, [load, t]);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
      }
      for (const timer of reconnectTimerRef.current.values()) {
        window.clearTimeout(timer);
      }
      reconnectTimerRef.current.clear();
    };
  }, []);

  const scheduleReconnect = useCallback(
    (serverId: string) => {
      if (manualDisconnectRef.current.has(serverId)) return;
      if (!sessionsRef.current[serverId]) return;

      const nextAttempt = (reconnectAttemptRef.current.get(serverId) ?? 0) + 1;
      if (nextAttempt > MAX_SESSION_RECONNECT_ATTEMPTS) {
        reconnectAttemptRef.current.delete(serverId);
        setSessions((current) => {
          const session = current[serverId];
          if (!session) return current;
          return {
            ...current,
            [serverId]: {
              ...session,
              status: "closed",
              reconnectAttempt: undefined,
            },
          };
        });
        setError(
          t("session.reconnectFailed", {
            count: MAX_SESSION_RECONNECT_ATTEMPTS,
          }),
        );
        return;
      }

      reconnectAttemptRef.current.set(serverId, nextAttempt);
      setSessions((current) => {
        const session = current[serverId];
        if (!session) return current;
        return {
          ...current,
          [serverId]: {
            ...session,
            status: "connecting",
            reconnectAttempt: nextAttempt,
          },
        };
      });

      clearReconnectTimer(serverId);
      const timer = window.setTimeout(() => {
        reconnectTimerRef.current.delete(serverId);
        void (async () => {
          if (manualDisconnectRef.current.has(serverId)) return;
          if (!sessionsRef.current[serverId]) return;

          try {
            const created = await api.createSession(serverId);
            if (manualDisconnectRef.current.has(serverId)) return;
            if (!sessionsRef.current[serverId]) return;

            setSessions((current) => ({
              ...current,
              [serverId]: {
                serverId,
                sessionId: created.sessionId,
                wsUrl: created.wsUrl,
                sftpWsUrl: created.sftpWsUrl,
                status: "connecting",
                reconnectAttempt: nextAttempt,
              },
            }));
          } catch {
            scheduleReconnect(serverId);
          }
        })();
      }, SESSION_RECONNECT_DELAY_MS);
      reconnectTimerRef.current.set(serverId, timer);
    },
    [clearReconnectTimer],
  );

  const handleSessionStatusChange = useCallback(
    (serverId: string, status: SessionStatus) => {
      if (status === "open") {
        clearReconnectState(serverId);
      }
      setSessions((current) => {
        const session = current[serverId];
        if (!session || session.status === status) return current;
        return {
          ...current,
          [serverId]: {
            ...session,
            status,
            reconnectAttempt:
              status === "open" ? undefined : session.reconnectAttempt,
          },
        };
      });
    },
    [clearReconnectState],
  );

  const handleSessionClosed = useCallback(
    (serverId: string) => {
      if (manualDisconnectRef.current.has(serverId)) {
        manualDisconnectRef.current.delete(serverId);
        return;
      }
      scheduleReconnect(serverId);
    },
    [scheduleReconnect],
  );

  const handleDisconnectServer = useCallback(
    (serverId: string) => {
      manualDisconnectRef.current.add(serverId);
      clearReconnectState(serverId);
      setSessions((current) => {
        const next = { ...current };
        delete next[serverId];
        setActiveServerId((active) => {
          if (active !== serverId) return active;
          return Object.keys(next)[0] ?? null;
        });
        return next;
      });
    },
    [clearReconnectState],
  );

  const handleConnectServer = useCallback(async (serverId: string) => {
    manualDisconnectRef.current.delete(serverId);
    clearReconnectState(serverId);
    setActiveServerId(serverId);
    const existing = sessionsRef.current[serverId];
    if (existing && isSessionAlive(existing.status)) {
      return;
    }

    try {
      const session = await api.createSession(serverId);
      setSessions((current) => ({
        ...current,
        [serverId]: {
          serverId,
          sessionId: session.sessionId,
          wsUrl: session.wsUrl,
          sftpWsUrl: session.sftpWsUrl,
          status: "connecting",
        },
      }));
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dashboard.createSessionFailed"));
    }
  }, [clearReconnectState, t]);

  const widgetContext = useMemo(
    () => ({
      activeServerId,
      sessions,
      onSelectServer: setActiveServerId,
      onConnectServer: (serverId: string) => {
        void handleConnectServer(serverId);
      },
      onDisconnectServer: handleDisconnectServer,
    }),
    [activeServerId, sessions, handleConnectServer, handleDisconnectServer],
  );

  const sessionList = useMemo(
    () => Object.values(sessions),
    [sessions],
  );

  const terminalBadge = useMemo(() => {
    const active = activeServerId ? sessions[activeServerId] : null;
    if (!active) {
      const openCount = sessionList.filter((item) => item.status === "open").length;
      return openCount > 0
        ? t("dashboard.sessionCount", { count: openCount })
        : t("common.idle");
    }
    return t(`session.${active.status}`);
  }, [activeServerId, sessionList, sessions, t]);

  const existingWidgetTypes = useMemo(
    () => new Set(dashboard?.widgets.map((widget) => widget.type) ?? []),
    [dashboard?.widgets],
  );

  const hasServerGroups = useMemo(
    () => collectAllGroupIds(tree).length > 0,
    [tree],
  );

  const expandAllServerGroups = useCallback(() => {
    setServerListExpanded(new Set(collectAllGroupIds(tree)));
  }, [tree]);

  const collapseAllServerGroups = useCallback(() => {
    setServerListExpanded(new Set());
  }, []);

  const handleLayoutChange = useCallback((nextLayout: GridItem[]) => {
    isEditingRef.current = true;
    setLayout((current) =>
      layoutsEqual(current, nextLayout) ? current : nextLayout,
    );

    const dashboardSnapshot = dashboardRef.current;
    if (!dashboardSnapshot) return;

    if (persistTimerRef.current !== null) {
      window.clearTimeout(persistTimerRef.current);
    }

    persistTimerRef.current = window.setTimeout(() => {
      void (async () => {
        const widgets = layoutToWidgets(dashboardSnapshot, nextLayout);
        try {
          const updated = await api.updateDashboard({ widgets });
          dashboardRef.current = updated;
          setDashboard(updated);
        } catch (err) {
          setError(err instanceof Error ? err.message : t("dashboard.saveLayoutFailed"));
        } finally {
          isEditingRef.current = false;
        }
      })();
    }, 400);
  }, []);

  const handleRemoveWidget = useCallback((widgetId: string) => {
    const dashboardSnapshot = dashboardRef.current;
    if (!dashboardSnapshot) return;

    const nextLayout = layout.filter((item) => item.i !== widgetId);
    if (nextLayout.length === layout.length) return;

    isEditingRef.current = true;
    setLayout(nextLayout);

    void (async () => {
      const widgets = layoutToWidgets(dashboardSnapshot, nextLayout);
      try {
        const updated = await api.updateDashboard({ widgets });
        dashboardRef.current = updated;
        setDashboard(updated);
      } catch (err) {
        setError(err instanceof Error ? err.message : t("dashboard.deleteWidgetFailed"));
        setLayout(widgetsToLayout(dashboardSnapshot.widgets));
      } finally {
        isEditingRef.current = false;
      }
    })();
  }, [layout, t]);

  const handleWidgetConfigChange = useCallback(
    (widgetId: string, configJson: string) => {
      const dashboardSnapshot = dashboardRef.current;
      if (!dashboardSnapshot) return;

      const widgets = dashboardSnapshot.widgets.map((widget) =>
        widget.id === widgetId
          ? { ...widget, config_json: configJson }
          : widget,
      );
      const optimistic = { ...dashboardSnapshot, widgets };
      dashboardRef.current = optimistic;
      setDashboard(optimistic);

      void (async () => {
        try {
          const updated = await api.updateDashboard({
            widgets: widgets.map(
              ({ id, type, config_json, grid_x, grid_y, grid_w, grid_h }) => ({
                id,
                type,
                config_json,
                grid_x,
                grid_y,
                grid_w,
                grid_h,
              }),
            ),
          });
          dashboardRef.current = updated;
          setDashboard(updated);
        } catch (err) {
          setError(err instanceof Error ? err.message : t("dashboard.saveWidgetConfigFailed"));
          dashboardRef.current = dashboardSnapshot;
          setDashboard(dashboardSnapshot);
        }
      })();
    },
    [],
  );

  const handleAddWidget = useCallback((type: string) => {
    const dashboardSnapshot = dashboardRef.current;
    if (!dashboardSnapshot) return;

    if (dashboardSnapshot.widgets.some((widget) => widget.type === type)) {
      setError(t("dashboard.widgetExists"));
      return;
    }

    const definition = ADDABLE_WIDGETS.find((widget) => widget.type === type);
    if (!definition) return;

    const { x, y } = findWidgetPlacement(layout, definition.defaultSize);
    const widgetId = crypto.randomUUID();
    const newItem: GridItem = {
      i: widgetId,
      x,
      y,
      w: definition.defaultSize.w,
      h: definition.defaultSize.h,
      ...DEFAULT_GRID_ITEM,
    };
    const nextLayout = [...layout, newItem];

    isEditingRef.current = true;
    setLayout(nextLayout);

    const widgets = [
      ...layoutToWidgets(dashboardSnapshot, layout),
      {
        id: widgetId,
        dashboard_id: dashboardSnapshot.dashboard.id,
        type,
        config_json: null,
        grid_x: x,
        grid_y: y,
        grid_w: definition.defaultSize.w,
        grid_h: definition.defaultSize.h,
      },
    ];

    void (async () => {
      try {
        const updated = await api.updateDashboard({ widgets });
        dashboardRef.current = updated;
        setDashboard(updated);
        setLayout(widgetsToLayout(updated.widgets));
      } catch (err) {
        setError(err instanceof Error ? err.message : t("dashboard.addWidgetFailed"));
        setLayout(widgetsToLayout(dashboardSnapshot.widgets));
      } finally {
        isEditingRef.current = false;
      }
    })();
  }, [layout, t]);

  const handleDeleteServer = async (serverId: string) => {
    handleDisconnectServer(serverId);
    await api.deleteServer(serverId);
    if (activeServerId === serverId) {
      setActiveServerId(null);
    }
    await load();
  };

  const handleDeleteGroup = async (groupId: string) => {
    await api.deleteGroup(groupId);
    await load();
  };

  const handleMoveItem = async (input: {
    type: "server" | "group";
    id: string;
    parentId: string | null;
    index: number;
  }) => {
    setTreeMoving(true);
    setError(null);
    try {
      const response = await api.moveTreeItem(input);
      setTree(response.tree);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dashboard.moveFailed"));
      await load();
    } finally {
      setTreeMoving(false);
    }
  };

  if (loading && !dashboard) {
    return (
      <>
        <WorkspaceHeader />
        <div className="workspace flex items-center justify-center text-sm text-[var(--color-muted-foreground)]">
          {t("dashboard.loading")}
        </div>
      </>
    );
  }

  if (error && !dashboard) {
    return (
      <>
        <WorkspaceHeader />
        <div className="workspace flex items-center justify-center text-sm text-[var(--color-destructive)]">
          {error}
        </div>
      </>
    );
  }

  if (!dashboard) return null;

  const widgetById = new Map(dashboard.widgets.map((widget) => [widget.id, widget]));

  return (
    <>
      <WorkspaceHeader
        actions={
          <>
            <AddWidgetMenu
              existingTypes={existingWidgetTypes}
              onAdd={handleAddWidget}
              disabled={loading}
            />
            {me && (
              <Badge>
                {me.authMode === "open"
                  ? `${t("header.openMode")} · ${me.user.display_name ?? "Default"}`
                  : me.user.email ?? me.user.display_name ?? me.user.id}
              </Badge>
            )}
          </>
        }
      />

      <div className="workspace">
      {error && (
        <div className="workspace-toast text-[var(--color-destructive)]">{error}</div>
      )}

      <GridDashboard
        layout={layout}
        margin={[gridMargin, gridMargin]}
        onLayoutChange={handleLayoutChange}
        getItemTitle={(item) => {
          const widget = widgetById.get(item.i);
          if (!widget) return t("common.widget");
          return t(widgetTitleKey(widget.type));
        }}
        renderHandleActions={(item) => {
          const widget = widgetById.get(item.i);
          if (!widget) return null;

          if (widget.type === "server_list") {
            return (
              <div className="widget-no-drag flex items-center gap-1">
                <Button
                  className="widget-no-drag"
                  disabled={!hasServerGroups}
                  size="sm"
                  title={t("serverList.expandAll")}
                  variant="secondary"
                  onClick={expandAllServerGroups}
                >
                  <ChevronsDown className="h-3.5 w-3.5" />
                </Button>
                <Button
                  className="widget-no-drag"
                  disabled={!hasServerGroups}
                  size="sm"
                  title={t("serverList.collapseAll")}
                  variant="secondary"
                  onClick={collapseAllServerGroups}
                >
                  <ChevronsUp className="h-3.5 w-3.5" />
                </Button>
                <Button
                  className="widget-no-drag"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setGroupParentId(null);
                    setGroupOpen(true);
                  }}
                >
                  <FolderPlus className="mr-1 h-3 w-3" />
                  {t("common.group")}
                </Button>
                <Button
                  className="widget-no-drag"
                  size="sm"
                  variant="secondary"
                  onClick={() => {
                    setAddGroupId(null);
                    setAddOpen(true);
                  }}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  {t("common.add")}
                </Button>
              </div>
            );
          }

          if (widget.type === "terminal") {
            return <Badge>{terminalBadge}</Badge>;
          }

          if (widget.type === "file_manager") {
            return (
              <Button
                className="widget-no-drag"
                size="sm"
                variant="secondary"
                title={t("widget.deleteTitle")}
                onClick={() => handleRemoveWidget(item.i)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            );
          }

          if (widget.type === "status" || widget.type === "network" || widget.type === "process") {
            return (
              <div className="widget-no-drag flex items-center gap-1">
                <Button
                  className="widget-no-drag"
                  size="sm"
                  variant="secondary"
                  title={t("common.settings")}
                  onClick={() => setPollSettingsWidgetId(item.i)}
                >
                  <Settings className="h-3.5 w-3.5" />
                </Button>
                <Button
                  className="widget-no-drag"
                  size="sm"
                  variant="secondary"
                  title={t("widget.deleteTitle")}
                  onClick={() => handleRemoveWidget(item.i)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          }

          if (widget.type === "quick_commands") {
            const quickConfig = parseQuickCommandsConfig(widget.config_json);
            const targetMode = quickConfig.targetMode ?? "current";

            return (
              <div className="widget-no-drag flex items-center gap-1">
                <select
                  className="widget-no-drag h-8 max-w-[7.5rem] bg-[var(--color-secondary)] px-2 text-xs"
                  value={targetMode}
                  onChange={(event) => {
                    handleWidgetConfigChange(
                      widget.id,
                      serializeQuickCommandsConfig({
                        ...quickConfig,
                        targetMode: event.target
                          .value as QuickCommandTargetMode,
                      }),
                    );
                  }}
                >
                  <option value="current">
                    {t("quickCommands.targetCurrent")}
                  </option>
                  <option value="all">{t("quickCommands.targetAll")}</option>
                </select>
                <Button
                  className="widget-no-drag"
                  size="sm"
                  variant="secondary"
                  onClick={() => setQuickCommandAddWidgetId(item.i)}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  {t("common.add")}
                </Button>
                <Button
                  className="widget-no-drag"
                  size="sm"
                  variant="secondary"
                  title={t("widget.deleteTitle")}
                  onClick={() => handleRemoveWidget(item.i)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          }

          return null;
        }}
        renderItem={(item) => {
          const widget = widgetById.get(item.i);
          if (!widget) return null;

          if (widget.type === "server_list") {
            return (
              <ServerListWidget
                tree={tree}
                loading={loading}
                moving={treeMoving}
                context={widgetContext}
                expanded={serverListExpanded}
                onExpandedChange={setServerListExpanded}
                onDeleteServer={(serverId) => void handleDeleteServer(serverId)}
                onDeleteGroup={(groupId) => void handleDeleteGroup(groupId)}
                onMoveItem={handleMoveItem}
                onAddServer={(groupId) => {
                  setAddGroupId(groupId);
                  setAddOpen(true);
                }}
                onAddGroup={(parentId) => {
                  setGroupParentId(parentId);
                  setGroupOpen(true);
                }}
                onRenameGroup={(groupId, name) => {
                  setRenameGroupId(groupId);
                  setRenameGroupName(name);
                  setRenameOpen(true);
                }}
                onCopyServer={(serverId) => {
                  const source = findServerInTree(tree, serverId);
                  if (!source) return;
                  setCopySource(source);
                  setCopyOpen(true);
                }}
                onEditServer={(serverId) => {
                  const target = findServerInTree(tree, serverId);
                  if (!target) return;
                  setEditServer(target);
                  setEditOpen(true);
                }}
              />
            );
          }

          if (widget.type === "terminal") {
            return (
              <TerminalWidget
                sessions={sessionList}
                activeServerId={activeServerId}
                onSessionStatusChange={handleSessionStatusChange}
                onSessionClosed={handleSessionClosed}
              />
            );
          }

          if (widget.type === "file_manager") {
            return (
              <FileManagerWidget
                activeServerId={activeServerId}
                sessions={sessions}
              />
            );
          }

          if (widget.type === "status") {
            return (
              <StatusWidget
                activeServerId={activeServerId}
                pollIntervalMs={
                  parseStatusWidgetConfig(widget.config_json).pollIntervalMs
                }
                sessions={sessions}
                tree={tree}
              />
            );
          }

          if (widget.type === "network") {
            return (
              <NetworkStatusWidget
                activeServerId={activeServerId}
                pollIntervalMs={
                  parseStatusWidgetConfig(widget.config_json).pollIntervalMs
                }
                sessions={sessions}
                tree={tree}
              />
            );
          }

          if (widget.type === "process") {
            return (
              <ProcessStatusWidget
                activeServerId={activeServerId}
                pollIntervalMs={
                  parseStatusWidgetConfig(widget.config_json).pollIntervalMs
                }
                sessions={sessions}
                tree={tree}
              />
            );
          }

          if (widget.type === "quick_commands") {
            return (
              <QuickCommandsWidget
                activeServerId={activeServerId}
                configJson={widget.config_json}
                sessions={sessions}
                onConfigChange={(configJson) =>
                  handleWidgetConfigChange(widget.id, configJson)
                }
              />
            );
          }

          return (
            <div className="flex h-full items-center justify-center p-3 text-sm text-[var(--color-muted-foreground)]">
              {t("widget.comingSoon", { type: widget.type })}
            </div>
          );
        }}
      />

      <AddServerDialog
        open={addOpen}
        onOpenChange={setAddOpen}
        groupId={addGroupId}
        onCreated={async () => {
          setAddOpen(false);
          setAddGroupId(null);
          await load();
        }}
      />

      <CopyServerDialog
        open={copyOpen}
        onOpenChange={(open) => {
          setCopyOpen(open);
          if (!open) setCopySource(null);
        }}
        source={copySource}
        onCopied={load}
      />

      <EditServerDialog
        open={editOpen}
        onOpenChange={(open) => {
          setEditOpen(open);
          if (!open) setEditServer(null);
        }}
        server={editServer}
        onUpdated={load}
      />

      <AddGroupDialog
        open={groupOpen}
        onOpenChange={setGroupOpen}
        parentId={groupParentId}
        onCreated={async () => {
          setGroupOpen(false);
          setGroupParentId(null);
          await load();
        }}
      />

      <RenameGroupDialog
        open={renameOpen}
        groupId={renameGroupId}
        initialName={renameGroupName}
        onOpenChange={setRenameOpen}
        onRenamed={async () => {
          setRenameOpen(false);
          setRenameGroupId(null);
          setRenameGroupName("");
          await load();
        }}
      />

      <AddQuickCommandDialog
        configJson={
          dashboard.widgets.find(
            (widget) => widget.id === quickCommandAddWidgetId,
          )?.config_json ?? null
        }
        open={quickCommandAddWidgetId !== null}
        onAdded={(configJson) => {
          if (quickCommandAddWidgetId) {
            handleWidgetConfigChange(quickCommandAddWidgetId, configJson);
          }
        }}
        onOpenChange={(open) => {
          if (!open) setQuickCommandAddWidgetId(null);
        }}
      />

      <StatusSettingsDialog
        configJson={
          dashboard.widgets.find(
            (widget) => widget.id === pollSettingsWidgetId,
          )?.config_json ?? null
        }
        titleKey={
          (() => {
            const type = dashboard.widgets.find(
              (widget) => widget.id === pollSettingsWidgetId,
            )?.type;
            if (type === "network") return "network.settingsTitle";
            if (type === "process") return "process.settingsTitle";
            return "status.settingsTitle";
          })()
        }
        open={pollSettingsWidgetId !== null}
        onOpenChange={(open) => {
          if (!open) setPollSettingsWidgetId(null);
        }}
        onSaved={(configJson) => {
          if (pollSettingsWidgetId) {
            handleWidgetConfigChange(pollSettingsWidgetId, configJson);
          }
        }}
      />
      </div>
    </>
  );
}
