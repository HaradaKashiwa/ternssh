import { useCallback, useEffect, useMemo, useRef, useState, type MouseEvent } from "react";
import { FolderPlus, Plus, Settings, X } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { api, type Dashboard, type MeResponse, type TreeNode } from "@/lib/api";
import {
  isSessionAlive,
  SESSION_STATUS_LABEL,
  type ServerSession,
  type SessionStatus,
} from "@/lib/sessions";
import { parseStatusWidgetConfig } from "@/lib/status-widget-config";
import { ServerListWidget } from "@/widgets/ServerListWidget";
import { FileManagerWidget } from "@/widgets/FileManagerWidget";
import { QuickCommandsWidget } from "@/widgets/QuickCommandsWidget";
import { StatusWidget } from "@/widgets/StatusWidget";
import { TerminalWidget } from "@/widgets/TerminalWidget";
import type { WidgetContext } from "@/widgets/types";
import { AddGroupDialog } from "./AddGroupDialog";
import { AddQuickCommandDialog } from "./AddQuickCommandDialog";
import { AddServerDialog } from "./AddServerDialog";
import { RenameGroupDialog } from "./RenameGroupDialog";
import { StatusSettingsDialog } from "./StatusSettingsDialog";
import { AddWidgetMenu } from "./AddWidgetMenu";
import { GridDashboard } from "./GridDashboard";
import { findWidgetPlacement, layoutsEqual, type GridItem } from "./grid-utils";
import { ADDABLE_WIDGETS, WIDGET_TITLES } from "./widgets";

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
  const [me, setMe] = useState<MeResponse | null>(null);
  const [dashboard, setDashboard] = useState<Dashboard | null>(null);
  const [layout, setLayout] = useState<GridItem[]>([]);
  const [tree, setTree] = useState<TreeNode[]>([]);
  const [loading, setLoading] = useState(true);
  const [treeMoving, setTreeMoving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [activeServerId, setActiveServerId] = useState<string | null>(null);
  const [sessions, setSessions] = useState<Record<string, ServerSession>>({});
  const sessionsRef = useRef(sessions);
  sessionsRef.current = sessions;
  const [addOpen, setAddOpen] = useState(false);
  const [addGroupId, setAddGroupId] = useState<string | null>(null);
  const [groupOpen, setGroupOpen] = useState(false);
  const [groupParentId, setGroupParentId] = useState<string | null>(null);
  const [renameOpen, setRenameOpen] = useState(false);
  const [renameGroupId, setRenameGroupId] = useState<string | null>(null);
  const [renameGroupName, setRenameGroupName] = useState("");
  const [quickCommandAddWidgetId, setQuickCommandAddWidgetId] = useState<
    string | null
  >(null);
  const [statusSettingsWidgetId, setStatusSettingsWidgetId] = useState<
    string | null
  >(null);
  const dashboardRef = useRef<Dashboard | null>(null);
  const persistTimerRef = useRef<number | null>(null);
  const isEditingRef = useRef(false);

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
      setError(err instanceof Error ? err.message : "加载失败");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void api.getMe().then(setMe).catch(console.error);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    return () => {
      if (persistTimerRef.current !== null) {
        window.clearTimeout(persistTimerRef.current);
      }
    };
  }, []);

  const handleSessionStatusChange = useCallback(
    (serverId: string, status: SessionStatus) => {
      setSessions((current) => {
        const session = current[serverId];
        if (!session || session.status === status) return current;
        return {
          ...current,
          [serverId]: { ...session, status },
        };
      });
    },
    [],
  );

  const handleSessionClosed = useCallback((serverId: string) => {
    setSessions((current) => {
      const session = current[serverId];
      if (!session) return current;
      return {
        ...current,
        [serverId]: { ...session, status: "closed" },
      };
    });
  }, []);

  const handleDisconnectServer = useCallback((serverId: string) => {
    setSessions((current) => {
      const next = { ...current };
      delete next[serverId];
      setActiveServerId((active) => {
        if (active !== serverId) return active;
        return Object.keys(next)[0] ?? null;
      });
      return next;
    });
  }, []);

  const handleConnectServer = useCallback(async (serverId: string) => {
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
      setError(err instanceof Error ? err.message : "创建会话失败");
    }
  }, []);

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
      return openCount > 0 ? `${openCount} 个会话` : "idle";
    }
    return SESSION_STATUS_LABEL[active.status] ?? active.status;
  }, [activeServerId, sessionList, sessions]);

  const existingWidgetTypes = useMemo(
    () => new Set(dashboard?.widgets.map((widget) => widget.type) ?? []),
    [dashboard?.widgets],
  );

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
          setError(err instanceof Error ? err.message : "保存布局失败");
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
        setError(err instanceof Error ? err.message : "删除组件失败");
        setLayout(widgetsToLayout(dashboardSnapshot.widgets));
      } finally {
        isEditingRef.current = false;
      }
    })();
  }, [layout]);

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
          setError(err instanceof Error ? err.message : "保存组件配置失败");
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
      setError("该组件已存在，不能重复添加");
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
        setError(err instanceof Error ? err.message : "添加组件失败");
        setLayout(widgetsToLayout(dashboardSnapshot.widgets));
      } finally {
        isEditingRef.current = false;
      }
    })();
  }, [layout]);

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
      setError(err instanceof Error ? err.message : "移动失败");
      await load();
    } finally {
      setTreeMoving(false);
    }
  };

  if (loading && !dashboard) {
    return (
      <>
        <header className="workspace-header">
          <div className="app-brand">ternssh</div>
        </header>
        <div className="workspace flex items-center justify-center text-sm text-[var(--color-muted-foreground)]">
          正在加载工作区...
        </div>
      </>
    );
  }

  if (error && !dashboard) {
    return (
      <>
        <header className="workspace-header">
          <div className="app-brand">ternssh</div>
        </header>
        <div className="workspace flex items-center justify-center text-sm text-red-400">
          {error}
        </div>
      </>
    );
  }

  if (!dashboard) return null;

  const widgetById = new Map(dashboard.widgets.map((widget) => [widget.id, widget]));

  return (
    <>
      <header className="workspace-header">
        <div className="app-brand">ternssh</div>
        <div className="app-header-actions">
          <AddWidgetMenu
            existingTypes={existingWidgetTypes}
            onAdd={handleAddWidget}
            disabled={loading}
          />
          {me && (
            <Badge>
              {me.authMode === "open"
                ? `开放模式 · ${me.user.display_name ?? "Default"}`
                : me.user.email ?? me.user.display_name ?? me.user.id}
            </Badge>
          )}
        </div>
      </header>

      <div className="workspace">
      {error && (
        <div className="workspace-toast text-red-400">{error}</div>
      )}

      <GridDashboard
        layout={layout}
        onLayoutChange={handleLayoutChange}
        getItemTitle={(item) => {
          const widget = widgetById.get(item.i);
          if (!widget) return "组件";
          return WIDGET_TITLES[widget.type] ?? widget.type;
        }}
        renderHandleActions={(item) => {
          const widget = widgetById.get(item.i);
          if (!widget) return null;

          if (widget.type === "server_list") {
            return (
              <div className="widget-no-drag flex items-center gap-1">
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
                  分组
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
                  添加
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
                title="删除组件"
                onClick={() => handleRemoveWidget(item.i)}
              >
                <X className="h-3.5 w-3.5" />
              </Button>
            );
          }

          if (widget.type === "status") {
            return (
              <div className="widget-no-drag flex items-center gap-1">
                <Button
                  className="widget-no-drag"
                  size="sm"
                  variant="secondary"
                  title="设置"
                  onClick={() => setStatusSettingsWidgetId(item.i)}
                >
                  <Settings className="h-3.5 w-3.5" />
                </Button>
                <Button
                  className="widget-no-drag"
                  size="sm"
                  variant="secondary"
                  title="删除组件"
                  onClick={() => handleRemoveWidget(item.i)}
                >
                  <X className="h-3.5 w-3.5" />
                </Button>
              </div>
            );
          }

          if (widget.type === "quick_commands") {
            return (
              <div className="widget-no-drag flex items-center gap-1">
                <Button
                  className="widget-no-drag"
                  size="sm"
                  variant="secondary"
                  onClick={() => setQuickCommandAddWidgetId(item.i)}
                >
                  <Plus className="mr-1 h-3 w-3" />
                  添加
                </Button>
                <Button
                  className="widget-no-drag"
                  size="sm"
                  variant="secondary"
                  title="删除组件"
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
              {widget.type} 即将推出
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
            (widget) => widget.id === statusSettingsWidgetId,
          )?.config_json ?? null
        }
        open={statusSettingsWidgetId !== null}
        onOpenChange={(open) => {
          if (!open) setStatusSettingsWidgetId(null);
        }}
        onSaved={(configJson) => {
          if (statusSettingsWidgetId) {
            handleWidgetConfigChange(statusSettingsWidgetId, configJson);
          }
        }}
      />
      </div>
    </>
  );
}
