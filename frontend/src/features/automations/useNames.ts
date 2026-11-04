import { useMemo } from "react";
import { useLabels } from "../../data/queries";
import { useAssignable } from "../tasks/useAssignable";

/** Turns the ids stored in a rule back into names; anything gone shows as such rather than as a raw id. */
export const useNames = (projectId: string) => {
  const people = useAssignable(projectId);
  const { data: labels = [] } = useLabels();
  return useMemo(
    () => ({
      person: (id: number) => {
        const p = people.find((x) => x.id === id);
        return p ? p.name || p.email : "a removed person";
      },
      label: (id: string) => {
        const l = labels.find((x) => x.id === id);
        return l ? `“${l.name}”` : "a deleted label";
      },
    }),
    [people, labels]
  );
};
