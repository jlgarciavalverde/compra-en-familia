import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import type { RealtimeMessage } from "@compra/shared";
import { API_URL, tokenStore } from "./api";
import { outbox } from "./outbox";
import { presence } from "./presence";

function wsUrl() {
  const base = API_URL || window.location.origin;
  return `${base.replace(/^http/, "ws")}/ws`;
}

/** Mantiene un WebSocket abierto y refresca los datos cuando otro dispositivo cambia algo. */
export function useRealtime(enabled: boolean) {
  const qc = useQueryClient();

  useEffect(() => {
    if (!enabled) return;
    let ws: WebSocket | null = null;
    let retry = 0;
    let timer: ReturnType<typeof setTimeout> | undefined;
    let stopped = false;

    const connect = () => {
      const token = tokenStore.get();
      if (!token || stopped) return;
      ws = new WebSocket(wsUrl());
      ws.onopen = () => {
        ws?.send(JSON.stringify({ type: "auth", token }));
        const socket = ws;
        presence.setSender((m) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(m)); });
      };
      ws.onmessage = (ev) => {
        const msg = JSON.parse(ev.data) as RealtimeMessage;
        if (msg.type === "ready") {
          retry = 0;
          void outbox.flush();
          presence.resend();
          // Por si se perdió algo mientras estábamos desconectados.
          qc.invalidateQueries({ queryKey: ["lists"] });
          qc.invalidateQueries({ queryKey: ["list"] });
        } else if (msg.type === "presence") {
          presence.set(msg.shopping);
        } else if (msg.type === "changed") {
          qc.invalidateQueries({ queryKey: ["lists"] });
          qc.invalidateQueries({ queryKey: msg.listId ? ["list", msg.listId] : ["list"] });
          if (!msg.listId) {
            qc.invalidateQueries({ queryKey: ["me"] });
            qc.invalidateQueries({ queryKey: ["stores"] });
          }
          qc.invalidateQueries({ queryKey: ["history"] });
          qc.invalidateQueries({ queryKey: ["prices"] });
          qc.invalidateQueries({ queryKey: ["suggestions"] });
        }
      };
      ws.onclose = (ev) => {
        presence.setSender(null);
        presence.set([]);
        if (stopped || ev.code === 4401) return;
        timer = setTimeout(connect, Math.min(30_000, 1000 * 2 ** retry++));
      };
    };

    connect();
    const onOnline = () => { if (ws?.readyState !== WebSocket.OPEN) { clearTimeout(timer); connect(); } };
    window.addEventListener("online", onOnline);
    return () => {
      stopped = true;
      clearTimeout(timer);
      window.removeEventListener("online", onOnline);
      ws?.close();
    };
  }, [enabled, qc]);
}
