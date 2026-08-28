/**
 * Entry point. The UI is a thin layer: it reads state, calls the engine, and
 * renders. It never computes anything the engine could compute, and the engine
 * never imports anything from here.
 *
 * Pattern that has worked: one module-level `state` object, a `renderAll()`
 * that redraws wholesale, and event handlers that mutate state then call it.
 * No virtual DOM, no reactivity, no framework. When wholesale redraws start to
 * lose focus or scroll position, preserve them explicitly rather than
 * introducing incremental rendering.
 */

import "../shared/tokens.css";
import "../shared/app.css";
import "./styles.css";

import { usd } from "../engine/money.ts";
import { $, clear, h } from "./dom.ts";

interface State {
  /** TODO — replace with the app's real state. */
  demoCents: number;
}

const state: State = { demoCents: 750_880 };

function renderAll(): void {
  const root = $("app");
  clear(root);
  root.appendChild(
    h(
      "div",
      { class: "panel" },
      h("p", {}, "Scaffold is alive. Replace src/ui/main.ts with the real app."),
      h("p", { class: "mono" }, `money helper: ${usd(state.demoCents)}`),
    ),
  );
}

renderAll();
