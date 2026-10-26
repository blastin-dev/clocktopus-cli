// A remote cloned through a `Host` alias in `~/.ssh/config`
// (`git@github-work:acme-co/portal.git`) names a host only this machine can
// resolve, so the server can't match it to a repository. git expands
// `url.<base>.insteadOf` itself in `git remote -v` and `git remote get-url`;
// SSH aliases it leaves to ssh.

// `ssh -G <host>` output, or undefined when ssh is missing or fails.
export type ReadSshConfig = (host: string) => string | undefined;

const SSH_URL =
  /^(ssh|git\+ssh|ssh\+git):\/\/(?:([^@/]+)@)?([^/:]+)(:\d+)?(\/.*)$/i;

// git reads `[user@]host:path` as SSH only when no `/` precedes the colon.
const SCP_FORM = /^(?:([^@/:]+)@)?([^/:]+):(?!\/\/)(.+)$/;

const SSH_HOST = /^[a-z0-9_][a-z0-9._-]*$/i;

function sshConfigValue(config: string, key: string) {
  for (const line of config.split("\n")) {
    const [name, ...value] = line.trim().split(/\s+/);
    if (name?.toLowerCase() === key) return value.join(" ") || undefined;
  }
  return undefined;
}

// The remote with an SSH host alias replaced by the host ssh connects to, in
// the scp-like form `git@github.com:owner/repo.git` the server matches. Any
// other remote, and one whose host is already real, comes back unchanged.
export function resolveSshHostAlias(
  remote: string,
  readSshConfig: ReadSshConfig,
): string {
  const url = remote.match(SSH_URL);
  const scp = url || remote.includes("://") ? null : remote.match(SCP_FORM);

  const user = url ? url[2] : scp?.[1];
  const host = url ? url[3] : scp?.[2];
  // A host starting with `-` would reach ssh as an option.
  if (!host || !SSH_HOST.test(host)) return remote;

  const config = readSshConfig(host);
  const hostname = config && sshConfigValue(config, "hostname");
  if (!hostname || hostname.toLowerCase() === host.toLowerCase()) return remote;

  // Without a user in the remote, ssh logs in as the alias's `User`.
  const login = user ?? sshConfigValue(config, "user");
  const prefix = login ? `${login}@` : "";

  if (url) {
    const [, scheme, , , port = "", path = ""] = url;
    // A non-default port keeps the URL form, which carries it.
    if (port && port !== ":22")
      return `${scheme}://${prefix}${hostname}${port}${path}`;
    return `${prefix}${hostname}:${path.slice(1)}`;
  }
  return `${prefix}${hostname}:${scp?.[3] ?? ""}`;
}
