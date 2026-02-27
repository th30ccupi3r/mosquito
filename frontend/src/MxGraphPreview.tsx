import React, { useEffect, useRef, useState } from "react";

type Props = {
  xml: string;
  /**
   * When true, allow selecting edges and adding/moving bend points so users can
   * route lines around shapes.
   */
  editableRoutes?: boolean;
  /**
   * Called when the user changes routing (edge geometry) in the preview.
   * The returned XML is a full mxGraphModel which can be exported to draw.io.
   */
  onXmlEdited?: (xml: string) => void;
};

export default function MxGraphPreview({ xml, editableRoutes = false, onXmlEdited }: Props) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const graphRef = useRef<any>(null);
  const [err, setErr] = useState("");

  useEffect(() => {
    const w = window as any;

    if (!w.mxEvent || !w.mxGraph || !w.mxUtils || !w.mxCodec) {
      setErr("mxGraph globals missing. Ensure index.html loads /mxgraph/js/mxClient.js and mxBasePath='/mxgraph/js'.");
      return;
    }

    setErr("");
    const host = hostRef.current;
    if (!host) return;

    host.innerHTML = "";

    const container = document.createElement("div");
    container.style.width = "100%";
    container.style.height = "100%";
    container.style.overflow = "auto";
    container.style.background = "#ffffff";
    // Make the preview focusable. We only capture arrow keys when the user
    // explicitly clicks the diagram (so the editor keeps normal arrow behavior).
    container.tabIndex = 0;
    host.appendChild(container);

    // Click-to-focus so arrow keys pan only when the diagram is active.
    container.addEventListener("mousedown", () => container.focus());

    const canvas = document.createElement("div");
    canvas.style.width = "2000px";
    canvas.style.height = "1200px";
    canvas.style.background = "#ffffff";
    container.appendChild(canvas);

    w.mxEvent.disableContextMenu(container);

    const graph = new w.mxGraph(canvas);
    // Ensure light canvas and no "page" grey margin.
    try { (graph as any).setPageVisible?.(false); } catch {}
    try { (graph as any).pageVisible = false; } catch {}
    graph.setPanning(true);
    // When editing routes we want left-drag to manipulate edges, not pan.
    graph.panningHandler.useLeftButtonForPanning = !editableRoutes;
    graph.setTooltips(false);
    graph.setConnectable(false);

    // Route-edit mode: let users drag edge segments / add waypoints so links
    // can be routed around components and subcomponents.
    graph.setCellsSelectable(!!editableRoutes);
    graph.setCellsMovable(false);
    graph.setCellsEditable(false);
    graph.setCellsResizable(false);
    graph.setCellsBendable(!!editableRoutes);
    graph.setAllowDanglingEdges(false);
    graph.setDisconnectOnMove(false);
    graph.edgeLabelsMovable = false;

    // Only allow selecting edges (and edge-attached TAM markers) when editing routes.
    graph.isCellSelectable = (cell: any) => {
      if (!editableRoutes) return false;
      if (!cell) return false;
      const m = graph.getModel();
      return m.isEdge(cell) || (m.isVertex(cell) && m.isEdge(m.getParent(cell)));
    };
    graph.foldingEnabled = false;

    if ((graph as any).keyHandler) {
      (graph as any).keyHandler.destroy();
      (graph as any).keyHandler = null;
    }

    const onKeyDown = (e: KeyboardEvent) => {
      const step = e.shiftKey ? 80 : 40;
      if (e.key === "ArrowLeft") { container.scrollLeft -= step; e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === "ArrowRight") { container.scrollLeft += step; e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === "ArrowUp") { container.scrollTop -= step; e.preventDefault(); e.stopPropagation(); return; }
      if (e.key === "ArrowDown") { container.scrollTop += step; e.preventDefault(); e.stopPropagation(); return; }

      // Enforce keyboard restrictions only when the diagram is focused.
      e.preventDefault();
      e.stopPropagation();
    };
    // Attach to the container so the editor pane keeps normal arrow behavior.
    container.addEventListener("keydown", onKeyDown);

    graphRef.current = { graph, onKeyDown };

    const doc = w.mxUtils.parseXml(xml);
    const codec = new w.mxCodec(doc);
    const models = doc.getElementsByTagName("mxGraphModel");
    const modelNode = models && models.length ? models[0] : doc.documentElement;
    codec.decode(modelNode, graph.getModel());

    graph.refresh();
    // Do not auto-fit/zoom; keep scale at 1.
    try { graph.view.scale = 1; } catch {}

    // Emit edited XML when routing changes.
    let emitTimer: any = null;
    const emitEdited = () => {
      if (!editableRoutes || !onXmlEdited) return;
      if (emitTimer) clearTimeout(emitTimer);
      emitTimer = setTimeout(() => {
        try {
          const outDoc = w.mxUtils.createXmlDocument();
          const outCodec = new w.mxCodec(outDoc);
          const node = outCodec.encode(graph.getModel());
          outDoc.appendChild(node);
          const outXml = w.mxUtils.getXml(outDoc);
          onXmlEdited(outXml);
        } catch {
          // ignore
        }
      }, 120);
    };

    const modelListener = () => emitEdited();
    if (editableRoutes) {
      graph.getModel().addListener(w.mxEvent.CHANGE, modelListener);
    }
return () => {
      if (editableRoutes) {
        try { graph.getModel().removeListener(modelListener); } catch {}
      }
      if (emitTimer) clearTimeout(emitTimer);
      container.removeEventListener("keydown", onKeyDown);
      try { graph.destroy(); } catch {}
      graphRef.current = null;
    };
  }, [xml, editableRoutes, onXmlEdited]);

  if (err) return <div style={{ padding: 12, color: "#fecaca" }}>Preview failed: {err}</div>;
  return <div ref={hostRef} style={{ width: "100%", height: "100%" }} />;
}
