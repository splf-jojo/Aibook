"use client";

import { LogIn, UserPlus } from "lucide-react";
import dynamic from "next/dynamic";
import { FormEvent, useCallback, useEffect, useState } from "react";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const TOKEN_KEY = "canvas_access_token";
const THEME_KEY = "canvas_app_theme";
const LANGUAGE_KEY = "canvas_app_language";

type AppTheme = "light" | "dark";
type AppLanguage = "ru" | "en" | "zh";

const authText = {
  ru: { login: "Логин", password: "Пароль", signIn: "Войти", register: "Зарегистрироваться" },
  en: { login: "Username", password: "Password", signIn: "Sign in", register: "Create account" },
  zh: { login: "用户名", password: "密码", signIn: "登录", register: "注册" },
} satisfies Record<AppLanguage, Record<string, string>>;

const KonvaDrawingCanvas = dynamic(
  () => import("./konva-drawing-canvas").then((module) => module.KonvaDrawingCanvas),
  {
    ssr: false,
    loading: () => <main className="h-dvh bg-[#f4f5f7]" />,
  },
);

function Auth({
  language,
  onAuthenticated,
}: {
  language: AppLanguage;
  onAuthenticated: (token: string) => void;
}) {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const text = authText[language];

  const submit = async (mode: "login" | "register") => {
    if (busy || username.length < 3 || password.length < 8) return;
    setBusy(true);
    setFailed(false);
    try {
      const response = await fetch(`${API_URL}/api/auth/${mode}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!response.ok) throw new Error("auth");
      const payload = (await response.json()) as { access_token: string };
      localStorage.setItem(TOKEN_KEY, payload.access_token);
      onAuthenticated(payload.access_token);
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  };

  const onSubmit = (event: FormEvent) => {
    event.preventDefault();
    void submit("login");
  };

  return (
    <main className="grid h-dvh place-items-center bg-[#f4f5f7] p-6">
      <form
        onSubmit={onSubmit}
        className="flex w-full max-w-[320px] flex-col gap-3 rounded-2xl border border-[#dfe3e8] bg-white p-5 shadow-sm"
      >
        <input
          aria-label={text.login}
          autoComplete="username"
          className={`h-11 rounded-lg border bg-white px-3 text-sm text-[#111827] placeholder:text-[#697386] ${failed ? "border-red-400" : "border-[#dfe3e8]"}`}
          onChange={(event) => setUsername(event.target.value)}
          placeholder={text.login}
          spellCheck={false}
          value={username}
        />
        <input
          aria-label={text.password}
          autoComplete="current-password"
          className={`h-11 rounded-lg border bg-white px-3 text-sm text-[#111827] placeholder:text-[#697386] ${failed ? "border-red-400" : "border-[#dfe3e8]"}`}
          onChange={(event) => setPassword(event.target.value)}
          placeholder={text.password}
          type="password"
          value={password}
        />
        <div className="mt-1 grid grid-cols-2 gap-2">
          <button
            aria-label={text.signIn}
            className="grid h-11 place-items-center rounded-lg bg-[#2563eb] text-white disabled:opacity-50"
            disabled={busy}
            type="submit"
          >
            <LogIn aria-hidden="true" size={18} strokeWidth={2} />
          </button>
          <button
            aria-label={text.register}
            className="grid h-11 place-items-center rounded-lg border border-[#dfe3e8] bg-white text-[#697386] hover:bg-[#f4f5f7] disabled:opacity-50"
            disabled={busy}
            onClick={() => void submit("register")}
            type="button"
          >
            <UserPlus aria-hidden="true" size={18} strokeWidth={2} />
          </button>
        </div>
      </form>
    </main>
  );
}

export function CanvasApp() {
  const [token, setToken] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [theme, setTheme] = useState<AppTheme>("light");
  const [language, setLanguage] = useState<AppLanguage>("ru");

  useEffect(() => {
    const storedTheme = localStorage.getItem(THEME_KEY);
    const storedLanguage = localStorage.getItem(LANGUAGE_KEY);
    if (storedTheme === "light" || storedTheme === "dark") setTheme(storedTheme);
    if (storedLanguage === "ru" || storedLanguage === "en" || storedLanguage === "zh") {
      setLanguage(storedLanguage);
    }
    const stored = localStorage.getItem(TOKEN_KEY);
    if (!stored) {
      setReady(true);
      return;
    }
    fetch(`${API_URL}/api/auth/me`, { headers: { Authorization: `Bearer ${stored}` } })
      .then((response) => {
        if (!response.ok) throw new Error("expired");
        setToken(stored);
      })
      .catch(() => localStorage.removeItem(TOKEN_KEY))
      .finally(() => setReady(true));
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    document.documentElement.lang = language === "zh" ? "zh-CN" : language;
  }, [language, theme]);

  const changeTheme = useCallback((nextTheme: AppTheme) => {
    setTheme(nextTheme);
    localStorage.setItem(THEME_KEY, nextTheme);
  }, []);

  const changeLanguage = useCallback((nextLanguage: AppLanguage) => {
    setLanguage(nextLanguage);
    localStorage.setItem(LANGUAGE_KEY, nextLanguage);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(TOKEN_KEY);
    setToken(null);
  }, []);

  if (!ready) return <main className="h-dvh bg-[#f4f5f7]" />;
  if (!token) return <Auth language={language} onAuthenticated={setToken} />;
  return (
    <KonvaDrawingCanvas
      appTheme={theme}
      language={language}
      onLanguageChange={changeLanguage}
      onLogout={logout}
      onThemeChange={changeTheme}
      token={token}
    />
  );
}
