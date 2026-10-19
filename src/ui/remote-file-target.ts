export type RemoteFileTarget = {
  path: string;
  line: number | null;
  column: number | null;
};

const remoteFileRoots = [
  "/Users/",
  "/home/",
  "/tmp/",
  "/private/",
  "/var/",
  "/opt/",
  "/workspace/",
  "/workspaces/",
  "/repo/",
  "/app/",
];

export function parseRemoteFileHref(
  href: string | null | undefined,
): RemoteFileTarget | null {
  if (!href) return null;
  let decoded = href;
  try {
    decoded = href.startsWith("file://")
      ? new URL(href).pathname
      : decodeURIComponent(href);
  } catch {
    return null;
  }
  if (!remoteFileRoots.some((root) => decoded.startsWith(root))) return null;
  const location = decoded.match(/^(.*?):(\d+)(?::(\d+))?$/);
  const path = location?.[1] ?? decoded;
  if (!path || path.endsWith("/")) return null;
  return {
    path,
    line: location ? Number(location[2]) : null,
    column: location?.[3] ? Number(location[3]) : null,
  };
}
