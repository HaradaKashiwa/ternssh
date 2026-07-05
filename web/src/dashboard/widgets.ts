export const ADDABLE_WIDGETS = [
  { type: "server_list", title: "服务器", defaultSize: { w: 3, h: 8 } },
  { type: "terminal", title: "终端", defaultSize: { w: 6, h: 8 } },
  { type: "file_manager", title: "文件管理", defaultSize: { w: 3, h: 8 } },
  { type: "status", title: "服务器状态", defaultSize: { w: 3, h: 6 } },
  { type: "quick_commands", title: "快捷命令", defaultSize: { w: 3, h: 6 } },
] as const;

export type AddableWidgetType = (typeof ADDABLE_WIDGETS)[number]["type"];

export const WIDGET_TITLES: Record<string, string> = Object.fromEntries(
  ADDABLE_WIDGETS.map((widget) => [widget.type, widget.title]),
);
