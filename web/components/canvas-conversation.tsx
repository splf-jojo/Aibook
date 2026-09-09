"use client";
import { useLayoutEffect, useRef } from "react";
import { Copy } from "lucide-react";
import { CanvasPet } from "./canvas-pet";
import type { CompanionMode } from "@/lib/canvas-companion";
import { parseSolutionMessage } from "@/lib/canvas-solution-link";
import styles from "./canvas-companion.module.css";

type Message = { id: string; role: "user" | "assistant"; content: string; image_data_url?: string | null };
type Labels = { ai: string; petGreeting: string; emptyChat: string; selectedArea: string; copyResponse: string; processing: string };

export function CanvasConversation({ messages, chatId, pending, companionMode, labels, onSolutionClick, canFocusSolution }: {
  messages: Message[]; chatId: string | null; pending: boolean; companionMode: CompanionMode; labels: Labels;
  onSolutionClick: (canvasId: string, solutionId: string) => void;
  canFocusSolution: (canvasId: string, solutionId: string) => boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null), messagesRef = useRef<HTMLDivElement>(null);
  const followBottom = useRef(true), previousChat = useRef(chatId);

  useLayoutEffect(() => {
    const scroll = scrollRef.current;
    if (!scroll) return;
    if (chatId !== previousChat.current) followBottom.current = true;
    previousChat.current = chatId;
    const follow = () => { if (followBottom.current) scroll.scrollTop = scroll.scrollHeight; };
    const onScroll = () => { followBottom.current = scroll.scrollHeight - scroll.scrollTop - scroll.clientHeight < 40; };
    follow();
    const observer = new ResizeObserver(follow);
    observer.observe(scroll);
    if (messagesRef.current) observer.observe(messagesRef.current);
    scroll.addEventListener("scroll", onScroll, { passive: true });
    return () => { observer.disconnect(); scroll.removeEventListener("scroll", onScroll); };
  }, [messages, chatId, pending]);

  return <div className={styles.conversationFrame}>
    <div className={styles.conversation} ref={scrollRef}>
      {!messages.length && !pending && <div className={styles.welcome}>
        <h2>{labels.petGreeting}</h2><p>{labels.emptyChat}</p>
        {companionMode !== "off" && <div className={styles.welcomePet}><CanvasPet variant={companionMode} /></div>}
      </div>}
      <div className={styles.messages} ref={messagesRef}>
        {messages.map(message => {
          if (message.role === "user") return <div className={styles.userMessage} data-message-role="user" key={message.id}>
            {message.image_data_url && <img alt={labels.selectedArea} src={message.image_data_url} />}
            <p>{message.content}</p>
          </div>;
          const link = parseSolutionMessage(message.content);
          const plainText = link ? link.before + link.label + link.after : message.content;
          return <article aria-label={labels.ai} className={styles.reply} data-message-role="assistant" key={message.id}>
            <div className={styles.responseText}>{link ? <>{link.before}<button className={styles.solutionLink} type="button"
              disabled={!canFocusSolution(link.canvasId, link.solutionId)} onClick={() => onSolutionClick(link.canvasId, link.solutionId)}>{link.label}</button>{link.after}</> : message.content}</div>
            {message.content && <div className={styles.replyActions}>
              <button aria-label={labels.copyResponse} onClick={() => void navigator.clipboard.writeText(plainText).catch(() => {})}
                className={styles.iconButton} title={labels.copyResponse} type="button"><Copy aria-hidden="true" size={13} strokeWidth={1.7} /></button>
            </div>}
          </article>;
        })}
        {pending && <div aria-label={labels.processing} role="status" className={`${styles.reply} ${styles.pending}`}>
          <div aria-hidden="true" className={styles.typing}><span /><span /><span /></div>
        </div>}
      </div>
    </div>
  </div>;
}
