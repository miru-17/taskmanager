import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import api from "../services/api";
import { useAuth } from "../context/AuthContext";

type State = "verifying" | "done" | "failed";

const VerifyEmail = () => {
  const { token } = useParams();
  const { isAuthenticated, reload } = useAuth();
  const [state, setState] = useState<State>("verifying");
  const [message, setMessage] = useState("");
  // Tokens are single-use: make sure React StrictMode's double effect doesn't spend it twice
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return;
    started.current = true;
    api
      .post("/auth/verify-email", { token })
      .then(() => setState("done"))
      .catch((err) => {
        setMessage(err.response?.data?.message ?? "This link is invalid or has expired");
        setState("failed");
      });
  }, [token]);

  useEffect(() => {
    if (state === "done" && isAuthenticated) void reload().catch(() => undefined);
  }, [state, isAuthenticated, reload]);

  return (
    <div className="min-h-screen bg-slate-950 flex items-center justify-center p-4">
      <div className="w-full max-w-md rounded-3xl bg-slate-900 border border-slate-800 p-8 text-center" role="status">
        {state === "verifying" && <p className="text-slate-300">Verifying your email…</p>}
        {state === "done" && (
          <>
            <h1 className="text-2xl font-bold text-white">Email verified</h1>
            <p className="text-slate-300 mt-3">Thanks — your address is confirmed.</p>
          </>
        )}
        {state === "failed" && (
          <>
            <h1 className="text-2xl font-bold text-white">Couldn't verify</h1>
            <p className="text-slate-300 mt-3">{message}</p>
            <p className="text-slate-400 mt-2 text-sm">Sign in and request a new link from Security settings.</p>
          </>
        )}
        {state !== "verifying" && (
          <Link
            to={isAuthenticated ? "/" : "/login"}
            className="inline-block mt-8 px-6 py-3 rounded-xl bg-cyan-500 hover:bg-cyan-600 text-white font-semibold"
          >
            {isAuthenticated ? "Go to my tasks" : "Sign in"}
          </Link>
        )}
      </div>
    </div>
  );
};

export default VerifyEmail;
