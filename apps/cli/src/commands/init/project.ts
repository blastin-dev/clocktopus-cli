import type { OnboardingState } from "@repo/cli-contract/onboarding";
import type { RepoStatusResponse } from "@repo/cli-contract/repository-status";
import type { z } from "zod";
import {
  CreatedOrganizationSchema,
  CreatedProjectSchema,
  ManageableProjectsSchema,
  RepositoryPreviewSchema,
} from "@repo/cli-contract/onboarding";

import type { Checkout, InitDeps, InitOptions, InitState } from "./types.js";
import { ApiError } from "../../lib/api.js";

type Organization = OnboardingState["organizations"][number];
type LinkedProject = NonNullable<RepoStatusResponse["linkedProjects"]>[number];
type ManageableProject = z.infer<
  typeof ManageableProjectsSchema
>["projects"][number];

const ADMIN_ROLES = new Set(["owner", "admin"]);

function matches(value: string, ...candidates: string[]): boolean {
  const wanted = value.trim().toLowerCase();
  return candidates.some((candidate) => candidate.toLowerCase() === wanted);
}

// By id, slug or name.
function findOrganization(organizations: Organization[], flag: string) {
  return organizations.find((org) => matches(flag, org.id, org.slug, org.name));
}

// The project a teammate already attached the repository to, so an invitee is
// never offered a second one. `--organization` narrows it when the repository
// sits in several of the caller's organisations.
export function findLinkedProject(
  linked: LinkedProject[],
  organizations: Organization[],
  organizationFlag: string | undefined,
): LinkedProject | null {
  if (organizationFlag) {
    const organization = findOrganization(organizations, organizationFlag);
    const inIt = linked.find(
      (project) => project.organizationId === organization?.id,
    );
    if (inIt) return inIt;
  }
  return linked[0] ?? null;
}

// The organisation `--organization` names, the only one, or the first the
// caller administers. Null asks.
export function pickOrganization(
  organizations: Organization[],
  flag: string | undefined,
): Organization | null {
  if (flag) {
    const named = findOrganization(organizations, flag);
    if (!named) {
      throw new Error(
        `You are not a member of an organisation called "${flag}".`,
      );
    }
    return named;
  }
  if (organizations.length === 1) return organizations[0] ?? null;
  return null;
}

function defaultProjectName(checkout: Checkout): string {
  return checkout.repository?.repo ?? "My project";
}

function describeApiError(error: unknown): string {
  return error instanceof Error ? error.message : "unknown error";
}

async function createOrganization(
  deps: InitDeps,
  options: InitOptions,
): Promise<Organization> {
  const name =
    options.newOrganization ??
    (deps.prompt.interactive
      ? await deps.prompt.text("Name your organisation", "")
      : "");
  if (!name.trim()) {
    throw new Error(
      "You need an organisation first. Pass --new-organization <name>.",
    );
  }
  // Better Auth runs the organisation hooks, so the default job role is
  // seeded as for the web's team step.
  const created = CreatedOrganizationSchema.parse(
    await deps.api.post("/api/organizations", { name: name.trim() }),
  );
  deps.log(`✓ Organisation  created ${created.organization.name}`);
  return { ...created.organization, role: "owner" };
}

async function chooseOrganization(
  deps: InitDeps,
  options: InitOptions,
  organizations: Organization[],
): Promise<Organization> {
  if (options.newOrganization || organizations.length === 0) {
    return createOrganization(deps, options);
  }
  const picked = pickOrganization(organizations, options.organization);
  if (picked) return picked;

  const fallback = Math.max(
    organizations.findIndex((org) => ADMIN_ROLES.has(org.role)),
    0,
  );
  return deps.prompt.choose(
    "Which organisation does this repository belong to?",
    organizations.map((org) => ({
      label: `${org.name} (${org.role})`,
      value: org,
    })),
    fallback,
  );
}

async function attachToExisting(
  deps: InitDeps,
  organizationId: string,
  project: ManageableProject,
  remote: string,
): Promise<boolean> {
  const base = `/api/organizations/${encodeURIComponent(organizationId)}/projects/${encodeURIComponent(project.id)}/repositories`;
  const { preview } = RepositoryPreviewSchema.parse(
    await deps.api.get(
      `${base}/preview?repositoryUrl=${encodeURIComponent(remote)}`,
    ),
  );
  if (preview.entries > 0) {
    const hours = (preview.seconds / 3600).toFixed(1);
    deps.log(
      `  Attaching it files ${preview.entries} unassigned entries (${hours}h, ${preview.firstDay} to ${preview.lastDay}) under ${project.name}` +
        (preview.lockedEntries > 0
          ? `, ${preview.lockedEntries} of them on locked days.`
          : "."),
    );
    if (!(await deps.prompt.confirm("Attach it?", true))) return false;
  }
  await deps.api.post(base, { repositoryUrl: remote });
  return true;
}

// Detects first: a repository already in one of the caller's organisations is
// left where it is. Otherwise picks or creates the organisation and the
// project, and attaches the repository.
export async function runProjectStep(
  deps: InitDeps,
  options: InitOptions,
  checkout: Checkout,
  onboarding: OnboardingState,
  status: RepoStatusResponse | null,
  state: InitState,
): Promise<void> {
  const linked = findLinkedProject(
    status?.linkedProjects ?? [],
    onboarding.organizations,
    options.organization,
  );
  if (linked) {
    state.organizationId = linked.organizationId;
    state.projectName = linked.name;
    deps.log(
      `✓ Project       ${status?.repository?.ownerRepo ?? "this repository"} is already in ${linked.name} (${linked.organizationName}) — nothing to create`,
    );
    return;
  }

  const organization = await chooseOrganization(
    deps,
    options,
    onboarding.organizations,
  );
  state.organizationId = organization.id;

  if (!checkout.remote || !status?.repository) {
    deps.log(
      `✓ Organisation  ${organization.name} — no GitHub or Bitbucket remote here, so no project was attached`,
    );
    return;
  }

  if (!ADMIN_ROLES.has(organization.role)) {
    deps.log(
      `⚠ Project       only owners and admins of ${organization.name} attach repositories.\n` +
        `      Ask one to add ${status.repository.ownerRepo} to a project, then run 'clocktopus init' again.`,
    );
    return;
  }

  const projectsPath = `/api/organizations/${encodeURIComponent(organization.id)}/projects`;
  const { projects } = ManageableProjectsSchema.parse(
    await deps.api.get(projectsPath),
  );

  let existing: ManageableProject | null = null;
  let newName: string | null = options.newProject ?? null;
  if (options.project) {
    existing =
      projects.find((project) =>
        matches(options.project ?? "", project.id, project.name),
      ) ?? null;
    if (!existing) {
      throw new Error(
        `${organization.name} has no project called "${options.project}".`,
      );
    }
  } else if (!newName && projects.length > 0) {
    // `null` creates a new project.
    existing = await deps.prompt.choose<ManageableProject | null>(
      `Which project does ${status.repository.ownerRepo} belong to?`,
      [
        { label: "Create a new project", value: null },
        ...projects.map((project) => ({ label: project.name, value: project })),
      ],
      0,
    );
  }

  try {
    if (existing) {
      if (
        !(await attachToExisting(
          deps,
          organization.id,
          existing,
          checkout.remote,
        ))
      ) {
        deps.log("– Project       left unattached");
        return;
      }
      state.projectName = existing.name;
      deps.log(
        `✓ Project       attached ${status.repository.ownerRepo} to ${existing.name}`,
      );
      return;
    }

    const name =
      newName ??
      (await deps.prompt.text(
        "Name the project",
        defaultProjectName(checkout),
      ));
    newName = name.trim() || defaultProjectName(checkout);
    CreatedProjectSchema.parse(
      await deps.api.post(projectsPath, {
        name: newName,
        repositoryUrls: [checkout.remote],
      }),
    );
    state.projectName = newName;
    deps.log(
      `✓ Project       created ${newName} with ${status.repository.ownerRepo}`,
    );
  } catch (error) {
    // 409: another project in the organisation already links the repository.
    if (error instanceof ApiError && error.status === 409) {
      deps.log(`✗ Project       ${describeApiError(error)}`);
      return;
    }
    throw error;
  }
}
