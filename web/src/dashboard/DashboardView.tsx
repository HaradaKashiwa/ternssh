import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { FolderPlus, ChevronsDown, ChevronsUp, Plus, Settings, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, type Dashboard, type Server, type TreeNode } from "@/lib/api";
import {
  getSessionsForServer,
  isSessionAlive,
  listSessions,
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
import { SETTINGS_RESET_EVENT } from "@/lib/app-settings";
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
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [layout, setLayout] = useState<GridItem[]>([]);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [treeMoving, setTreeMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
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
  const manualDisconnectServersRef = useRef(new Set<string>());
  const manualCloseSessionsRef = useRef(new Set<string>());
  const reconnectAttemptRef = useRef(new Map<string, number>());
  const reconnectTimerRef = useRef(new Map<string, number>());

  const clearReconnectTimer = useCallback((sessionId: string) => {
    const timer = reconnectTimerRef.current.get(sessionId);
    if (timer !== undefined) {
      window.clearTimeout(timer);
      reconnectTimerRef.current.delete(sessionId);
    }
  }, []);

  const clearReconnectState = useCallback(
    (sessionId: string) => {
      clearReconnectTimer(sessionId);
      reconnectAttemptRef.current.delete(sessionId);
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
    void load();
  }, [load, t]);

  useEffect(() => {
    const onSettingsReset = () => {
      for (const timer of reconnectTimerRef.current.values()) {
        window.clearTimeout(timer);
      }
      reconnectTimerRef.current.clear();
      reconnectAttemptRef.current.clear();
      manualDisconnectServersRef.current.clear();
      manualCloseSessionsRef.current.clear();
      setSessions({});
      setActiveServerId(null);
      setActiveSessionId(null);
      void load();
    };
    window.addEventListener(SETTINGS_RESET_EVENT, onSettingsReset);
    return () => window.removeEventListener(SETTINGS_RESET_EVENT, onSettingsReset);
  }, [load]);

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
    (sessionId: string) => {
      const session = sessionsRef.current[sessionId];
      if (!session) return;
      if (manualDisconnectServersRef.current.has(session.serverId)) return;
      if (manualCloseSessionsRef.current.has(sessionId)) return;

      const nextAttempt = (reconnectAttemptRef.current.get(sessionId) ?? 0) + 1;
      if (nextAttempt > MAX_SESSION_RECONNECT_ATTEMPTS) {
        clearReconnectState(sessionId);
        setSessions((current) => {
          const currentSession = current[sessionId];
          if (!currentSession) return current;
          return {
            ...current,
            [sessionId]: {
              ...currentSession,
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

      reconnectAttemptRef.current.set(sessionId, nextAttempt);
      setSessions((current) => {
        const currentSession = current[sessionId];
        if (!currentSession) return current;
        return {
          ...current,
          [sessionId]: {
            ...currentSession,
            status: "connecting",
            reconnectAttempt: nextAttempt,
          },
        };
      });

      clearReconnectTimer(sessionId);
      const timer = window.setTimeout(() => {
        reconnectTimerRef.current.delete(sessionId);
        void (async () => {
          const currentSession = sessionsRef.current[sessionId];
          if (!currentSession) return;
          if (manualDisconnectServersRef.current.has(currentSession.serverId)) {
            return;
          }
          if (manualCloseSessionsRef.current.has(sessionId)) return;

          try {
            const created = await api.createSession(currentSession.serverId);
            if (manualDisconnectServersRef.current.has(currentSession.serverId)) {
              return;
            }
            if (manualCloseSessionsRef.current.has(sessionId)) return;
            if (!sessionsRef.current[sessionId]) return;

            setSessions((current) => {
              const oldSession = current[sessionId];
              if (!oldSession) return current;
              const next = { ...current };
              delete next[sessionId];
              next[created.sessionId] = {
                serverId: oldSession.serverId,
                sessionId: created.sessionId,
                wsUrl: created.wsUrl,
                sftpWsUrl: created.sftpWsUrl,
                status: "connecting",
                reconnectAttempt: nextAttempt,
              };
              return next;
            });
            setActiveSessionId((active) =>
              active === sessionId ? created.sessionId : active,
            );
            clearReconnectState(sessionId);
          } catch {
            scheduleReconnect(sessionId);
          }
        })();
      }, SESSION_RECONNECT_DELAY_MS);
      reconnectTimerRef.current.set(sessionId, timer);
    },
    [clearReconnectState, clearReconnectTimer, t],
  );

  const handleSessionStatusChange = useCallback(
    (sessionId: string, status: SessionStatus) => {
      if (status === "open") {
        clearReconnectState(sessionId);
      }
      setSessions((current) => {
        const session = current[sessionId];
        if (!session || session.status === status) return current;
        return {
          ...current,
          [sessionId]: {
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
    (sessionId: string) => {
      if (manualCloseSessionsRef.current.has(sessionId)) {
        manualCloseSessionsRef.current.delete(sessionId);
        return;
      }
      const session = sessionsRef.current[sessionId];
      if (!session) return;
      if (manualDisconnectServersRef.current.has(session.serverId)) return;
      scheduleReconnect(sessionId);
    },
    [scheduleReconnect],
  );

  const handleDisconnectServer = useCallback(
    (serverId: string) => {
      manualDisconnectServersRef.current.add(serverId);
      const forServer = getSessionsForServer(sessionsRef.current, serverId);
      for (const session of forServer) {
        manualCloseSessionsRef.current.add(session.sessionId);
        clearReconnectState(session.sessionId);
      }

      setSessions((current) => {
        const next = { ...current };
        for (const session of forServer) {
          delete next[session.sessionId];
        }
        setActiveServerId((active) => {
          if (active !== serverId) return active;
          return listSessions(next)[0]?.serverId ?? null;
        });
        setActiveSessionId((active) => {
          if (active && forServer.some((session) => session.sessionId === active)) {
            return listSessions(next)[0]?.sessionId ?? null;
          }
          return active;
        });
        return next;
      });
    },
    [clearReconnectState],
  );

  const handleSelectServer = useCallback((serverId: string) => {
    setActiveServerId(serverId);
    setActiveSessionId((current) => {
      const forServer = getSessionsForServer(sessionsRef.current, serverId);
      if (forServer.length === 0) return null;
      if (current && forServer.some((session) => session.sessionId === current)) {
        return current;
      }
      return forServer[0]?.sessionId ?? null;
    });
  }, []);

  const handleConnectServer = useCallback(async (serverId: string) => {
    manualDisconnectServersRef.current.delete(serverId);
    handleSelectServer(serverId);

    const forServer = getSessionsForServer(sessionsRef.current, serverId);
    const alive = forServer.find((session) => isSessionAlive(session.status));
    if (alive) {
      setActiveSessionId(alive.sessionId);
      return;
    }

    try {
      const created = await api.createSession(serverId);
      setSessions((current) => ({
        ...current,
        [created.sessionId]: {
          serverId,
          sessionId: created.sessionId,
          wsUrl: created.wsUrl,
          sftpWsUrl: created.sftpWsUrl,
          status: "connecting",
        },
      }));
      setActiveSessionId(created.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dashboard.createSessionFailed"));
    }
  }, [handleSelectServer, t]);

  const handleAddTerminal = useCallback(async (serverId?: string) => {
    const targetServerId = serverId ?? activeServerId;
    if (!targetServerId) return;

    manualDisconnectServersRef.current.delete(targetServerId);
    handleSelectServer(targetServerId);

    try {
      const created = await api.createSession(targetServerId);
      setSessions((current) => ({
        ...current,
        [created.sessionId]: {
          serverId: targetServerId,
          sessionId: created.sessionId,
          wsUrl: created.wsUrl,
          sftpWsUrl: created.sftpWsUrl,
          status: "connecting",
        },
      }));
      setActiveSessionId(created.sessionId);
    } catch (err) {
      setError(err instanceof Error ? err.message : t("dashboard.createSessionFailed"));
    }
  }, [activeServerId, handleSelectServer, t]);

  const handleCloseTerminal = useCallback(
    (sessionId: string) => {
      manualCloseSessionsRef.current.add(sessionId);
      clearReconnectState(sessionId);
      setSessions((current) => {
        const session = current[sessionId];
        if (!session) return current;
        const next = { ...current };
        delete next[sessionId];
        setActiveSessionId((active) => {
          if (active !== sessionId) return active;
          const remaining = getSessionsForServer(next, session.serverId);
          return remaining[0]?.sessionId ?? null;
        });
        return next;
      });
    },
    [clearReconnectState],
  );

  const widgetContext = useMemo(
    () => ({
      activeServerId,
      activeSessionId,
      sessions,
      onSelectServer: handleSelectServer,
      onSelectSession: setActiveSessionId,
      onConnectServer: (serverId: string) => {
        void handleConnectServer(serverId);
      },
      onAddTerminal: (serverId?: string) => {
        void handleAddTerminal(serverId);
      },
      onCloseTerminal: handleCloseTerminal,
      onDisconnectServer: handleDisconnectServer,
    }),
    [
      activeServerId,
      activeSessionId,
      sessions,
      handleAddTerminal,
      handleCloseTerminal,
      handleConnectServer,
      handleDisconnectServer,
      handleSelectServer,
    ],
  );

  const sessionList = useMemo(() => listSessions(sessions), [sessions]);

  const serverSessionsForTerminal = useMemo(
    () =>
      activeServerId ? getSessionsForServer(sessions, activeServerId) : [],
    [activeServerId, sessions],
  );

  const terminalBadge = useMemo(() => {
    if (!activeServerId) {
      const openCount = sessionList.filter((item) => item.status === "open").length;
      return openCount > 0
        ? t("dashboard.sessionCount", { count: openCount })
        : t("common.idle");
    }

    const active = activeSessionId ? sessions[activeSessionId] : null;
    const tabCount = serverSessionsForTerminal.length;
    if (tabCount > 1) {
      return t("terminal.tabCount", {
        count: tabCount,
        status: t(`session.${active?.status ?? "closed"}`),
      });
    }
    if (active) {
      return t(`session.${active.status}`);
    }
    return t("common.idle");
  }, [
    activeServerId,
    activeSessionId,
    serverSessionsForTerminal.length,
    sessionList,
    sessions,
    t,
  ]);

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
      setActiveSessionId(null);
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
            return (
              <div className="widget-no-drag flex items-center gap-1">
                <Button
                  className="widget-no-drag"
                  disabled={!activeServerId}
                  size="sm"
                  title={t("terminal.newTab")}
                  variant="secondary"
                  onClick={() => void handleAddTerminal()}
                >
                  <Plus className="h-3.5 w-3.5" />
                </Button>
                <Badge>{terminalBadge}</Badge>
              </div>
            );
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
                serverSessions={serverSessionsForTerminal}
                activeServerId={activeServerId}
                activeSessionId={activeSessionId}
                onSelectSession={setActiveSessionId}
                onAddTerminal={() => void handleAddTerminal()}
                onCloseTerminal={handleCloseTerminal}
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
                activeSessionId={activeSessionId}
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
                activeSessionId={activeSessionId}
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
                activeSessionId={activeSessionId}
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
                activeSessionId={activeSessionId}
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
