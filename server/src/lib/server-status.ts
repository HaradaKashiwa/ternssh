export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ServerStatusMetrics {
  load1: number | null;
  load5: number | null;
  load15: number | null;
  cpuCount: number | null;
  cpuUsedPercent: number | null;
  memoryTotal: number | null;
  memoryAvailable: number | null;
  memoryUsedPercent: number | null;
  diskTotal: number | null;
  diskUsed: number | null;
  diskAvailable: number | null;
  diskUsedPercent: number | null;
  uptimeSeconds: number | null;
  osInfo: string | null;
  netRxBytes: number | null;
  netTxBytes: number | null;
  netRxRate: number | null;
  netTxRate: number | null;
  netInterfaces: NetInterfaceMetrics[];
  processCount: number | null;
  topProcesses: ProcessMetrics[];
}

export interface NetInterfaceMetrics {
  name: string;
  rxBytes: number;
  txBytes: number;
  rxRate: number | null;
  txRate: number | null;
}

export interface NetInterfaceSnapshot {
  name: string;
  rxBytes: number;
  txBytes: number;
}

export interface ProcessMetrics {
  pid: number;
  user: string;
  cpuPercent: number;
  memPercent: number;
  rssKb: number;
  stat: string;
  command: string;
}

export const DEFAULT_PROCESS_LIMIT = 10;
export const MIN_PROCESS_LIMIT = 1;
export const MAX_PROCESS_LIMIT = 50;
export const DEFAULT_STATUS_POLL_INTERVAL_MS = 5000;
export const MIN_STATUS_POLL_INTERVAL_MS = 3000;
export const MAX_STATUS_POLL_INTERVAL_MS = 60000;

export function clampStatusPollIntervalMs(value: number): number {
  return Math.min(
    MAX_STATUS_POLL_INTERVAL_MS,
    Math.max(MIN_STATUS_POLL_INTERVAL_MS, Math.round(value)),
  );
}

function clampProcessLimit(value: number): number {
  return Math.min(
    MAX_PROCESS_LIMIT,
    Math.max(MIN_PROCESS_LIMIT, Math.round(value)),
  );
}

export function parseProcessLimitParam(
  value: string | null | undefined,
): number {
  if (!value) return DEFAULT_PROCESS_LIMIT;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return DEFAULT_PROCESS_LIMIT;
  return clampProcessLimit(parsed);
}

export function buildProcessMetricsCommand(processLimit: number): string {
  const limit = clampProcessLimit(processLimit);
  // One ps pass: awk keeps top-N by CPU without ps --sort scanning/sorting every process twice.
  // Skip the collector's own ps/awk so they do not appear as top CPU processes.
  return `ps -eo pid=,user=,pcpu=,pmem=,rss=,stat=,args= 2>/dev/null | awk -v limit=${limit} '
{
  proccnt++
  name=$7
  for (i=8; i<=NF; i++) name=name" "$i
  if (length(name)>48) name=substr(name,1,48)
  gsub(/\\|/, "/", name)
  if (index(name, "ps -eo pid=,user=,pcpu=") > 0) next
  if (index(name, "awk -v limit=") > 0) next
  pcpu=$3+0
  line=$1"|"$2"|"$3"|"$4"|"$5"|"$6"|"name
  if (n<limit) {
    n++
    slot[n]=line
    cpu[n]=pcpu
    next
  }
  min=1
  for (i=2; i<=n; i++) if (cpu[i]<cpu[min]) min=i
  if (pcpu<=cpu[min]) next
  slot[min]=line
  cpu[min]=pcpu
}
END {
  print "PROCCNT:" proccnt+0
  for (i=1; i<n; i++) {
    for (j=i+1; j<=n; j++) {
      if (cpu[j]>cpu[i]) {
        tmp=cpu[i]; cpu[i]=cpu[j]; cpu[j]=tmp
        tmp=slot[i]; slot[i]=slot[j]; slot[j]=tmp
      }
    }
  }
  for (i=1; i<=n; i++) print "PROC:" slot[i]
}'`;
}

export function buildLightStatusCommand(): string {
  return [
    'echo "LOAD:$(cut -d" " -f1-3 /proc/loadavg 2>/dev/null)"',
    'echo "CPU:$(awk \'/^cpu / {printf "%.0f %.0f", $2+$3+$4+$5+$6+$7+$8+$9, $5+$6; exit}\' /proc/stat 2>/dev/null)"',
    'echo "NCPU:$(nproc 2>/dev/null || getconf _NPROCESSORS_ONLN 2>/dev/null)"',
    'MT=$(awk \'/MemTotal/ {print $2; exit}\' /proc/meminfo 2>/dev/null); MA=$(awk \'/MemAvailable/ {print $2; exit}\' /proc/meminfo 2>/dev/null); [ -n "$MA" ] || MA=$(awk \'/MemFree/ {print $2; exit}\' /proc/meminfo 2>/dev/null); echo "MEM:${MT} ${MA}"',
    'echo "DISK:$(df -Pk / 2>/dev/null | awk \'NR==2 {print $2, $3, $4; exit}\')"',
    'echo "NET:$(awk \'$1 ~ /:/ {gsub(/:/,"",$1); if ($1!="lo") {rx+=$2; tx+=$10}} END {printf "%.0f %.0f", rx+0, tx+0}\' /proc/net/dev 2>/dev/null)"',
    'awk \'$1 ~ /:/ {gsub(/:/,"",$1); if ($1!="lo") printf "IF:%s %.0f %.0f\\n", $1, $2+0, $10+0}\' /proc/net/dev 2>/dev/null',
    'echo "UPTIME:$(cut -d" " -f1 /proc/uptime 2>/dev/null)"',
    'echo "OS:$(uname -sr 2>/dev/null)"',
  ].join("; ");
}

export function buildStatusCommand(
  processLimit = DEFAULT_PROCESS_LIMIT,
): string {
  return [buildLightStatusCommand(), buildProcessMetricsCommand(processLimit)].join(
    "; ",
  );
}

// Run via a dedicated SSH exec channel (non-interactive). Do not nest `/bin/sh -c`
// — nested shells break variable assignments like MT=$(awk ...) for memory collection.
export const STATUS_COMMAND = buildStatusCommand();

function parseNumber(value: string | undefined): number | null {
  if (!value) return null;
  const parsed = Number(value.trim());
  return Number.isFinite(parsed) ? parsed : null;
}

export function parseStatusOutput(output: string): {
  metrics: ServerStatusMetrics;
  netRxBytes: number | null;
  netTxBytes: number | null;
  cpuTotalJiffies: number | null;
  cpuIdleJiffies: number | null;
  netInterfaces: NetInterfaceSnapshot[];
} {
  const metrics: ServerStatusMetrics = {
    load1: null,
    load5: null,
    load15: null,
    cpuCount: null,
    cpuUsedPercent: null,
    memoryTotal: null,
    memoryAvailable: null,
    memoryUsedPercent: null,
    diskTotal: null,
    diskUsed: null,
    diskAvailable: null,
    diskUsedPercent: null,
    uptimeSeconds: null,
    osInfo: null,
    netRxBytes: null,
    netTxBytes: null,
    netRxRate: null,
    netTxRate: null,
    netInterfaces: [],
    processCount: null,
    topProcesses: [],
  };
  let netRxBytes: number | null = null;
  let netTxBytes: number | null = null;
  let cpuTotalJiffies: number | null = null;
  let cpuIdleJiffies: number | null = null;
  const netInterfaces: NetInterfaceSnapshot[] = [];
  const topProcesses: ProcessMetrics[] = [];

  for (const line of output.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed.includes(":")) continue;
    const [key, ...rest] = trimmed.split(":");
    const value = rest.join(":").trim();

    switch (key) {
      case "LOAD": {
        const parts = value.split(/\s+/).filter(Boolean);
        metrics.load1 = parseNumber(parts[0]);
        metrics.load5 = parseNumber(parts[1]);
        metrics.load15 = parseNumber(parts[2]);
        break;
      }
      case "CPU": {
        if (!value) break;
        const parts = value.split(/\s+/).filter(Boolean);
        cpuTotalJiffies = parseNumber(parts[0]);
        cpuIdleJiffies = parseNumber(parts[1]);
        break;
      }
      case "NCPU":
        metrics.cpuCount = parseNumber(value);
        break;
      case "MEM": {
        if (!value) break;
        const parts = value.split(/\s+/).filter(Boolean);
        const totalKb = parseNumber(parts[0]);
        const availableKb = parseNumber(parts[1]);
        if (totalKb !== null) metrics.memoryTotal = totalKb * 1024;
        if (availableKb !== null) metrics.memoryAvailable = availableKb * 1024;
        if (totalKb !== null && availableKb !== null && totalKb > 0) {
          metrics.memoryUsedPercent = Math.round(
            ((totalKb - availableKb) / totalKb) * 100,
          );
        }
        break;
      }
      case "DISK": {
        if (!value) break;
        const parts = value.split(/\s+/).filter(Boolean);
        const totalKb = parseNumber(parts[0]);
        const usedKb = parseNumber(parts[1]);
        const availableKb = parseNumber(parts[2]);
        if (totalKb !== null) metrics.diskTotal = totalKb * 1024;
        if (usedKb !== null) metrics.diskUsed = usedKb * 1024;
        if (availableKb !== null) metrics.diskAvailable = availableKb * 1024;
        if (totalKb !== null && usedKb !== null && totalKb > 0) {
          metrics.diskUsedPercent = Math.round((usedKb / totalKb) * 100);
        }
        break;
      }
      case "NET": {
        if (!value) break;
        const parts = value.split(/\s+/).filter(Boolean);
        netRxBytes = parseNumber(parts[0]);
        netTxBytes = parseNumber(parts[1]);
        metrics.netRxBytes = netRxBytes;
        metrics.netTxBytes = netTxBytes;
        break;
      }
      case "IF": {
        if (!value) break;
        const parts = value.split(/\s+/).filter(Boolean);
        const name = parts[0];
        const rxBytes = parseNumber(parts[1]);
        const txBytes = parseNumber(parts[2]);
        if (name && rxBytes !== null && txBytes !== null) {
          netInterfaces.push({ name, rxBytes, txBytes });
        }
        break;
      }
      case "UPTIME":
        metrics.uptimeSeconds = parseNumber(value.split(/\s+/)[0]);
        break;
      case "OS":
        metrics.osInfo = value;
        break;
      case "PROCCNT":
        metrics.processCount = parseNumber(value);
        break;
      case "PROC": {
        if (!value) break;
        const parts = value.split("|");
        if (parts.length < 7) break;
        const pid = parseNumber(parts[0]);
        const cpuPercent = parseNumber(parts[2]);
        const memPercent = parseNumber(parts[3]);
        const rssKb = parseNumber(parts[4]);
        if (
          pid === null ||
          cpuPercent === null ||
          memPercent === null ||
          rssKb === null
        ) {
          break;
        }
        topProcesses.push({
          pid,
          user: parts[1] ?? "-",
          cpuPercent,
          memPercent,
          rssKb,
          stat: parts[5] ?? "-",
          command: parts[6] ?? "-",
        });
        break;
      }
    }
  }

  netInterfaces.sort((a, b) => a.name.localeCompare(b.name));
  metrics.netInterfaces = netInterfaces.map((iface) => ({
    ...iface,
    rxRate: null,
    txRate: null,
  }));
  metrics.topProcesses = topProcesses;

  return {
    metrics,
    netRxBytes,
    netTxBytes,
    cpuTotalJiffies,
    cpuIdleJiffies,
    netInterfaces,
  };
}

export function normalizeProcessCpuPercent(
  cpuPercent: number,
  cpuCount: number | null,
): number {
  if (cpuCount === null || cpuCount <= 0) return cpuPercent;
  return Math.min(100, Math.round((cpuPercent / cpuCount) * 10) / 10);
}

export function computeCpuUsage(
  cpuTotalJiffies: number | null,
  cpuIdleJiffies: number | null,
  lastSample: { total: number; idle: number; at: number } | null,
  now = Date.now(),
): {
  cpuUsedPercent: number | null;
  sample: { total: number; idle: number; at: number } | null;
} {
  if (cpuTotalJiffies === null || cpuIdleJiffies === null) {
    return { cpuUsedPercent: null, sample: lastSample };
  }

  const sample = { total: cpuTotalJiffies, idle: cpuIdleJiffies, at: now };

  if (!lastSample) {
    return { cpuUsedPercent: null, sample };
  }

  const deltaTotal = cpuTotalJiffies - lastSample.total;
  const deltaIdle = cpuIdleJiffies - lastSample.idle;
  if (deltaTotal <= 0) {
    return { cpuUsedPercent: null, sample };
  }

  const usedPercent = Math.round(((deltaTotal - deltaIdle) / deltaTotal) * 100);
  return {
    cpuUsedPercent: Math.max(0, Math.min(100, usedPercent)),
    sample,
  };
}

export function computeNetRates(
  netRxBytes: number | null,
  netTxBytes: number | null,
  lastSample: { rxBytes: number; txBytes: number; at: number } | null,
  now = Date.now(),
): {
  netRxRate: number | null;
  netTxRate: number | null;
  sample: { rxBytes: number; txBytes: number; at: number } | null;
} {
  if (netRxBytes === null || netTxBytes === null) {
    return { netRxRate: null, netTxRate: null, sample: lastSample };
  }

  const sample = { rxBytes: netRxBytes, txBytes: netTxBytes, at: now };

  if (!lastSample) {
    return { netRxRate: null, netTxRate: null, sample };
  }

  const elapsedSec = (now - lastSample.at) / 1000;
  if (elapsedSec <= 0) {
    return { netRxRate: null, netTxRate: null, sample };
  }

  const deltaRx =
    netRxBytes >= lastSample.rxBytes
      ? netRxBytes - lastSample.rxBytes
      : netRxBytes;
  const deltaTx =
    netTxBytes >= lastSample.txBytes
      ? netTxBytes - lastSample.txBytes
      : netTxBytes;

  return {
    netRxRate: deltaRx / elapsedSec,
    netTxRate: deltaTx / elapsedSec,
    sample,
  };
}

export function computeInterfaceNetRates(
  interfaces: NetInterfaceSnapshot[],
  lastSamples: Record<
    string,
    { rxBytes: number; txBytes: number; at: number }
  > | null,
  now = Date.now(),
): {
  interfaces: NetInterfaceMetrics[];
  samples: Record<string, { rxBytes: number; txBytes: number; at: number }>;
} {
  const samples = { ...(lastSamples ?? {}) };
  const result = interfaces.map((iface) => {
    const { netRxRate, netTxRate, sample } = computeNetRates(
      iface.rxBytes,
      iface.txBytes,
      lastSamples?.[iface.name] ?? null,
      now,
    );
    if (sample) {
      samples[iface.name] = sample;
    }
    return {
      ...iface,
      rxRate: netRxRate,
      txRate: netTxRate,
    };
  });

  for (const name of Object.keys(samples)) {
    if (!interfaces.some((iface) => iface.name === name)) {
      delete samples[name];
    }
  }

  return { interfaces: result, samples };
}

export function formatBytes(bytes: number | null): string {
  if (bytes === null || !Number.isFinite(bytes)) return "-";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value >= 10 || unitIndex === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[unitIndex]}`;
}

export function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds)) return "-";
  const total = Math.floor(seconds);
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days > 0) return `${days}天 ${hours}小时`;
  if (hours > 0) return `${hours}小时 ${minutes}分钟`;
  return `${minutes}分钟`;
}
