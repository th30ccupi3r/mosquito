import React, { useEffect, useMemo, useRef, useState } from "react";

type Props = {
  xml: string;
  /**
   * When false, the iframe becomes non-interactive (no pointer/scroll, no focus)
   * to prevent draw.io shortcuts from stealing keyboard input while editing YAML.
   */
  interactive: boolean;
  onRequestInteractive?: () => void;
};

function safeParseMsg(data: any): any | null {
  if (data == null) return null;
  if (typeof data === "object") return data;
  if (typeof data === "string") {
    // diagrams.net sometimes sends JSON strings
    try {
      return JSON.parse(data);
    } catch {
      return null;
    }
  }
  return null;
}

export default function DrawioPreview({ xml, interactive, onRequestInteractive }: Props) {
  const iframeRef = useRef<HTMLIFrameElement | null>(null);
  const readyRef = useRef(false);
  const [status, setStatus] = useState<string>("Loading diagrams.net preview…");

  // IMPORTANT: use proto=json (not protocol=json) to match embed docs
  const src = useMemo(() => {
    const u = new URL("https://embed.diagrams.net/");
    u.searchParams.set("embed", "1");
    u.searchParams.set("proto", "json");  // ✅ JSON protocol
    u.searchParams.set("spin", "1");      // spinner while waiting for load
    // Ask for configuration so we can hide UI chrome.
    u.searchParams.set("configure", "1");
    // Dark mode UI so the preview matches the app theme.
    // See supported URL parameters: ui=dark and dark=1
    u.searchParams.set("ui", "dark");
    u.searchParams.set("dark", "1");
    u.searchParams.set("libraries", "0");
    u.searchParams.set("noSaveBtn", "1");
    u.searchParams.set("noExitBtn", "1");
    u.searchParams.set("saveAndExit", "0");
    // Best-effort: hide toolbar in chromeless contexts (harmless if ignored)
    u.searchParams.set("toolbar", "0");
    return u.toString();
  }, []);

  // Send current XML to iframe
  const postLoad = (xmlToLoad: string) => {
    const w = iframeRef.current?.contentWindow;
    if (!w) return;

    // Must be JSON string when proto=json is used
    w.postMessage(
      JSON.stringify({
        action: "load",
        xml: xmlToLoad,
        autosave: 0,
        // optional: keep UI "unmodified"
        modified: 0,
      }),
      "*"
    );
  };

  useEffect(() => {
    const onMessage = (evt: MessageEvent) => {
      // Only trust messages from diagrams.net
      if (evt.origin !== "https://embed.diagrams.net") return;

      const msg = safeParseMsg(evt.data);
      if (!msg) return;

      // In JSON protocol, diagrams.net sends {event:'init'} when ready
      if (msg.event === "configure") {
        // Hide most diagrams.net UI (we only need pan/zoom).
        // This is best-effort and may evolve with diagrams.net DOM changes.
        const css = `
          /* Toolbar / menubar */
          .geToolbarContainer, .geMenubarContainer, .geSprite, .geDropDownButton { display:none !important; }
          /* Sidebars (shapes, format, layers) */
          .geSidebarContainer, .geFormatContainer, .geSidebar, .geRightContainer { display:none !important; }
          /* Status bar */
          .geStatusContainer, .geFooterContainer { display:none !important; }
          /* Keep canvas full size */
          .geDiagramContainer { left:0 !important; top:0 !important; right:0 !important; bottom:0 !important; }
        `;
        iframeRef.current?.contentWindow?.postMessage(
          JSON.stringify({ action: "configure", config: { css } }),
          "*"
        );
        return;
      }

      if (msg.event === "init") {
        readyRef.current = true;
        setStatus("Loading diagram…");
        postLoad(xml);
        return;
      }

      // After load, diagrams.net sends {event:'load', ...}
      if (msg.event === "load") {
        setStatus("Ready");
        return;
      }

      // Useful for debugging
      if (msg.event === "error") {
        setStatus(`diagrams.net error: ${msg.message ?? "unknown"}`);
        return;
      }
    };

    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-load whenever XML changes (after init)
  useEffect(() => {
    if (!readyRef.current) return;
    setStatus("Updating diagram…");
    postLoad(xml);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [xml]);

  return (
    <div style={{ width: "100%", height: "100%", position: "relative" }}>
      <iframe
        ref={iframeRef}
        title="diagrams.net preview"
        src={src}
        tabIndex={-1}
        style={{
          width: "100%",
          height: "100%",
          border: 0,
          // Critical: when not interactive, prevent the iframe from stealing
          // wheel + focus + keyboard shortcuts.
          pointerEvents: interactive ? "auto" : "none",
        }}
        sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
      />

      {/* Interaction gate overlay */}
      {!interactive && (
        <button
          type="button"
          onClick={() => onRequestInteractive?.()}
          style={{
            position: "absolute",
            inset: 0,
            border: 0,
            padding: 0,
            margin: 0,
            background: "transparent",
            cursor: "pointer",
          }}
          aria-label="Activate diagram interaction"
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "system-ui, sans-serif",
              fontSize: 13,
              color: "#e5e7eb",
              background: "rgba(0,0,0,0.08)",
            }}
          >
            <div
              style={{
                padding: "10px 12px",
                borderRadius: 12,
                border: "1px solid rgba(148,163,184,0.35)",
                background: "rgba(15,23,42,0.85)",
                maxWidth: 520,
                textAlign: "center",
                lineHeight: 1.35,
              }}
            >
              <div style={{ fontWeight: 800, marginBottom: 4 }}>Diagram is locked while you edit YAML</div>
              <div style={{ opacity: 0.9 }}>
                Click to enable pan/zoom. Press <span style={{ fontFamily: "ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace" }}>Esc</span> to lock again.
              </div>
            </div>
          </div>
        </button>
      )}
      {status !== "Ready" && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            pointerEvents: "none",
            fontFamily: "system-ui, sans-serif",
            fontSize: 13,
            opacity: 0.9,
          }}
        >
          {status}
        </div>
      )}
    </div>
  );
}
