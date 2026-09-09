"use client";

import { ArrowUpRight, ChevronRight, MoreHorizontal, Plus, Settings, X } from "lucide-react";
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { CanvasPreview } from "./canvas-preview";
import styles from "./canvas-library.module.css";

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
    create: "Новый канвас", notes: "Заметки", actions: "Действия", retry: "Повторить",
    previewUnavailable: "Превью недоступно", loading: "Загрузка…", handwriting: "Почерк",
    noteCount: "Заметок:", group: "Группа", save: "Сохранить", name: "Название",
    untitled: "Новый канвас",
    open: "Открыть",
    rename: "Переименовать",
    saveName: "Сохранить название",
    cancel: "Отмена",
    remove: "Удалить",
    confirmDelete: "Удалить этот канвас? Это действие нельзя отменить.",
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
    create: "New canvas", notes: "Notes", actions: "Actions", retry: "Retry",
    previewUnavailable: "Preview unavailable", loading: "Loading…", handwriting: "Handwriting",
    noteCount: "Notes:", group: "Group", save: "Save", name: "Name",
    untitled: "New canvas",
    open: "Open",
    rename: "Rename",
    saveName: "Save name",
    cancel: "Cancel",
    remove: "Delete",
    confirmDelete: "Delete this canvas? This action cannot be undone.",
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
    create: "新画布", notes: "笔记", actions: "操作", retry: "重试",
    previewUnavailable: "预览不可用", loading: "加载中…", handwriting: "笔迹",
    noteCount: "笔记：", group: "分组", save: "保存", name: "名称",
    untitled: "新画布",
    open: "打开",
    rename: "重命名",
    saveName: "保存名称",
    cancel: "取消",
    remove: "删除",
    confirmDelete: "删除此画布？此操作无法撤销。",
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
  const [pendingDelete, setPendingDelete] = useState<{ kind: "canvas" | "group"; id: string; title: string } | null>(null);
  const [movingId, setMovingId] = useState<string | null>(null);
  const groupColors = useMemo(() => new Map([...groups]
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id))
    .map((group, index) => [group.id, groupColor(index)])), [groups]);
  const text = COPY[language];
  const visibleCanvases = canvases.filter(canvas => groupFilter === "all" ? !canvas.groupId : canvas.groupId === groupFilter);
  const selectedGroup = groups.find((group) => group.id === groupFilter);
  const busy = creating || groupBusy || busyId !== null;

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
      setGroupFilter((current) => nextGroups.some((group) => group.id === current) ? current : "all");
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
    if (busy) return;
    setCreating(true);
    setActionFailed(false);
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
      setActionFailed(true);
    } finally {
      setCreating(false);
    }
  };

  const openCanvas = async (id: string) => {
    if (busy) return;
    setBusyId(id);
    setActionFailed(false);
    try {
      const response = await fetch(`${API_URL}/api/canvases/${id}`, {
        headers: apiHeaders(token),
      });
      if (handleAuthFailure(response)) return;
      if (!response.ok) throw new Error("canvas-open-failed");
      onOpen((await response.json()) as CanvasRecord);
    } catch {
      setActionFailed(true);
    } finally {
      setBusyId(null);
    }
  };

  const beginRename = (canvas: CanvasSummary) => {
    setEditingId(canvas.id);
    setTitleDraft(canvas.title);
    setActionFailed(false);
  };

  const renameCanvas = async (id: string) => {
    const title = titleDraft.trim();
    if (!title || busy) return;
    setBusyId(id);
    setActionFailed(false);
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
      setActionFailed(true);
    } finally {
      setBusyId(null);
    }
  };

  const deleteCanvas = async (id: string) => {
    if (busy) return;
    setBusyId(id);
    setActionFailed(false);
    try {
      const response = await fetch(`${API_URL}/api/canvases/${id}`, {
        method: "DELETE",
        headers: apiHeaders(token),
      });
      if (handleAuthFailure(response)) return;
      if (!response.ok) throw new Error("canvas-delete-failed");
      setCanvases((current) => current.filter((canvas) => canvas.id !== id));
      setPendingDelete(null);
    } catch {
      setActionFailed(true);
    } finally {
      setBusyId(null);
    }
  };

  const saveGroup = async () => {
    const name = groupName.trim();
    if (!name || busy || !groupEditor) return;
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
    if (busy) return;
    setGroupBusy(true);
    setActionFailed(false);
    try {
      const response = await fetch(`${API_URL}/api/note-groups/${group.id}`, { method: "DELETE", headers: apiHeaders(token) });
      if (handleAuthFailure(response)) return;
      if (!response.ok) throw new Error("group-delete-failed");
      setGroups((current) => current.filter((item) => item.id !== group.id));
      setCanvases((current) => current.map((canvas) => canvas.groupId === group.id ? { ...canvas, groupId: null } : canvas));
      setGroupFilter("all");
      setPendingDelete(null);
    } catch { setActionFailed(true); }
    finally { setGroupBusy(false); }
  };

  const moveCanvas = async (id: string, groupId: string | null) => {
    if (busy) return;
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
      setMovingId(null);
    } catch { setActionFailed(true); }
    finally { setBusyId(null); }
  };

  const locale = language === "zh" ? "zh-CN" : language === "en" ? "en-US" : "ru-RU";
  const preview = (canvas?: CanvasSummary) => <CanvasPreview key={canvas?.id ?? "empty"} id={canvas?.id}
    updatedAt={canvas?.updatedAt} token={token} unavailable={text.previewUnavailable}
    loadingLabel={text.loading} onAuthFailure={onLogout} />;
  const editGroup = (group: NoteGroup | "new") => {
    setGroupName(group === "new" ? "" : group.name); setGroupEditor(group); setActionFailed(false);
  };
  const askDelete = (kind: "canvas" | "group", id: string, title: string) => {
    setPendingDelete({ kind, id, title }); setActionFailed(false);
  };
  const actionError = actionFailed ? <p className={styles.error} role="alert">{text.operationFailed}</p> : null;
  const dialogOpen = editingId || groupEditor || pendingDelete || movingId;
  const groupMenu = (group: NoteGroup) => <CardActions label={`${text.actions}: ${group.name}`} disabled={busy}>
    <button type="button" onClick={() => editGroup(group)}>{text.rename}</button>
    <button type="button" className={styles.destructive} onClick={() => askDelete("group", group.id, group.name)}>{text.deleteGroup}</button>
  </CardActions>;

  return <main className={styles.library} data-theme={appTheme}>
    <div className={styles.container}>
      <header className={styles.header}>
        <h1><button type="button" className={styles.wordmark} onClick={() => setGroupFilter("all")}>AIbook<span>.</span></button></h1>
        <button type="button" className={styles.iconButton} aria-label={text.settings} title={text.settings}
          onClick={() => setSettingsOpen(true)}><Settings size={20} strokeWidth={1.6} aria-hidden="true" /></button>
      </header>
      <div className={styles.toolbar}>
        <nav className={styles.breadcrumb} aria-label={text.notes}>
          <button type="button" onClick={() => setGroupFilter("all")} aria-current={!selectedGroup ? "page" : undefined}>{text.notes}</button>
          {selectedGroup && <><ChevronRight size={14} aria-hidden="true" /><span className={styles.currentGroup} aria-current="page">{selectedGroup.name}</span></>}
        </nav>
        {selectedGroup ? groupMenu(selectedGroup) : <button type="button" className={styles.quietButton} disabled={busy || loading || failed}
          onClick={() => editGroup("new")}><Plus size={16} aria-hidden="true" />{text.newGroup}</button>}
      </div>

      {!dialogOpen && actionError}
      {failed && <div className={styles.error} role="alert">{text.failed}<button type="button" onClick={() => void loadCanvases()}>{text.retry}</button></div>}
      <section className={styles.grid} aria-label={selectedGroup?.name ?? text.notes} aria-busy={loading}>
        <article className={styles.card}>
          <button type="button" className={styles.createCard} onClick={() => void createCanvas()}
            disabled={busy || loading || failed} aria-label={text.create} aria-busy={creating}>
            <span className={`${styles.paper} ${styles.createPaper}`}><Plus size={30} strokeWidth={1.3} aria-hidden="true" /></span>
            <span className={`${styles.cardTitle} ${styles.createTitle}`}>{creating ? text.loading : text.create}</span>
          </button>
        </article>
        {loading ? Array.from({ length: 4 }, (_, index) => <div key={index} className={styles.skeleton} aria-hidden="true" />) : <>
          {groupFilter === "all" && groups.map(group => {
            const notes = canvases.filter(canvas => canvas.groupId === group.id);
            return <article key={group.id} className={styles.card} style={{ "--cover": groupColors.get(group.id) } as CSSProperties}>
              <button type="button" className={`${styles.paper} ${styles.groupPaper}`} aria-label={`${text.open}: ${group.name} (${text.group})`}
                onClick={() => setGroupFilter(group.id)}>
                {preview(notes[0])}
              </button>
              <div className={styles.cardCaption}>
                <div className={styles.cardInfo}>
                  <button type="button" className={styles.cardTitle} onClick={() => setGroupFilter(group.id)} title={group.name}>{group.name}</button>
                  <p className={styles.metadata}>{text.noteCount} {notes.length}</p>
                </div>
                {groupMenu(group)}
              </div>
            </article>;
          })}
          {visibleCanvases.map(canvas => <article key={canvas.id} className={styles.card}>
            <button type="button" className={styles.paper} aria-label={`${text.open}: ${canvas.title}`}
              disabled={busy} onClick={() => void openCanvas(canvas.id)}>{preview(canvas)}</button>
            <div className={styles.cardCaption}>
              <div className={styles.cardInfo}>
                <button type="button" className={styles.cardTitle} disabled={busy} onClick={() => void openCanvas(canvas.id)} title={canvas.title}>{canvas.title}</button>
                <p className={styles.metadata}><time dateTime={canvas.updatedAt}>{new Date(canvas.updatedAt).toLocaleDateString(locale, { day: "numeric", month: "short", year: "numeric" })}</time></p>
              </div>
              <CardActions label={`${text.actions}: ${canvas.title}`} disabled={busy}>
                <button type="button" onClick={() => beginRename(canvas)}>{text.rename}</button>
                <button type="button" onClick={() => { setMovingId(canvas.id); setActionFailed(false); }}>{text.move}</button>
                <button type="button" className={styles.destructive} onClick={() => askDelete("canvas", canvas.id, canvas.title)}>{text.remove}</button>
              </CardActions>
            </div>
          </article>)}
        </>}
      </section>
    </div>

    {settingsOpen && <LibraryDialog title={text.settings} closeLabel={text.closeSettings} onClose={() => setSettingsOpen(false)}>
      <fieldset className={styles.setting}><legend>{text.theme}</legend><div className={styles.segmented}>
        {([ ["light", text.light], ["dark", text.dark] ] as const).map(([theme, label]) => <button type="button" key={theme}
          aria-pressed={appTheme === theme} onClick={() => onThemeChange(theme)}>{label}</button>)}
      </div></fieldset>
      <fieldset className={styles.setting}><legend>{text.language}</legend><div className={styles.segmented}>
        {([ ["ru", "Русский"], ["en", "English"], ["zh", "中文"] ] as const).map(([id, label]) => <button type="button" key={id}
          aria-pressed={language === id} onClick={() => onLanguageChange(id)}>{label}</button>)}
      </div></fieldset>
      <a className={styles.settingsLink} href="/handwriting">{text.handwriting}<ArrowUpRight size={17} aria-hidden="true" /></a>
      <button type="button" className={styles.logout} onClick={onLogout}>{text.logout}</button>
    </LibraryDialog>}

    {(editingId || groupEditor) && <LibraryDialog title={groupEditor === "new" ? text.newGroup : text.rename}
      closeLabel={text.cancel} busy={busy} onClose={() => { setEditingId(null); setGroupEditor(null); setActionFailed(false); }}>
      <form onSubmit={event => { event.preventDefault(); if (groupEditor) void saveGroup(); else if (editingId) void renameCanvas(editingId); }}>
        <label className={styles.field}>{groupEditor ? text.groupName : text.name}
          <input maxLength={120} required disabled={busy} value={groupEditor ? groupName : titleDraft}
            onChange={event => groupEditor ? setGroupName(event.target.value) : setTitleDraft(event.target.value)} />
        </label>
        {actionError}
        <div className={styles.dialogActions}>
          <button type="button" className={styles.quietButton} disabled={busy} onClick={() => { setEditingId(null); setGroupEditor(null); setActionFailed(false); }}>{text.cancel}</button>
          <button type="submit" className={styles.primaryButton} disabled={busy || !(groupEditor ? groupName : titleDraft).trim()}>{text.save}</button>
        </div>
      </form>
    </LibraryDialog>}

    {movingId && <LibraryDialog title={text.move} closeLabel={text.cancel} busy={busy} onClose={() => { setMovingId(null); setActionFailed(false); }}>
      <div className={styles.moveOptions}>
        {[{ id: "", name: text.ungrouped }, ...groups].map(group => <button type="button" key={group.id} disabled={busy}
          aria-pressed={(canvases.find(canvas => canvas.id === movingId)?.groupId ?? "") === group.id}
          onClick={() => void moveCanvas(movingId, group.id || null)}>
          <span className={styles.colorDot} style={{ background: group.id ? groupColors.get(group.id) : "var(--library-line)" }} />{group.name}
        </button>)}
      </div>{actionError}
    </LibraryDialog>}

    {pendingDelete && <LibraryDialog title={pendingDelete.title} closeLabel={text.cancel} busy={busy} onClose={() => { setPendingDelete(null); setActionFailed(false); }}>
      <p className={styles.confirmText}>{pendingDelete.kind === "group" ? text.confirmDeleteGroup : text.confirmDelete}</p>
      {actionError}
      <div className={styles.dialogActions}>
        <button type="button" className={styles.quietButton} disabled={busy} onClick={() => { setPendingDelete(null); setActionFailed(false); }}>{text.cancel}</button>
        <button type="button" className={styles.deleteButton} disabled={busy} onClick={() => {
          if (pendingDelete.kind === "canvas") void deleteCanvas(pendingDelete.id);
          else { const group = groups.find(group => group.id === pendingDelete.id); if (group) void removeGroup(group); }
        }}>{text.remove}</button>
      </div>
    </LibraryDialog>}
  </main>;
}

// Stable during renames/reordering; deliberately not persisted or sent to the API.
function groupColor(index: number) {
  const palette = ["#a76550", "#788466", "#b79552", "#8a748b", "#5e8b8a", "#b97982", "#8d806b", "#777a9c"];
  return palette[index] ?? `hsl(${(index * 137.508) % 360} 24% 49%)`;
}

function CardActions({ label, children, disabled }: { label: string; children: ReactNode; disabled: boolean }) {
  const ref = useRef<HTMLDetailsElement>(null);
  useEffect(() => {
    const outside = (event: PointerEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) ref.current.open = false;
    };
    document.addEventListener("pointerdown", outside);
    return () => document.removeEventListener("pointerdown", outside);
  }, []);
  return <details ref={ref} className={styles.actions} onBlur={event => {
    if (!event.currentTarget.contains(event.relatedTarget as Node)) event.currentTarget.open = false;
  }} onKeyDown={event => {
    if (event.key === "Escape") { event.currentTarget.open = false; event.currentTarget.querySelector("summary")?.focus(); event.stopPropagation(); }
  }}>
    <summary aria-label={label} title={label} aria-disabled={disabled} onClick={event => { if (disabled) event.preventDefault(); }}>
      <MoreHorizontal size={19} aria-hidden="true" />
    </summary>
    <div className={styles.actionMenu} onClick={event => {
      if ((event.target as HTMLElement).closest("button") && ref.current) {
        ref.current.open = false;
        ref.current.querySelector("summary")?.focus();
      }
    }}>{children}</div>
  </details>;
}

function LibraryDialog({ title, closeLabel, children, onClose, busy = false }: {
  title: string; closeLabel: string; children: ReactNode; onClose: () => void; busy?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const dialog = ref.current;
    const previousFocus = document.activeElement as HTMLElement | null;
    dialog?.showModal();
    const input = dialog?.querySelector("input");
    input?.focus();
    input?.select();
    return () => {
      dialog?.close();
      if (previousFocus?.isConnected) previousFocus.focus();
      else document.querySelector<HTMLButtonElement>("main nav button")?.focus();
    };
  }, []);
  return <dialog ref={ref} className={styles.dialog} aria-label={title} onCancel={event => { event.preventDefault(); if (!busy) onClose(); }}
    onClick={event => { if (event.target === event.currentTarget && !busy) {
      const bounds = event.currentTarget.getBoundingClientRect();
      if (event.clientX < bounds.left || event.clientX > bounds.right || event.clientY < bounds.top || event.clientY > bounds.bottom) onClose();
    } }}>
    <div className={styles.dialogHeader}><h2>{title}</h2><button type="button" className={styles.iconButton} aria-label={closeLabel}
      disabled={busy} onClick={onClose}><X size={19} aria-hidden="true" /></button></div>
    <div className={styles.dialogBody}>{children}</div>
  </dialog>;
}
