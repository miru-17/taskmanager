import type { AxiosError } from "axios";

/** Server messages are written for users (see backend core/errors), so prefer them. */
export const getErrorMessage = (err: unknown, fallback = "Something went wrong"): string => {
  const e = err as AxiosError<{ message?: string }>;
  if (e?.response?.data?.message) return e.response.data.message;
  if (e?.code === "ERR_NETWORK") return "Can't reach the server. Check your connection.";
  return fallback;
};

export const errorStatus = (err: unknown) => (err as AxiosError)?.response?.status;
