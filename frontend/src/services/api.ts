import axios, { type AxiosError } from "axios";
import toast from "react-hot-toast";

export const API_URL = import.meta.env.VITE_API_URL ?? "http://localhost:3000";

const api = axios.create({
  baseURL: API_URL,
  timeout: 15_000,
});

// Attach JWT to every request
api.interceptors.request.use((config) => {
  const token = localStorage.getItem("token");
  if (token) {
    config.headers.Authorization = `Bearer ${token}`;
  }
  return config;
});

/**
 * A 401 means "your session is no longer valid" only when we actually sent a token
 * to a protected endpoint. A 401 from /auth/login is just "wrong password" and must
 * not trigger a logout or a "session expired" message.
 */
export const isSessionExpiry = (error: AxiosError): boolean => {
  if (error.response?.status !== 401) return false;
  const url = error.config?.url ?? "";
  const sentToken = Boolean(error.config?.headers?.Authorization);
  return sentToken && !url.startsWith("/auth/");
};

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError) => {
    if (isSessionExpiry(error)) {
      localStorage.removeItem("token");
      localStorage.removeItem("user");
      toast.error("Session expired. Please login again.", { id: "session-expired" });
      window.dispatchEvent(new Event("logout"));
    }
    return Promise.reject(error);
  }
);

export default api;
