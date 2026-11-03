import { useAuth } from "../../context/AuthContext";
import { useOrgMembers, useProjectMembers } from "../../data/queries";

/** People who can be assigned. Org members when visible to the caller, otherwise the project's members. */
export const useAssignable = (projectId?: string) => {
  const { can } = useAuth();
  const org = useOrgMembers();
  const project = useProjectMembers(!can("members:read") ? projectId : undefined);
  const people = can("members:read")
    ? (org.data ?? []).filter((m) => m.role !== "VIEWER").map((m) => ({ id: m.userId, email: m.email, name: m.name }))
    : (project.data ?? []).map((m) => ({ id: m.userId, email: m.email, name: m.name }));
  return people;
};
