export interface ExecResult {
  stdout: string;
  stderr: string;
  exitCode: number;
}

export interface ServerStatusMetrics {
  load1: number | null;
  load5: number | null;
  load15: number | null;
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

const STATUS_SCRIPT = [
  'echo "LOAD:$(cut -d" " -f1-3 /proc/loadavg 2>/dev/null)"',
  'echo "CPU:$(awk \'/^cpu / {print $2+$3+$4+$5+$6+$7+$8+$9, $5+$6; exit}\' /proc/stat 2>/dev/null)"',
  'MT=$(awk \'/MemTotal/ {print $2; exit}\' /proc/meminfo 2>/dev/null); MA=$(awk \'/MemAvailable/ {print $2; exit}\' /proc/meminfo 2>/dev/null); [ -n "$MA" ] || MA=$(awk \'/MemFree/ {print $2; exit}\' /proc/meminfo 2>/dev/null); echo "MEM:${MT} ${MA}"',
  'echo "DISK:$(df -Pk / 2>/dev/null | awk \'NR==2 {print $2, $3, $4; exit}\')"',
  'echo "NET:$(awk \'$1 ~ /:/ {gsub(/:/,"",$1); if ($1!="lo") {rx+=$2; tx+=$10}} END {print rx, tx}\' /proc/net/dev 2>/dev/null)"',
  'awk \'$1 ~ /:/ {gsub(/:/,"",$1); if ($1!="lo") print "IF:"$1" "$2" "$10}\' /proc/net/dev 2>/dev/null',
  'echo "UPTIME:$(cut -d" " -f1 /proc/uptime 2>/dev/null)"',
  'echo "OS:$(uname -sr 2>/dev/null)"',
  'echo "PROCCNT:$(ps -eo pid= 2>/dev/null | wc -l | tr -d " ")"',
  'ps aux --sort=-%cpu 2>/dev/null | awk \'NR>1 && NR<=11 {name=$11; for(i=12;i<=NF;i++) name=name" "$i; if(length(name)>48) name=substr(name,1,48); gsub(/\\|/,"/",name); print "PROC:"$2"|"$1"|"$3"|"$4"|"$6"|"$8"|"name}\'',
].join("; ");

// Run via a dedicated SSH exec channel (non-interactive). Do not nest `/bin/sh -c`
// — nested shells break variable assignments like MT=$(awk ...) for memory collection.
export const STATUS_COMMAND = STATUS_SCRIPT;

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
