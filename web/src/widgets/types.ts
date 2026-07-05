import type { Dispatch, SetStateAction } from "react";
import type { ServerSession, SessionStatus } from "@/lib/sessions";

export interface WidgetContext {
  activeServerId: string | null;
  sessions: Record<string, ServerSession>;
  onSelectServer: (serverId: string) => void;
  onConnectServer: (serverId: string) => void;
  onDisconnectServer: (serverId: string) => void;
}

export interface WidgetProps {
  context: WidgetContext;
}

export interface ServerListWidgetProps extends WidgetProps {
  tree: import("@/lib/api").TreeNode[];
  loading: boolean;
  moving: boolean;
  onDeleteServer: (serverId: string) => void;
  onDeleteGroup: (groupId: string) => void;
  onMoveItem: (input: {
    type: "server" | "group";
    id: string;
    parentId: string | null;
    index: number;
  }) => Promise<void>;
  onAddServer: (groupId: string | null) => void;
  onAddGroup: (parentId: string | null) => void;
  onRenameGroup: (groupId: string, name: string) => void;
  onCopyServer: (serverId: string) => void;
  expanded: Set<string>;
  onExpandedChange: Dispatch<SetStateAction<Set<string>>>;
}

export interface TerminalWidgetProps {
  sessions: ServerSession[];
  activeServerId: string | null;
  onSessionStatusChange: (serverId: string, status: SessionStatus) => void;
  onSessionClosed: (serverId: string) => void;
  onStatusChange?: (status: string) => void;
}
