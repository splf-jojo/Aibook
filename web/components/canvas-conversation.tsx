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
  const bubbleRef = useRef<HTMLDivElement>(null), petRef = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true), previousChat = useRef(chatId);
  const [tail, setTail] = useState("");
  const latest = messages.findLast(message => message.role === "assistant")?.id;
  const hasCompanion = Boolean(latest || pending);

  useLayoutEffect(() => {
    const scroll = scrollRef.current, frame = frameRef.current;
    if (!scroll || !frame) return;
    if (chatId !== previousChat.current || followBottom.current) scroll.scrollTop = scroll.scrollHeight;
    if (chatId !== previousChat.current) followBottom.current = true;
    previousChat.current = chatId;
    let request = 0;
    const update = () => {
      const bubble = bubbleRef.current, pet = petRef.current;
      if (!bubble || !pet) { setTail(""); return; }
      const view = scroll.getBoundingClientRect(), bounds = bubble.getBoundingClientRect();
      const origin = frame.getBoundingClientRect(), avatar = pet.getBoundingClientRect();
      const top = Math.max(bounds.top + 10, view.top + 8), bottom = Math.min(bounds.bottom - 10, view.bottom - 8);
      if (bottom <= top) { setTail(""); return; }
      const petY = avatar.top + avatar.height * 0.55;
      const y = Math.max(top, Math.min(bottom, petY)) - origin.top;
      const x = bounds.left - origin.left + 1;
      const tipX = avatar.right - origin.left - 4, tipY = petY - origin.top;
      setTail(`M ${x} ${y - 6} Q ${tipX + 8} ${y} ${tipX} ${tipY} Q ${tipX + 5} ${y + 6} ${x} ${y + 6} Z`);
    };
    const schedule = () => { cancelAnimationFrame(request); request = requestAnimationFrame(update); };
    const onScroll = () => { followBottom.current = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 40; schedule(); };
    const observer = new ResizeObserver(schedule);
    observer.observe(frame); if (bubbleRef.current) observer.observe(bubbleRef.current);
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
      <div className={styles.messages}>
        {messages.map(message => message.role === "user" ? <div className={styles.userMessage} key={message.id}>
          {message.image_data_url && <img alt={labels.selectedArea} src={message.image_data_url} />}
          <p>{message.content}</p>
        </div> : <article aria-label={labels.petName} className={styles.reply} key={message.id}>
          <div className={styles.bubble} ref={!pending && message.id === latest ? bubbleRef : undefined} data-companion-message={!pending && message.id === latest || undefined}>
            <div className={styles.responseText}>{message.content}</div>
            {message.content && <div className={styles.replyActions}>
              <button aria-label={labels.copyResponse} onClick={() => void navigator.clipboard.writeText(message.content).catch(() => {})} className={styles.iconButton} title={labels.copyResponse} type="button"><Copy aria-hidden="true" size={13} strokeWidth={1.7} /></button>
            </div>}
          </div>
        </article>)}
        {pending && <div aria-label={labels.processing} role="status" className={`${styles.reply} ${styles.pending}`}>
          <div className={styles.bubble} ref={bubbleRef} data-companion-message><div aria-hidden="true" className={styles.typing}><span /><span /><span /></div></div>
        </div>}
      </div>
    </div>
    {hasCompanion && <>
      <svg aria-hidden="true" className={styles.connector}><path d={tail} /></svg>
      <div className={styles.fixedAvatar} ref={petRef}><CanvasPet mood={pending ? "thinking" : mood} /></div>
    </>}
  </div>;
}
