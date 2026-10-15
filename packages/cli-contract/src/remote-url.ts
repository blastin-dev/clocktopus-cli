// `scheme://authority/…`: the authority ends at the first `/`, `?` or `#`, and
// its userinfo at the last `@` in it, so an unencoded `@` in a password stays out
// of the host.
const URL_FORM = /^([a-z][a-z0-9+.-]*):\/\/([^/?#]*)(.*)$/is;

// git's scp-like `[user@]host:path`, which it reads only when no `/` precedes
// the colon.
const SCP_FORM = /^([^@/]+)@([^/:]+:.*)$/s;

// An SSH user name is not a credential, and `git@host:owner/repo` is the form
// the server's repository parser matches.
const SSH_SCHEMES = new Set(["ssh", "git+ssh", "ssh+git"]);

// Drops what can carry a credential from a git remote: all userinfo from an
// `https://` (or any non-SSH) URL, and the password from an SSH one. Local paths
// and `file://` URLs come back unchanged.
export function stripRemoteCredentials(remote: string): string {
  const url = remote.match(URL_FORM);
  if (url) {
    const [, scheme = "", authority = "", rest = ""] = url;
    const at = authority.lastIndexOf("@");
    if (at === -1) return remote;

    const user = authority.slice(0, at).split(":")[0];
    const keptUser =
      SSH_SCHEMES.has(scheme.toLowerCase()) && user ? `${user}@` : "";
    return `${scheme}://${keptUser}${authority.slice(at + 1)}${rest}`;
  }

  const scp = remote.match(SCP_FORM);
  if (scp) {
    const [, userinfo = "", hostAndPath = ""] = scp;
    return `${userinfo.split(":")[0]}@${hostAndPath}`;
  }

  return remote;
}
