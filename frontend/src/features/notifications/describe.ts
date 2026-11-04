import { STATUS_LABELS, type AppNotification } from "../../types/Task";

/** One line describing a notification, in plain words. */
export const describeNotification = (n: AppNotification): string => {
  const who = n.data.actorName;
  switch (n.type) {
    case "MENTIONED":
      return `${who} mentioned you`;
    case "COMMENTED":
      return `${who} commented`;
    case "ASSIGNED":
      return `${who} assigned this to you`;
    case "STATUS_CHANGED":
      return `${who} moved it to ${n.data.to ? STATUS_LABELS[n.data.to] : "a new status"}`;
    case "APPROVAL_REQUESTED":
      return `${who} asked for your approval`;
    case "APPROVAL_DECIDED":
      return n.data.outcome === "APPROVED" ? `${who} approved it${n.data.completed ? "; it's done" : ""}` : `${who} requested changes`;
    case "DUE_SOON":
      return "Due tomorrow";
    case "AUTOMATION":
      return n.data.message ? `${n.data.rule ? `“${n.data.rule}”: ` : ""}${n.data.message}` : "An automation ran";
  }
};

