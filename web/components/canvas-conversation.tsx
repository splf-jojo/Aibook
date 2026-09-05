"use client";
import { useLayoutEffect, useRef, useState } from "react";
import { Copy } from "lucide-react";
import { CanvasPet, type CanvasPetMood } from "./canvas-pet";
import styles from "./canvas-companion.module.css";

type Message = { id: string; role: "user" | "assistant"; content: string; image_data_url?: string | null };
type Labels = { petName: string; petGreeting: string; emptyChat: string; selectedArea: string; copyResponse: string; processing: string };
export function CanvasConversation({ messages, chatId, pending, mood, labels }: {
  messages: Message[]; chatId: string | null; pending: boolean; mood: CanvasPetMood; labels: Labels;
}) {
  const scrollRef = useRef<HTMLDivElement>(null), frameRef = useRef<HTMLDivElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null), petRef = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true), previousChat = useRef(chatId);
  const [tail, setTail] = useState({ path: "", messageId: "" });
  const hasCompanion = pending || messages.some(message => message.role === "assistant");

  useLayoutEffect(() => {
    const scroll = scrollRef.current, frame = frameRef.current;
    if (!scroll || !frame) return;
    if (chatId !== previousChat.current || followBottom.current) scroll.scrollTop = scroll.scrollHeight;
    if (chatId !== previousChat.current) followBottom.current = true;
    previousChat.current = chatId;
    let request = 0;
    const setConnector = (path = "", messageId = "") => setTail(current => current.path === path && current.messageId === messageId ? current : { path, messageId });
    const update = () => {
      const pet = petRef.current;
      if (!pet) { setConnector(); return; }
      const view = scroll.getBoundingClientRect();
      const bubbles = [...(messagesRef.current?.querySelectorAll<HTMLElement>("[data-companion-bubble]") ?? [])];
      // Associate the pet with the bottom-most readable reply in the viewport.
      let visible: { bubble: HTMLElement; bounds: DOMRect } | undefined;
      for (const bubble of bubbles.reverse()) {
        const bounds = bubble.getBoundingClientRect();
        if (Math.min(bounds.bottom - 6, view.bottom - 2) > Math.max(bounds.top + 6, view.top + 2)) {
          visible = { bubble, bounds }; break;
        }
      }
      if (!visible) { setConnector(); return; }
      const { bubble, bounds } = visible;
      const origin = frame.getBoundingClientRect(), avatar = pet.getBoundingClientRect();
      const top = Math.max(bounds.top + 6, view.top + 2), bottom = Math.min(bounds.bottom - 6, view.bottom - 2);
      const petY = avatar.top + avatar.height * 0.55;
      const half = Math.min(6, (bottom - top) / 2);
      const y = Math.max(top + half, Math.min(bottom - half, petY)) - origin.top;
      const x = bounds.left - origin.left + 1;
      const tipX = avatar.right - origin.left - 4, tipY = petY - origin.top;
      setConnector(`M ${x} ${y - half} Q ${tipX + 8} ${y} ${tipX} ${tipY} Q ${tipX + 5} ${y + half} ${x} ${y + half} Z`, bubble.dataset.companionBubble);
    };
    const schedule = () => { cancelAnimationFrame(request); request = requestAnimationFrame(update); };
    const onScroll = () => { followBottom.current = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 40; schedule(); };
    const observer = new ResizeObserver(schedule);
    observer.observe(frame); if (messagesRef.current) observer.observe(messagesRef.current);
    scroll.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => { cancelAnimationFrame(request); observer.disconnect(); scroll.removeEventListener("scroll", onScroll); };
  }, [messages, chatId, pending, hasCompanion]);

  return <div className={styles.conversationFrame} ref={frameRef}>
    <div className={styles.conversation} ref={scrollRef}>
      {!messages.length && !pending && <div className={styles.welcome}>
        <div className={styles.bubble}><h2>{labels.petGreeting}</h2><p>{labels.emptyChat}</p></div>
        <div className={styles.welcomePet}><CanvasPet /></div>
      </div>}
      <div className={styles.messages} ref={messagesRef}>
        {messages.map(message => message.role === "user" ? <div className={styles.userMessage} key={message.id}>
          {message.image_data_url && <img alt={labels.selectedArea} src={message.image_data_url} />}
          <p>{message.content}</p>
        </div> : <article aria-label={labels.petName} className={styles.reply} key={message.id}>
          <div className={styles.bubble} data-companion-bubble={message.id} data-companion-message={tail.messageId === message.id || undefined}>
            <div className={styles.responseText}>{message.content}</div>
            {message.content && <div className={styles.replyActions}>
              <button aria-label={labels.copyResponse} onClick={() => void navigator.clipboard.writeText(message.content).catch(() => {})} className={styles.iconButton} title={labels.copyResponse} type="button"><Copy aria-hidden="true" size={13} strokeWidth={1.7} /></button>
            </div>}
          </div>
        </article>)}
        {pending && <div aria-label={labels.processing} role="status" className={`${styles.reply} ${styles.pending}`}>
          <div className={styles.bubble} data-companion-bubble="pending" data-companion-message={tail.messageId === "pending" || undefined}><div aria-hidden="true" className={styles.typing}><span /><span /><span /></div></div>
        </div>}
      </div>
    </div>
    {hasCompanion && <>
      <svg aria-hidden="true" className={styles.connector}><path d={tail.path} /></svg>
      <div className={styles.fixedAvatar} ref={petRef}><CanvasPet mood={pending ? "thinking" : mood} /></div>
    </>}
  </div>;
}
