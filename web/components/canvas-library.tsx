"use client";

import {
  BookOpen,
  Folder,
  FolderPlus,
  Languages,
  LogOut,
  Moon,
  Pencil,
  Plus,
  Settings,
  Sun,
  Trash2,
  X,
} from "lucide-react";
import { useCallback, useEffect, useState } from "react";

import {
  API_URL,
  apiHeaders,
  type CanvasRecord,
  type CanvasSummary,
  type NoteGroup,
} from "@/lib/canvas-api";

type AppLanguage = "ru" | "en" | "zh";
type AppTheme = "light" | "dark";

const COPY = {
  ru: {
    all: "Все заметки", ungrouped: "Без группы", newGroup: "Новая группа", groupName: "Название группы",
    move: "Группа заметки", deleteGroup: "Удалить группу", confirmDeleteGroup: "Удалить группу? Заметки останутся в «Без группы».",
    operationFailed: "Не удалось выполнить действие. Попробуйте ещё раз.",
    title: "Мои канвасы",
    create: "Создать канвас",
    empty: "Канвасов пока нет",
    emptyHint: "Создайте первый канвас, чтобы начать рисовать.",
    untitled: "Новый канвас",
    open: "Открыть",
    rename: "Переименовать",
    saveName: "Сохранить название",
    cancel: "Отмена",
    remove: "Удалить",
    confirmDelete: "Удалить этот канвас? Это действие нельзя отменить.",
    modified: "Изменён",
    objects: "объектов",
    failed: "Не удалось загрузить канвасы",
    settings: "Настройки",
    closeSettings: "Закрыть настройки",
    theme: "Тема",
    light: "Светлая",
    dark: "Тёмная",
    language: "Язык",
    logout: "Выйти",
  },
  en: {
    all: "All notes", ungrouped: "Ungrouped", newGroup: "New group", groupName: "Group name",
    move: "Note group", deleteGroup: "Delete group", confirmDeleteGroup: "Delete this group? Notes will be kept in Ungrouped.",
    operationFailed: "Could not complete the action. Please try again.",
    title: "My canvases",
    create: "Create canvas",
    empty: "No canvases yet",
    emptyHint: "Create your first canvas to start drawing.",
    untitled: "New canvas",
    open: "Open",
    rename: "Rename",
    saveName: "Save name",
    cancel: "Cancel",
    remove: "Delete",
    confirmDelete: "Delete this canvas? This action cannot be undone.",
    modified: "Modified",
    objects: "objects",
    failed: "Could not load canvases",
    settings: "Settings",
    closeSettings: "Close settings",
    theme: "Theme",
    light: "Light",
    dark: "Dark",
    language: "Language",
    logout: "Log out",
  },
  zh: {
    all: "全部笔记", ungrouped: "未分组", newGroup: "新建分组", groupName: "分组名称",
    move: "笔记分组", deleteGroup: "删除分组", confirmDeleteGroup: "删除此分组？笔记将保留在未分组中。",
    operationFailed: "操作失败，请重试。",
    title: "我的画布",
    create: "创建画布",
    empty: "还没有画布",
    emptyHint: "创建第一个画布开始绘图。",
    untitled: "新画布",
    open: "打开",
    rename: "重命名",
    saveName: "保存名称",
    cancel: "取消",
    remove: "删除",
    confirmDelete: "删除此画布？此操作无法撤销。",
    modified: "已修改",
    objects: "个对象",
    failed: "无法加载画布",
    settings: "设置",
    closeSettings: "关闭设置",
    theme: "主题",
    light: "浅色",
    dark: "深色",
    language: "语言",
    logout: "退出",
  },
} satisfies Record<AppLanguage, Record<string, string>>;

export function CanvasLibrary({
  appTheme,
  language,
  onLanguageChange,
  onLogout,
  onOpen,
  onThemeChange,
  token,
}: {
  appTheme: AppTheme;
  language: AppLanguage;
  onLanguageChange: (language: AppLanguage) => void;
  onLogout: () => void;
  onOpen: (canvas: CanvasRecord) => void;
  onThemeChange: (theme: AppTheme) => void;
  token: string;
}) {
  const [canvases, setCanvases] = useState<CanvasSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [failed, setFailed] = useState(false);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [titleDraft, setTitleDraft] = useState("");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [groups, setGroups] = useState<NoteGroup[]>([]);
  const [groupFilter, setGroupFilter] = useState("all");
  const [groupEditor, setGroupEditor] = useState<NoteGroup | "new" | null>(null);
  const [groupName, setGroupName] = useState("");
  const [groupBusy, setGroupBusy] = useState(false);
  const [actionFailed, setActionFailed] = useState(false);
  const text = COPY[language];
  const visibleCanvases = canvases.filter((canvas) => groupFilter === "all" ||
    (groupFilter === "ungrouped" ? !canvas.groupId : canvas.groupId === groupFilter));
  const selectedGroup = groups.find((group) => group.id === groupFilter);

  const handleAuthFailure = useCallback(
    (response: Response) => {
      if (response.status === 401 || response.status === 403) {
        onLogout();
        return true;
      }
      return false;
    },
    [onLogout],
  );

  const loadCanvases = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      const [response, groupResponse] = await Promise.all([
        fetch(`${API_URL}/api/canvases`, { headers: apiHeaders(token) }),
        fetch(`${API_URL}/api/note-groups`, { headers: apiHeaders(token) }),
      ]);
      if (handleAuthFailure(response) || handleAuthFailure(groupResponse)) return;
      if (!response.ok || !groupResponse.ok) throw new Error("library-list-failed");
      setCanvases((await response.json()) as CanvasSummary[]);
      const nextGroups = await groupResponse.json() as NoteGroup[];
      setGroups(nextGroups);
      setGroupFilter((current) => current === "ungrouped" || nextGroups.some((group) => group.id === current) ? current : "all");
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, [handleAuthFailure, token]);

  useEffect(() => {
    void loadCanvases();
  }, [loadCanvases]);

  const createCanvas = async () => {
    if (creating) return;
    setCreating(true);
    try {
      const response = await fetch(`${API_URL}/api/canvases`, {
        method: "POST",
        headers: apiHeaders(token, true),
        body: JSON.stringify({ title: `${text.untitled} ${canvases.length + 1}`, groupId: selectedGroup?.id ?? null }),
      });
      if (handleAuthFailure(response)) return;
      if (!response.ok) throw new Error("canvas-create-failed");
      onOpen((await response.json()) as CanvasRecord);
    } catch {
      setFailed(true);
    } finally {
      setCreating(false);
    }
  };

  const openCanvas = async (id: string) => {
    if (busyId) return;
    setBusyId(id);
    try {
      const response = await fetch(`${API_URL}/api/canvases/${id}`, {
        headers: apiHeaders(token),
      });
      if (handleAuthFailure(response)) return;
      if (!response.ok) throw new Error("canvas-open-failed");
      onOpen((await response.json()) as CanvasRecord);
    } catch {
      setFailed(true);
    } finally {
      setBusyId(null);
    }
  };

  const beginRename = (canvas: CanvasSummary) => {
    setEditingId(canvas.id);
    setTitleDraft(canvas.title);
  };

  const renameCanvas = async (id: string) => {
    const title = titleDraft.trim();
    if (!title || busyId) return;
    setBusyId(id);
    try {
      const response = await fetch(`${API_URL}/api/canvases/${id}`, {
        method: "PATCH",
        headers: apiHeaders(token, true),
        body: JSON.stringify({ title }),
      });
      if (handleAuthFailure(response)) return;
      if (!response.ok) throw new Error("canvas-rename-failed");
      const updated = (await response.json()) as CanvasRecord;
      setCanvases((current) =>
        current.map((canvas) =>
          canvas.id === id
            ? { ...canvas, title: updated.title, updatedAt: updated.updatedAt }
            : canvas,
        ),
      );
      setEditingId(null);
    } catch {
      setFailed(true);
    } finally {
      setBusyId(null);
    }
  };

  const deleteCanvas = async (id: string) => {
    if (busyId || !window.confirm(text.confirmDelete)) return;
    setBusyId(id);
    try {
      const response = await fetch(`${API_URL}/api/canvases/${id}`, {
        method: "DELETE",
        headers: apiHeaders(token),
      });
      if (handleAuthFailure(response)) return;
      if (!response.ok) throw new Error("canvas-delete-failed");
      setCanvases((current) => current.filter((canvas) => canvas.id !== id));
    } catch {
      setFailed(true);
    } finally {
      setBusyId(null);
    }
  };

  const saveGroup = async () => {
    const name = groupName.trim();
    if (!name || groupBusy || !groupEditor) return;
    setGroupBusy(true);
    setActionFailed(false);
    try {
      const response = await fetch(`${API_URL}/api/note-groups${groupEditor === "new" ? "" : `/${groupEditor.id}`}`, {
        method: groupEditor === "new" ? "POST" : "PATCH", headers: apiHeaders(token, true), body: JSON.stringify({ name }),
      });
      if (handleAuthFailure(response)) return;
      if (!response.ok) throw new Error("group-save-failed");
      const updated = await response.json() as NoteGroup;
      setGroups((current) => current.some((group) => group.id === updated.id)
        ? current.map((group) => group.id === updated.id ? updated : group) : [...current, updated]);
      setGroupFilter(updated.id);
      setGroupEditor(null);
    } catch { setActionFailed(true); }
    finally { setGroupBusy(false); }
  };

  const removeGroup = async (group: NoteGroup) => {
    if (groupBusy || busyId || !window.confirm(text.confirmDeleteGroup)) return;
    setGroupBusy(true);
    setActionFailed(false);
    try {
      const response = await fetch(`${API_URL}/api/note-groups/${group.id}`, { method: "DELETE", headers: apiHeaders(token) });
      if (handleAuthFailure(response)) return;
      if (!response.ok) throw new Error("group-delete-failed");
      setGroups((current) => current.filter((item) => item.id !== group.id));
      setCanvases((current) => current.map((canvas) => canvas.groupId === group.id ? { ...canvas, groupId: null } : canvas));
      setGroupFilter("ungrouped");
    } catch { setActionFailed(true); }
    finally { setGroupBusy(false); }
  };

  const moveCanvas = async (id: string, groupId: string | null) => {
    if (busyId || groupBusy) return;
    setBusyId(id);
    setActionFailed(false);
    try {
      const response = await fetch(`${API_URL}/api/canvases/${id}`, {
        method: "PATCH", headers: apiHeaders(token, true), body: JSON.stringify({ groupId }),
      });
      if (handleAuthFailure(response)) return;
      if (!response.ok) throw new Error("canvas-move-failed");
      const updated = await response.json() as CanvasRecord;
      setCanvases((current) => current.map((canvas) => canvas.id === id
        ? { ...canvas, groupId: updated.groupId, updatedAt: updated.updatedAt } : canvas));
    } catch { setActionFailed(true); }
    finally { setBusyId(null); }
  };

  const locale = language === "zh" ? "zh-CN" : language === "en" ? "en-US" : "ru-RU";

  return (
    <>
    <main className="h-dvh overflow-y-auto bg-[#f4f5f7] px-5 py-6 sm:px-8">
      <div className="mx-auto w-full max-w-6xl">
        <header className="mb-8 flex flex-wrap items-center justify-between gap-4">
          <h1 className="text-2xl font-semibold text-[#111827]">{text.title}</h1>
          <div className="flex items-center gap-2">
            <button
              className="flex h-11 items-center gap-2 rounded-xl bg-[#2563eb] px-4 text-sm font-medium text-white disabled:opacity-50"
              disabled={creating}
              onClick={() => void createCanvas()}
              type="button"
            >
              <Plus aria-hidden="true" size={18} />
              {text.create}
            </button>
            <button
              aria-label={text.settings}
              className="grid size-11 place-items-center rounded-xl border border-[#dfe3e8] bg-white text-[#697386] hover:bg-[#eef0f3]"
              onClick={() => setSettingsOpen(true)}
              title={text.settings}
              type="button"
            >
              <Settings aria-hidden="true" size={18} />
            </button>
          </div>
        </header>

        <nav aria-label={text.move} className="mb-6 flex flex-wrap items-center gap-2">
          {[{ id: "all", name: text.all }, { id: "ungrouped", name: text.ungrouped }, ...groups].map((group) => (
            <button type="button" key={group.id} aria-pressed={groupFilter === group.id}
              onClick={() => setGroupFilter(group.id)}
              className={`flex max-w-full items-center gap-2 rounded-xl border px-4 py-2 text-sm ${groupFilter === group.id
                ? "border-[#2563eb] bg-[#eff6ff] text-[#2563eb]" : "border-[#dfe3e8] bg-white text-[#334155]"}`}>
              <Folder size={16} aria-hidden="true" /><span className="truncate">{group.name}</span>
            </button>
          ))}
          <button type="button" disabled={groupBusy} onClick={() => { setGroupName(""); setGroupEditor("new"); setActionFailed(false); }}
            className="flex items-center gap-2 rounded-xl px-3 py-2 text-sm text-[#2563eb] disabled:opacity-50">
            <FolderPlus size={18} aria-hidden="true" />{text.newGroup}
          </button>
          {selectedGroup && <>
            <button type="button" aria-label={text.rename} title={text.rename} disabled={groupBusy}
              className="p-2 text-[#697386]" onClick={() => { setGroupName(selectedGroup.name); setGroupEditor(selectedGroup); setActionFailed(false); }}><Pencil size={17} /></button>
            <button type="button" aria-label={text.deleteGroup} title={text.deleteGroup} disabled={groupBusy || busyId !== null}
              className="p-2 text-red-500" onClick={() => void removeGroup(selectedGroup)}><Trash2 size={17} /></button>
          </>}
        </nav>

        {groupEditor && <form className="mb-6 flex flex-wrap items-end gap-3 rounded-2xl border border-[#dfe3e8] bg-white p-4"
          onSubmit={(event) => { event.preventDefault(); void saveGroup(); }}>
          <label className="flex min-w-0 flex-1 flex-col gap-2 text-sm text-[#334155]">
            {groupEditor === "new" ? text.newGroup : text.rename}
            <input autoFocus aria-label={text.groupName} maxLength={120} value={groupName} disabled={groupBusy}
              onChange={(event) => setGroupName(event.target.value)}
              className="h-10 rounded-lg border border-[#dfe3e8] bg-white px-3 text-[#111827]" />
          </label>
          <button type="submit" disabled={groupBusy || !groupName.trim()} className="h-10 rounded-lg bg-[#2563eb] px-4 text-sm text-white disabled:opacity-50">{text.saveName}</button>
          <button type="button" disabled={groupBusy} onClick={() => setGroupEditor(null)} className="h-10 px-3 text-sm text-[#697386]">{text.cancel}</button>
        </form>}
        {actionFailed && <p role="alert" className="mb-5 text-sm text-red-600">{text.operationFailed}</p>}

        {failed && (
          <button
            className="mb-5 rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700"
            onClick={() => void loadCanvases()}
            type="button"
          >
            {text.failed}
          </button>
        )}

        {!loading && visibleCanvases.length === 0 ? (
          <section className="grid min-h-[360px] place-items-center rounded-2xl border border-dashed border-[#dfe3e8] bg-white p-8 text-center">
            <div>
              <BookOpen aria-hidden="true" className="mx-auto text-[#2563eb]" size={34} />
              <h2 className="mt-4 text-lg font-semibold text-[#111827]">{text.empty}</h2>
              <p className="mt-2 text-sm text-[#697386]">{text.emptyHint}</p>
            </div>
          </section>
        ) : (
          <section className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {visibleCanvases.map((canvas) => (
              <article
                className="rounded-2xl border border-[#dfe3e8] bg-white p-4 shadow-sm"
                key={canvas.id}
              >
                <button
                  aria-label={`${text.open}: ${canvas.title}`}
                  className="mb-4 grid aspect-[1/1.414] w-full place-items-center rounded-xl border border-[#e5e7eb] bg-[#fafafa] text-[#2563eb] disabled:opacity-50"
                  disabled={busyId !== null}
                  onClick={() => void openCanvas(canvas.id)}
                  type="button"
                >
                  <BookOpen aria-hidden="true" size={28} />
                </button>

                {editingId === canvas.id ? (
                  <div className="flex gap-2">
                    <input
                      autoFocus
                      className="h-10 min-w-0 flex-1 rounded-lg border border-[#dfe3e8] bg-white px-3 text-sm text-[#111827]"
                      maxLength={120}
                      onChange={(event) => setTitleDraft(event.target.value)}
                      onKeyDown={(event) => {
                        if (event.key === "Enter") void renameCanvas(canvas.id);
                        if (event.key === "Escape") setEditingId(null);
                      }}
                      value={titleDraft}
                    />
                    <button
                      aria-label={text.saveName}
                      className="rounded-lg bg-[#2563eb] px-3 text-sm text-white disabled:opacity-50"
                      disabled={!titleDraft.trim() || busyId !== null}
                      onClick={() => void renameCanvas(canvas.id)}
                      type="button"
                    >
                      ✓
                    </button>
                  </div>
                ) : (
                  <div className="flex items-start justify-between gap-3">
                    <button
                      className="min-w-0 flex-1 text-left"
                      onClick={() => void openCanvas(canvas.id)}
                      type="button"
                    >
                      <h2 className="truncate font-medium text-[#111827]">{canvas.title}</h2>
                      <p className="mt-1 text-xs text-[#697386]">
                        {canvas.elementCount} {text.objects} · {text.modified}{" "}
                        {new Date(canvas.updatedAt).toLocaleString(locale)}
                      </p>
                    </button>
                    <div className="flex shrink-0 gap-1">
                      <button
                        aria-label={text.rename}
                        className="grid size-9 place-items-center rounded-lg text-[#697386] hover:bg-[#eef0f3]"
                        onClick={() => beginRename(canvas)}
                        title={text.rename}
                        type="button"
                      >
                        <Pencil aria-hidden="true" size={16} />
                      </button>
                      <button
                        aria-label={text.remove}
                        className="grid size-9 place-items-center rounded-lg text-red-500 hover:bg-red-50"
                        onClick={() => void deleteCanvas(canvas.id)}
                        title={text.remove}
                        type="button"
                      >
                        <Trash2 aria-hidden="true" size={16} />
                      </button>
                    </div>
                  </div>
                )}
                <label className="mt-4 flex items-center gap-2 border-t border-[#e5e7eb] pt-3 text-sm text-[#697386]">
                  <Folder size={16} aria-hidden="true" />
                  <select aria-label={`${text.move}: ${canvas.title}`} value={canvas.groupId ?? ""}
                    disabled={busyId !== null || groupBusy}
                    className="min-w-0 flex-1 rounded-lg bg-white p-2 text-[#334155] disabled:opacity-50"
                    onChange={(event) => void moveCanvas(canvas.id, event.target.value || null)}>
                    <option value="">{text.ungrouped}</option>
                    {groups.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}
                  </select>
                </label>
              </article>
            ))}
          </section>
        )}
      </div>
    </main>
    {settingsOpen && (
      <div
        className="fixed inset-0 z-50 grid place-items-center bg-[#111827]/35 p-5 backdrop-blur-[2px]"
        onPointerDown={(event) => {
          if (event.target === event.currentTarget) setSettingsOpen(false);
        }}
      >
        <div
          aria-labelledby="settings-title"
          aria-modal="true"
          className="flex max-h-[calc(100dvh-40px)] w-full max-w-[420px] flex-col overflow-hidden rounded-2xl border border-[#dfe3e8] bg-white shadow-2xl"
          role="dialog"
        >
          <div className="flex h-14 items-center justify-between border-b border-[#dfe3e8] px-5">
            <h2 className="text-base font-semibold text-[#111827]" id="settings-title">
              {text.settings}
            </h2>
            <button
              aria-label={text.closeSettings}
              className="grid size-9 place-items-center rounded-lg text-[#697386] hover:bg-[#eef0f3]"
              onClick={() => setSettingsOpen(false)}
              type="button"
            >
              <X aria-hidden="true" size={18} strokeWidth={2} />
            </button>
          </div>

          <div className="min-h-0 overflow-y-auto p-5">
            <div className="text-sm font-medium text-[#334155]">{text.theme}</div>
            <div className="mt-3 grid grid-cols-2 gap-3">
              <button
                aria-pressed={appTheme === "light"}
                className={`flex h-12 items-center gap-3 rounded-xl border px-3 text-sm transition-colors ${
                  appTheme === "light"
                    ? "border-[#2563eb] bg-[#eff6ff] text-[#2563eb]"
                    : "border-[#dfe3e8] text-[#334155] hover:bg-[#f8fafc]"
                }`}
                onClick={() => onThemeChange("light")}
                type="button"
              >
                <Sun aria-hidden="true" size={18} strokeWidth={2} />
                {text.light}
              </button>
              <button
                aria-pressed={appTheme === "dark"}
                className={`flex h-12 items-center gap-3 rounded-xl border px-3 text-sm transition-colors ${
                  appTheme === "dark"
                    ? "border-[#2563eb] bg-[#eff6ff] text-[#2563eb]"
                    : "border-[#dfe3e8] text-[#334155] hover:bg-[#f8fafc]"
                }`}
                onClick={() => onThemeChange("dark")}
                type="button"
              >
                <Moon aria-hidden="true" size={18} strokeWidth={2} />
                {text.dark}
              </button>
            </div>

            <div className="my-5 h-px bg-[#e5e7eb]" />
            <div className="flex items-center gap-2 text-sm font-medium text-[#334155]">
              <Languages aria-hidden="true" size={17} strokeWidth={2} />
              {text.language}
            </div>
            <div className="mt-3 grid grid-cols-3 gap-2">
              {(
                [
                  ["ru", "Русский"],
                  ["en", "English"],
                  ["zh", "中文"],
                ] as const
              ).map(([id, label]) => (
                <button
                  aria-pressed={language === id}
                  className={`h-11 rounded-xl border px-2 text-sm transition-colors ${
                    language === id
                      ? "border-[#2563eb] bg-[#eff6ff] text-[#2563eb]"
                      : "border-[#dfe3e8] text-[#334155] hover:bg-[#f8fafc]"
                  }`}
                  key={id}
                  onClick={() => onLanguageChange(id)}
                  type="button"
                >
                  {label}
                </button>
              ))}
            </div>

            <div className="my-5 h-px bg-[#e5e7eb]" />
            <button
              className="flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-red-200 text-sm font-medium text-red-600 hover:bg-red-50"
              onClick={onLogout}
              type="button"
            >
              <LogOut aria-hidden="true" size={18} strokeWidth={2} />
              {text.logout}
            </button>
          </div>
        </div>
      </div>
    )}
    </>
  );
}
