const DOH_URL = "https://1.1.1.1/dns-query";

const IPV4_RE =
  /^(?:(?:25[0-5]|2[0-4]\d|[01]?\d\d?)\.){3}(?:25[0-5]|2[0-4]\d|[01]?\d\d?)$/;

interface DohAnswer {
  name: string;
  type: number;
  TTL: number;
  data: string;
}

interface DohResponse {
  Status: number;
  Answer?: DohAnswer[];
}

function stripBrackets(host: string): string {
  const trimmed = host.trim();
  if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function isIPv4(host: string): boolean {
  return IPV4_RE.test(host);
}

function isIPv6(host: string): boolean {
  if (!host.includes(":")) return false;
  return /^[0-9a-fA-F:.]+$/.test(host);
}

export function isIpAddress(host: string): boolean {
  const normalized = stripBrackets(host);
  return isIPv4(normalized) || isIPv6(normalized);
}

function formatConnectHostname(address: string): string {
  return address.includes(":") ? `[${address}]` : address;
}

async function queryDoh(name: string, type: "A" | "AAAA"): Promise<string | null> {
  const url = new URL(DOH_URL);
  url.searchParams.set("name", name);
  url.searchParams.set("type", type);

  const response = await fetch(url.toString(), {
    headers: { Accept: "application/dns-json" },
  });
  if (!response.ok) {
    throw new Error(`DNS 查询失败 (${response.status})`);
  }

  const body = (await response.json()) as DohResponse;
  if (body.Status !== 0 || !body.Answer?.length) {
    return null;
  }

  const typeCode = type === "A" ? 1 : 28;
  const record = body.Answer.find((answer) => answer.type === typeCode);
  return record?.data ?? null;
}

export async function resolveHostAddress(host: string): Promise<string> {
  const normalized = stripBrackets(host);
  if (!normalized) {
    throw new Error("主机名为空");
  }

  if (isIpAddress(normalized)) {
    return normalized;
  }

  if (
    normalized.length > 253 ||
    !/^[a-zA-Z0-9.-]+$/.test(normalized) ||
    normalized.startsWith(".") ||
    normalized.endsWith(".") ||
    normalized.includes("..")
  ) {
    throw new Error("无效的主机名");
  }

  const ipv4 = await queryDoh(normalized, "A");
  if (ipv4) return ipv4;

  const ipv6 = await queryDoh(normalized, "AAAA");
  if (ipv6) return ipv6;

  throw new Error(`无法解析域名: ${normalized}`);
}

export async function connectToHost(host: string, port: number) {
  const { connect } = await import("cloudflare:sockets");
  const address = await resolveHostAddress(host);
  const socket = connect({
    hostname: formatConnectHostname(address),
    port,
  });
  await socket.opened;
  return socket;
}
